import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { ytsDb } from "@/lib/db/oracle"
import { runHometaxCalc, runHometaxCompare } from "@/features/hometax-calc/lib/runHometaxCalc"
import { mappingSelectCols } from "@/features/hometax-calc/mapping/2025"
import { giftNtsCode } from "@/features/hometax-calc/mapping/gift"
import { CARD_CATS, parseCardProc } from "@/features/hometax-calc/mapping/card"
import { MEDI_CATS, parseMediProc } from "@/features/hometax-calc/mapping/medi"
import { pensionNtsCode } from "@/features/hometax-calc/mapping/pension"

export const maxDuration = 120

const ATTR_YR   = "2025"

// 결과대사·body 에 항상 필요한 기본 컬럼
const BASE_COLS = ["TOT_PAY_AMT", "PAYM_INCM_TAX", "PROD_TAX_AMT", "RES_INCM_TAX", "SUB_INCM_TAX"]

// PAY_WRK_CALC 실제 컬럼 캐시 — 매핑 오타/타테이블 컬럼을 SELECT 에서 제외해 쿼리 붕괴 방지
let calcColsCache: Set<string> | null = null
async function existingCalcCols(): Promise<Set<string>> {
  if (calcColsCache) return calcColsCache
  const rows = await ytsDb.query<{ COLUMN_NAME: string }>(
    `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER = 'YTS39' AND TABLE_NAME = 'PAY_WRK_CALC'`
  )
  calcColsCache = new Set(rows.map(r => r.COLUMN_NAME))
  return calcColsCache
}

// ── 기부금 PAY_WRK_GIFT_ADJ → GIFT_{코드} 가상컬럼 주입 (당해+이월 통합) ─────
// 세액계산된 건은 ADJ 에 유형×연도별 확정행이 모두 있음. GIFT_ABLE_SUB_AMT(대상금액)를 전송.
function injectGiftVals(
  adjRows: { GIFT_CLS: string; GIFT_YY: string; GIFT_ABLE_SUB_AMT: number }[],
  dataYear: number,
  vals:    Record<string, number>,
) {
  for (const row of adjRows) {
    const diff = dataYear - Number(row.GIFT_YY)
    const code = giftNtsCode(row.GIFT_CLS, diff)
    if (code) vals[`GIFT_${code}`] = Number(row.GIFT_ABLE_SUB_AMT ?? 0)
  }
}

// ── 신용카드 CALC_PROC_CARD(JSON) → CARD_{코드} 가상컬럼 주입 (가~아 사용액) ────
function injectCardVals(cardJson: string | null, vals: Record<string, number>) {
  const parsed = parseCardProc(cardJson)
  if (!parsed) return
  for (const cat of CARD_CATS) {
    const amt = Number(parsed.catAmts[cat.key] ?? 0)
    if (amt > 0) vals[`CARD_${cat.code}`] = amt
  }
}

// ── 의료비 CALC_PROC_MEDI(JSON) → MEDI_{코드} 가상컬럼 주입 (대상자별 지출금액) ──
function injectMediVals(mediJson: string | null, vals: Record<string, number>) {
  const parsed = parseMediProc(mediJson)
  if (!parsed) return
  for (const cat of MEDI_CATS) {
    const amt = Number(parsed.catAmts[cat.key] ?? 0)
    if (amt > 0) vals[`MEDI_${cat.code}`] = amt
  }
}

