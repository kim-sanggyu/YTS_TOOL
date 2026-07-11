import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { ytsDb } from "@/lib/db/oracle"
import { runHometaxCalc, runHometaxCompare } from "@/features/hometax-calc/lib/runHometaxCalc"
import { mappingSelectCols } from "@/features/hometax-calc/mapping/2025"

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

// ── 기부금 PAY_WRK_GIFT → GIFT_{코드} 가상컬럼 주입 ─────────────────────────
const GIFT_CLS_TO_NTS: Record<string, string> = {
  "548-110": "8784", "548-100": "8783",
  "548-010": "8743", "548-080": "8744",
  "548-060": "8747", "548-070": "8746",
}
const GIFT_ADJ_CODES: Record<string, string[]> = {
  "548-010": ["8811","8812","8813","8814","8815"],
  "548-070": ["8821","8822","8823","8824","8825"],
  "548-060": ["8831","8832","8833","8834","8835"],
}
function injectGiftVals(
  current: { GIFT_CLS: string; AMT: number }[],
  adj:     { GIFT_CLS: string; GIFT_YY: string; GIFT_ABLE_SUB_AMT: number }[],
  attrYr:  number,
  vals:    Record<string, number>,
) {
  for (const row of current) {
    const amt = Number(row.AMT ?? 0)
    if (row.GIFT_CLS === "548-020") {
      vals["GIFT_8740"] = Math.min(amt, 100000)
      vals["GIFT_8741"] = Math.max(0, amt - 100000)
    } else {
      const code = GIFT_CLS_TO_NTS[row.GIFT_CLS]
      if (code) vals[`GIFT_${code}`] = amt
    }
  }
  for (const row of adj) {
    const codes = GIFT_ADJ_CODES[row.GIFT_CLS]
    if (!codes) continue
    const diff = attrYr - Number(row.GIFT_YY)
    if (diff >= 1 && diff <= 5) vals[`GIFT_${codes[diff - 1]}`] = Number(row.GIFT_ABLE_SUB_AMT ?? 0)
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증이 필요합니다." }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { calcNo?: string; mode?: string }
  const calcNo = (body.calcNo ?? "").trim()
  if (!calcNo) return Response.json({ error: "calc_no 를 입력하세요." }, { status: 400 })

  const mode = body.mode ?? "compare" // "compare" | "simple"

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
    const existing = await existingCalcCols()
    const wanted   = mappingSelectCols()
    const mapCols  = wanted.filter(c => !c.startsWith("GIFT_") && existing.has(c))
    const unknownCols = wanted.filter(c => !c.startsWith("GIFT_") && !existing.has(c))
    const cols = [...new Set([...BASE_COLS, ...mapCols])]

    const sql = `SELECT ${cols.map(c => `c.${c}`).join(", ")} FROM YTS39.PAY_WRK_CALC c WHERE c.CALC_NO = :1`
    const [row] = await ytsDb.query<Record<string, unknown>>(sql, [calcNo])
    if (!row) return Response.json({ error: `${calcNo} 를 찾을 수 없습니다.` }, { status: 404 })

    // 컬럼명→숫자 레코드 (매핑이 컬럼명으로 값을 읽는다)
    const vals: Record<string, number> = {}
    for (const c of cols) vals[c] = Number(row[c] ?? 0)

    const [giftCurrent, giftAdj] = await Promise.all([
      ytsDb.query<{ GIFT_CLS: string; AMT: number }>(
        `SELECT GIFT_CLS, SUM(AMT) AS AMT FROM YTS39.PAY_WRK_GIFT WHERE CALC_NO = :1 GROUP BY GIFT_CLS`,
        [calcNo]
      ),
      ytsDb.query<{ GIFT_CLS: string; GIFT_YY: string; GIFT_ABLE_SUB_AMT: number }>(
        `SELECT GIFT_CLS, GIFT_YY, GIFT_ABLE_SUB_AMT FROM YTS39.PAY_WRK_GIFT_ADJ WHERE CALC_NO = :1 AND :2 > GIFT_YY AND GIFT_CLS IN ('548-010','548-060','548-070')`,
        [calcNo, ATTR_YR]
      ),
    ])
    injectGiftVals(giftCurrent, giftAdj, Number(ATTR_YR), vals)

    const compare = await runHometaxCompare(vals)

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
