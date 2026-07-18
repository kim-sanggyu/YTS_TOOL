import crypto from "node:crypto"
import { ytsDb } from "@/lib/db/oracle"
import { runHometaxCompare, type HometaxCompareResult } from "@/features/hometax-calc/lib/runHometaxCalc"
import { mappingSelectCols } from "@/features/hometax-calc/mapping/2025"
import { giftNtsCode } from "@/features/hometax-calc/mapping/gift"
import { CARD_CATS, parseCardProc } from "@/features/hometax-calc/mapping/card"
import { MEDI_CATS, parseMediProc } from "@/features/hometax-calc/mapping/medi"
import { pensionNtsCode } from "@/features/hometax-calc/mapping/pension"

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
// 국세청 이월코드는 "귀속연도로부터 N년차"의 상대코드이므로 diff 기준을 국세청 귀속연도(ntsYear)로 잡는다.
// 당해 행은 YTS 정산연도로 저장(GIFT_YY===ytsYear)돼 ntsYear 와 다를 수 있어 별도로 당해(0) 판정한다.
function injectGiftVals(
  adjRows: { GIFT_CLS: string; GIFT_YY: string; GIFT_ABLE_SUB_AMT: number }[],
  ytsYear: number,
  ntsYear: number,
  vals:    Record<string, number>,
) {
  for (const row of adjRows) {
    const yy   = Number(row.GIFT_YY)
    const diff = yy === ytsYear ? 0 : ntsYear - yy
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

// ── 그밖의소득공제 중 PAY_WRK_PEN_SAVE_SPEC 납입액(CLS별) → OTHER_{코드} 가상컬럼 주입 ──
// NTS self ddcAmt=납입액×40%(한도) 자체계산. 개인연금저축(72만한도) + 주택마련저축(청약/주택청약종합/근로자). (2026-07-18 실측)
const OTHER_PEN_CLS: Record<string, string> = {
  "562-030": "8401",   // 개인연금저축 (OUT ×40% 한도72만 ↔ OTO_PPF)
  "562-050": "8403",   // 청약저축 (↔ OTO_HOUSE_LOAN_SBSC_AMT)
  "562-060": "8405",   // 주택청약종합저축 (↔ OTO_HOUSE_LOAN_ALL_AMT)
  "562-080": "8404",   // 근로자주택마련저축 (↔ OTO_HOUSE_LOAN_WRK_AMT)
}
function injectOtherSavingsVals(
  specRows: { PEN_SAVE_CLS: string; PEN_SAVE_PMT_AMT: number }[],
  vals:     Record<string, number>,
) {
  for (const row of specRows) {
    const code = OTHER_PEN_CLS[row.PEN_SAVE_CLS]
    if (code) vals[`OTHER_${code}`] = (vals[`OTHER_${code}`] ?? 0) + Number(row.PEN_SAVE_PMT_AMT ?? 0)
  }
}

// ── 그밖의소득공제 중 PAY_WRK_MAIN 원본 컬럼 기반 → OTHER_{코드} 주입 ──
// 노란우산(8402): SM_ETPR_AMT(납입액). NTS self ddcAmt=min(납입액, 소득금액별한도) 자체계산 ↔ OTO_SM_ETPR_AMT. (2026-07-18 실측)
function injectOtherMainVals(mainRow: Record<string, number> | undefined, vals: Record<string, number>) {
  const n = Number(mainRow?.SM_ETPR_AMT ?? 0)
  if (n > 0) vals["OTHER_8402"] = n
}

// ── 월세 PAY_WRK_MAIN.HOUSE_RENT → RENT_8750 가상컬럼 주입 (원본 지급총액) ──
// NTS 8750 에 지급총액 전송 → NTS 가 한도(1000만)·공제율(총급여 15/17%)을 자체계산.
// 공제대상(SP_HOUSE_RENT_AMT=한도후)이 아닌 원본을 보내 우리 한도로직까지 NTS가 독립검증. (2026-07-15 실측확정)
function injectRentVals(houseRent: number, vals: Record<string, number>) {
  if (houseRent > 0) vals["RENT_8750"] = houseRent
}

// ── 기타세액공제 원천 PAY_WRK_MAIN → ETX_{코드} 가상컬럼 주입 (전부 useAmt 대상금액) ──
// 8751 외국납부(FRGN_PAY_TAX) + 8754 국외총급여(FRGN_TOT_PAY_AMT, 한도계산 동반필수), 8752 주택차입금이자(HOUSE_ALR), 8753 납세조합(ASSO_SUB_TAX_AMT).
// self 결과 ddcAmt ↔ RT_FCG/RT_HBA/RT_PTU 대조. 외국납부는 8751만 보내면 결과0(8754 필수). 코드·필드·결과key 실측확정, X2026 대상자 0이라 원단위 미검증. (2026-07-17)
function injectEtcCreditVals(mainRow: Record<string, number> | undefined, vals: Record<string, number>) {
  const put = (key: string, v: unknown) => { const n = Number(v ?? 0); if (n > 0) vals[key] = n }
  put("ETX_8751", mainRow?.FRGN_PAY_TAX)       // 외국납부 소득금액납부세액(대상)
  put("ETX_8754", mainRow?.FRGN_TOT_PAY_AMT)   // 국외근로총급여(한도계산용)
  put("ETX_8752", mainRow?.HOUSE_ALR)          // 주택차입금 이자상환액(대상)
  put("ETX_8753", mainRow?.ASSO_SUB_TAX_AMT)   // 납세조합 대상금액
}

// ── 주택자금(특별소득공제) 원천 PAY_WRK_MAIN → LOAN_{코드} 가상컬럼 주입 (원본 상환액 useAmt) ──
// 원리금(8311 대출기관/8312 거주자) + 장기주택저당(8321~8329). 한도가 있어 원본 상환액을 보내 NTS 한도로직을 검증.
// (한도후 공제액 SP_LH_LRSF*_AMT 를 보내면 이중캡) 대조는 화면단에서 SP_*_AMT. 코드 순서 실측확정(capture-io 2026-07-18).
function injectHousingVals(mainRow: Record<string, number> | undefined, vals: Record<string, number>) {
  const put = (code: string, v: unknown) => { const n = Number(v ?? 0); if (n > 0) vals[`LOAN_${code}`] = n }
  put("8311", mainRow?.HOUSE_RALR_LENDER)   // 주택임차 원리금 대출기관
  put("8312", mainRow?.HOUSE_RALR_HABT)     // 주택임차 원리금 거주자
  put("8321", mainRow?.LH_LRSF1)            // 장기주택저당 2011이전 15년미만
  put("8322", mainRow?.LH_LRSF2)            // 2011이전 15~29년
  put("8323", mainRow?.LH_LRSF3)            // 2011이전 30년이상
  put("8324", mainRow?.LH_LRSF10)           // 2012이후 15년이상 고정&비거치
  put("8325", mainRow?.LH_LRSF20)           // 2012이후 15년이상 그밖
  put("8326", mainRow?.LH_LRSF30)           // 2015이후 15년이상 고정&비거치
  put("8327", mainRow?.LH_LRSF40)           // 2015이후 15년이상 고정or비거치
  put("8328", mainRow?.LH_LRSF50)           // 2015이후 15년이상 그밖
  put("8329", mainRow?.LH_LRSF60)           // 2015이후 10~15년
}

// ── 부양가족 유형별(8004~8009) + 출산입양 순번별(8764~8766) PAY_WRK_FMLY 집계 → FAM_{코드} 주입 ──
// 국세청은 8003(통합) 아닌 8004~8009(유형별)로 받는다. 자녀공제(8763)는 유형별+8763 총인원 둘 다 필요,
// 출산입양(8761)은 순번별 8764~8766 이 산출(총인원 잉여). (2026-07-17 실측 정정)
async function injectFamilyVals(calcNo: string, vals: Record<string, number>) {
  const [r] = await ytsDb.query<Record<string, number>>(`
    SELECT
      SUM(CASE WHEN FMLY_RELN IN ('550-020','550-030') THEN 1 ELSE 0 END) AS FAM_8004,
      SUM(CASE WHEN FMLY_RELN = '550-050' THEN 1 ELSE 0 END) AS FAM_8005,
      SUM(CASE WHEN FMLY_RELN = '550-055' THEN 1 ELSE 0 END) AS FAM_8006,
      SUM(CASE WHEN FMLY_RELN = '550-060' THEN 1 ELSE 0 END) AS FAM_8007,
      SUM(CASE WHEN FMLY_RELN = '550-070' THEN 1 ELSE 0 END) AS FAM_8008,
      SUM(CASE WHEN FMLY_RELN = '550-080' THEN 1 ELSE 0 END) AS FAM_8009,
      SUM(CASE WHEN PER_CHI_YN = '3' AND FMLY_RELN = '550-050' THEN 1 ELSE 0 END) AS FAM_8764,
      SUM(CASE WHEN PER_CHI_YN = '5' AND FMLY_RELN = '550-050' THEN 1 ELSE 0 END) AS FAM_8765,
      SUM(CASE WHEN PER_CHI_YN = '7' AND FMLY_RELN = '550-050' THEN 1 ELSE 0 END) AS FAM_8766
    FROM YTS39.PAY_WRK_FMLY
    WHERE CALC_NO = :1 AND BAS_SUB_YN = 'Y'`, [calcNo])
  if (!r) return
  for (const code of ["8004", "8005", "8006", "8007", "8008", "8009", "8764", "8765", "8766"]) {
    const n = Number(r[`FAM_${code}`] ?? 0)
    if (n > 0) vals[`FAM_${code}`] = n
  }
}

export interface CompareRunResult {
  calcNo: string
  yts: { totPayAmt: number; paymIncmTax: number; prodTaxAmt: number; resIncmTax: number; subIncmTax: number }
  nts:          HometaxCompareResult["nts"]
  coveredCodes: HometaxCompareResult["coveredCodes"]
  inputs:       HometaxCompareResult["inputs"]
  missing:      HometaxCompareResult["missing"]
  ntsMap:       Record<string, number>
  unknownCols:  string[]
  inputHash:    string   // 국세청에 보낸 값(vals)+ntsYear 지문 — 캐시 스킵 판정용
}

// 국세청에 보낼 값 묶음 + 지문. buildCompareInput 로 만들어 캐시 대조에 씀.
export interface CompareInput {
  calcNo:      string
  vals:        Record<string, number>
  unknownCols: string[]
  inputHash:   string
}

// 보낼 값(vals)을 이름순 정렬·직렬화 후 ntsYear 를 붙여 sha256. 같은 값=같은 지문(재현), 하나만 바뀌어도 달라짐.
function computeInputHash(vals: Record<string, number>, ntsYear: string): string {
  const serial = Object.keys(vals).sort().map(k => `${k}:${vals[k]}`).join("|") + `|nts:${ntsYear}`
  return crypto.createHash("sha256").update(serial).digest("hex")
}

// compare 모드: 매핑표가 요구하는 컬럼 전체를 조회해 NTS L03 에 전송 후 YTS39 결과와 비교.
// SELECT 컬럼은 매핑에서 생성하되, 실제 테이블에 존재하는 것만 사용(미존재=타테이블/오타는 제외+보고).
// GIFT_*/CARD_*/MEDI_*/PEN_* 는 가상컬럼(별도 테이블·CLOB에서 주입)이라 PAY_WRK_CALC SELECT 에서 제외.
// ① 국세청에 보낼 값(vals) 조립 + 지문 계산. DB 조회만(국세청 호출 없음) → 캐시 스킵 판정에 싸게 씀.
export async function buildCompareInput(calcNo: string, ntsYear: string): Promise<CompareInput> {
  const dataYear = calcNo.length >= 5 ? calcNo.substring(1, 5) : ntsYear

  const isVirtual = (c: string) => c.startsWith("GIFT_") || c.startsWith("CARD_") || c.startsWith("MEDI_") || c.startsWith("PEN_") || c.startsWith("RENT_") || c.startsWith("FAM_") || c.startsWith("ETX_") || c.startsWith("LOAN_") || c.startsWith("OTHER_")
  const existing = await existingCalcCols()
  const wanted   = mappingSelectCols()
  const mapCols  = wanted.filter(c => !isVirtual(c) && existing.has(c))
  const unknownCols = wanted.filter(c => !isVirtual(c) && !existing.has(c))
  const cols = [...new Set([...BASE_COLS, ...mapCols])]

  // 카드 원천(CLOB JSON)은 숫자컬럼과 별도로 조회
  const sql = `SELECT ${cols.map(c => `c.${c}`).join(", ")}, c.CALC_PROC_CARD, c.CALC_PROC_MEDI FROM YTS39.PAY_WRK_CALC c WHERE c.CALC_NO = :1`
  const [row] = await ytsDb.query<Record<string, unknown>>(sql, [calcNo])
  if (!row) throw new Error(`${calcNo} 를 찾을 수 없습니다.`)

  // 컬럼명→숫자 레코드 (매핑이 컬럼명으로 값을 읽는다)
  const vals: Record<string, number> = {}
  for (const c of cols) vals[c] = Number(row[c] ?? 0)

  const giftAdj = await ytsDb.query<{ GIFT_CLS: string; GIFT_YY: string; GIFT_ABLE_SUB_AMT: number }>(
    `SELECT GIFT_CLS, GIFT_YY, GIFT_ABLE_SUB_AMT FROM YTS39.PAY_WRK_GIFT_ADJ WHERE CALC_NO = :1`,
    [calcNo]
  )
  injectGiftVals(giftAdj, Number(dataYear), Number(ntsYear), vals)
  injectCardVals((row.CALC_PROC_CARD as string) ?? null, vals)
  injectMediVals((row.CALC_PROC_MEDI as string) ?? null, vals)

  const penSpec = await ytsDb.query<{ PEN_SAVE_CLS: string; PEN_SAVE_PMT_AMT: number }>(
    `SELECT PEN_SAVE_CLS, PEN_SAVE_PMT_AMT FROM YTS39.PAY_WRK_PEN_SAVE_SPEC WHERE CALC_NO = :1`,
    [calcNo]
  )
  injectPensionVals(penSpec, vals)
  injectOtherSavingsVals(penSpec, vals)

  const [mainRow] = await ytsDb.query<Record<string, number>>(
    `SELECT HOUSE_RENT, ASSO_SUB_TAX_AMT, HOUSE_ALR, FRGN_PAY_TAX, FRGN_TOT_PAY_AMT,
            HOUSE_RALR_LENDER, HOUSE_RALR_HABT,
            LH_LRSF1, LH_LRSF2, LH_LRSF3, LH_LRSF10, LH_LRSF20, LH_LRSF30, LH_LRSF40, LH_LRSF50, LH_LRSF60,
            SM_ETPR_AMT
     FROM YTS39.PAY_WRK_MAIN WHERE CALC_NO = :1`,
    [calcNo]
  )
  injectRentVals(Number(mainRow?.HOUSE_RENT ?? 0), vals)
  injectEtcCreditVals(mainRow, vals)
  injectHousingVals(mainRow, vals)
  injectOtherMainVals(mainRow, vals)

  await injectFamilyVals(calcNo, vals)

  return { calcNo, vals, unknownCols, inputHash: computeInputHash(vals, ntsYear) }
}

// ② 조립된 입력을 국세청 L03에 보내 비교결과 조립(여기서만 NTS 호출).
export async function runCompareForInput(input: CompareInput, ntsYear: string): Promise<CompareRunResult> {
  const { calcNo, vals, unknownCols, inputHash } = input
  const compare = await runHometaxCompare(vals, ntsYear)

  return {
    calcNo,
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
    unknownCols,
    inputHash,
  }
}

// 조립 → 국세청 호출을 한 번에 (기존 시그니처 유지). 개별 실행·비캐시 경로에서 사용.
export async function runCompareForCalcNo(calcNo: string, ntsYear: string): Promise<CompareRunResult> {
  const input = await buildCompareInput(calcNo, ntsYear)
  return runCompareForInput(input, ntsYear)
}