// ── 연금계좌 PAY_WRK_PEN_SAVE_SPEC → PEN_{코드} 가상컬럼 주입 (납입액 코드별 합산) ──
function injectPensionVals(
  specRows: { PEN_SAVE_CLS: string; PEN_SAVE_PMT_AMT: number }[],
  vals:     Record<string, number>,
) {
  for (const row of specRows) {
    const code = pensionNtsCode(row.PEN_SAVE_CLS)
    if (code) vals[`PEN_${code}`] = (vals[`PEN_${code}`] ?? 0) + Number(row.PEN_SAVE_PMT_AMT ?? 0)
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증이 필요합니다." }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { calcNo?: string; mode?: string; ntsYear?: string }
  const calcNo = (body.calcNo ?? "").trim()
  if (!calcNo) return Response.json({ error: "calc_no 를 입력하세요." }, { status: 400 })

  const mode    = body.mode ?? "compare"                               // "compare" | "simple"
  const ntsYear = (body.ntsYear ?? ATTR_YR).trim()                    // NTS L03 귀속연도
  const dataYear = calcNo.length >= 5 ? calcNo.substring(1, 5) : ntsYear // 데이터 귀속연도 (CALC_NO에서 추출)

  try {
    if (mode === "simple") {
      // 기존 방식: 총급여+기납부만 전송
      const [row] = await ytsDb.query<{ TOT_PAY_AMT: number; PAYM_INCM_TAX: number }>(
        `SELECT TOT_PAY_AMT, PAYM_INCM_TAX FROM YTS39.PAY_WRK_CALC WHERE CALC_NO = :1`, [calcNo]
      )
      if (!row) return Response.json({ error: `${calcNo} 를 찾을 수 없습니다.` }, { status: 404 })
      const result = await runHometaxCalc({ totalPay: Number(row.TOT_PAY_AMT), prepaidTax: Number(row.PAYM_INCM_TAX) })
      return Response.json({ calcNo, mode, result })
    }

    // compare 모드: 매핑표가 요구하는 컬럼 전체를 조회해 NTS L03 에 전송 후 YTS39 결과와 비교.
    // SELECT 컬럼은 매핑에서 생성하되, 실제 테이블에 존재하는 것만 사용(미존재=타테이블/오타는 제외+보고).
    // GIFT_*/CARD_*/MEDI_*/PEN_* 는 가상컬럼(별도 테이블·CLOB에서 주입)이라 PAY_WRK_CALC SELECT 에서 제외.
    const isVirtual = (c: string) => c.startsWith("GIFT_") || c.startsWith("CARD_") || c.startsWith("MEDI_") || c.startsWith("PEN_")
    const existing = await existingCalcCols()
    const wanted   = mappingSelectCols()
    const mapCols  = wanted.filter(c => !isVirtual(c) && existing.has(c))
    const unknownCols = wanted.filter(c => !isVirtual(c) && !existing.has(c))
    const cols = [...new Set([...BASE_COLS, ...mapCols])]

    // 카드 원천(CLOB JSON)은 숫자컬럼과 별도로 조회
    const sql = `SELECT ${cols.map(c => `c.${c}`).join(", ")}, c.CALC_PROC_CARD, c.CALC_PROC_MEDI FROM YTS39.PAY_WRK_CALC c WHERE c.CALC_NO = :1`
    const [row] = await ytsDb.query<Record<string, unknown>>(sql, [calcNo])
    if (!row) return Response.json({ error: `${calcNo} 를 찾을 수 없습니다.` }, { status: 404 })

    // 컬럼명→숫자 레코드 (매핑이 컬럼명으로 값을 읽는다)
    const vals: Record<string, number> = {}
    for (const c of cols) vals[c] = Number(row[c] ?? 0)

    const giftAdj = await ytsDb.query<{ GIFT_CLS: string; GIFT_YY: string; GIFT_ABLE_SUB_AMT: number }>(
      `SELECT GIFT_CLS, GIFT_YY, GIFT_ABLE_SUB_AMT FROM YTS39.PAY_WRK_GIFT_ADJ WHERE CALC_NO = :1`,
      [calcNo]
    )
    injectGiftVals(giftAdj, Number(dataYear), vals)
    injectCardVals((row.CALC_PROC_CARD as string) ?? null, vals)
    injectMediVals((row.CALC_PROC_MEDI as string) ?? null, vals)

    const penSpec = await ytsDb.query<{ PEN_SAVE_CLS: string; PEN_SAVE_PMT_AMT: number }>(
      `SELECT PEN_SAVE_CLS, PEN_SAVE_PMT_AMT FROM YTS39.PAY_WRK_PEN_SAVE_SPEC WHERE CALC_NO = :1`,
      [calcNo]
    )
    injectPensionVals(penSpec, vals)

    const compare = await runHometaxCompare(vals, ntsYear)

    return Response.json({
      calcNo,
      mode,
      yts: {
        totPayAmt:   vals.TOT_PAY_AMT,
        paymIncmTax: vals.PAYM_INCM_TAX,
        prodTaxAmt:  vals.PROD_TAX_AMT,
        resIncmTax:  vals.RES_INCM_TAX,
        subIncmTax:  vals.SUB_INCM_TAX,
      },
      nts:          compare.nts,
      coveredCodes: compare.coveredCodes,
      inputs:       compare.inputs,
      missing:      compare.missing,
      ntsMap:       compare.ntsMap,
      unknownCols,  // 매핑엔 있으나 테이블에 없는 컬럼(투명성: 오타/타테이블 신호)
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: `실행 실패: ${msg}` }, { status: 500 })
  }
}
