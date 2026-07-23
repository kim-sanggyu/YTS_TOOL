import { ytsDb } from "@/lib/db/oracle"
import { MAPPING_2025, type MappingRow } from "@/features/hometax-calc/mapping/2025"
import { exhaustInfo } from "@/features/hometax-calc/lib/exhaust"
import { calcMethodLabel, workStatusLabel } from "@/features/hometax-calc/lib/personInfo"

export interface HousingLine { code: string; label: string; kind: string; ytsDdc: number; ytsInput?: number }
export interface HousingListItem {
  calcNo: string; nm: string; totPayAmt: number
  exhausted: boolean; exhaustLabel: string | null
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  lines: HousingLine[]
}

// 소득공제 그룹 공용: 매핑 rows(resultCol=YTS 공제액)로 사람별 항목 대조 조회. 값(>0) 있는 항목만 line.
// NTS 대조값은 화면에서 results.ntsMap[code] 로 조인. inputExpr(옵션): 각 행의 전송값(납입액 등) SQL 표현식.
// filterByInput=true: 여러 코드가 resultCol 을 공유(세액감면 8603/8608 등)해 공제액으로 항목을 못 가릴 때,
//   전송값(IN)>0 인 항목만 line 으로 남긴다(IN=0 인데 공유 공제액이 흘러드는 오표시 방지).
async function getGroupItems(
  year: string, rows: MappingRow[], inputExpr?: (m: MappingRow) => string | null, kind: string = "소득공제",
  filterByInput = false,
): Promise<HousingListItem[]> {
  if (rows.length === 0) return []
  const ddcSel      = rows.map(m => `NVL(c.${m.resultCol}, 0) AS DDC_${m.ntsCode}`).join(", ")
  const anyPositive = rows.map(m => `NVL(c.${m.resultCol}, 0) > 0`).join(" OR ")
  const inSel = inputExpr
    ? ", " + rows.map(m => { const e = inputExpr(m); return `${e ? `(${e})` : "0"} AS IN_${m.ntsCode}` }).join(", ")
    : ""

  const dbRows = await ytsDb.query<Record<string, unknown>>(`
    SELECT c.CALC_NO,
           SUBSTR(f.NM, 1, 4) AS NM,
           c.TOT_PAY_AMT, c.EXHAUSTED_POINT, c.CALC_METHOD, c.CALC_PROC_TOTAL,
           m.EMP_NO, m.KEEP_PS,
           ${ddcSel}${inSel}
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
    JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
    WHERE m.YY = :1
      AND (${anyPositive})
    ORDER BY c.CALC_NO
  `, [year])

  return dbRows.map(r => {
    const lines: HousingLine[] = rows
      .map(m => ({
        code: m.ntsCode, label: m.label, kind, ytsDdc: Number(r[`DDC_${m.ntsCode}`] ?? 0),
        ...(inputExpr ? { ytsInput: Number(r[`IN_${m.ntsCode}`] ?? 0) } : {}),
      }))
      .filter(l => filterByInput ? Number(l.ytsInput ?? 0) > 0 : l.ytsDdc > 0)
    const ex = exhaustInfo(r.EXHAUSTED_POINT as string | null)
    return {
      calcNo:     String(r.CALC_NO),
      nm:         String(r.NM ?? ""),
      totPayAmt:  Number(r.TOT_PAY_AMT ?? 0),
      exhausted:  ex.exhausted, exhaustLabel: ex.exhaustLabel,
      empNo:      (r.EMP_NO as string) ?? "-",
      calcType:   calcMethodLabel(r.CALC_METHOD as string | null),
      workStatus: workStatusLabel(r.KEEP_PS as string | null),
      calcProcTotal: (r.CALC_PROC_TOTAL as string) ?? null,
      lines,
    }
  })
}

// 주택자금(특별소득공제) = 원본전송(LOAN_) 배선 행(원리금·장기주택저당).
const HOUSING_ROWS = MAPPING_2025.filter(m => m.ytsCol?.startsWith("LOAN_") && m.resultCol)
// 전송 사용액(원본 상환액) 원천 PAY_WRK_MAIN 컬럼 — runCompareForCalcNo.injectHousingVals 와 동일 매핑.
// ※8312(거주자)만 예외: 원천=PAY_WRK_RENT_HABT_SPEC B0 SUM(PNINT_SUM) (아래 getHousingItems 분기, 2026-07-23 실측정정).
const HOUSING_INPUT_COL: Record<string, string> = {
  "8311": "HOUSE_RALR_LENDER",
  "8321": "LH_LRSF1",  "8322": "LH_LRSF2",  "8323": "LH_LRSF3",
  "8324": "LH_LRSF10", "8325": "LH_LRSF20", "8326": "LH_LRSF30",
  "8327": "LH_LRSF40", "8328": "LH_LRSF50", "8329": "LH_LRSF60",
}
export const getHousingItems = (year: string) => getGroupItems(year, HOUSING_ROWS, m => {
  if (m.ntsCode === "8312")   // 주택임차 원리금 거주자 = PAY_WRK_RENT_HABT_SPEC B0 PNINT_SUM 합 (PAY_WRK_MAIN 아님)
    return `SELECT NVL(SUM(r.PNINT_SUM), 0) FROM YTS39.PAY_WRK_RENT_HABT_SPEC r WHERE r.CALC_NO = c.CALC_NO AND r.RENT_HABT_CLS = 'B0'`
  const col = HOUSING_INPUT_COL[m.ntsCode]
  return col ? `NVL(m.${col}, 0)` : null
})

// 주택마련저축(그밖의소득공제) = 청약저축(8403)·주택청약종합저축(8407)·근로자주택마련저축(8404).
// 전송 사용액(납입액) = PAY_WRK_PEN_SAVE_SPEC CLS별 합(562-050/060/080).
const HOUSING_SAVINGS_ROWS = MAPPING_2025.filter(m => ["8403", "8404", "8407"].includes(m.ntsCode) && m.resultCol)
const HS_PEN_CLS: Record<string, string> = { "8403": "562-050", "8404": "562-080", "8407": "562-060" }
export const getHousingSavingsItems = (year: string) => getGroupItems(year, HOUSING_SAVINGS_ROWS, m => {
  const cls = HS_PEN_CLS[m.ntsCode]
  return cls
    ? `SELECT NVL(SUM(s.PEN_SAVE_PMT_AMT), 0) FROM YTS39.PAY_WRK_PEN_SAVE_SPEC s WHERE s.CALC_NO = c.CALC_NO AND s.PEN_SAVE_CLS = '${cls}'`
    : null
})

// 그밖의소득공제(잡) = 우리사주출연금(8452)·장기집합(8451)·청년형(8501)·고용유지중소기업(8453). self 대조(YTS OTO_* ↔ NTS 각 코드).
// 전송 사용액 = 우리사주 MAIN.STOCK_URDM / 고용유지 MAIN.EMPL_MTN_WAGE_CUT / 장기집합 PEN 562-100 합 / 청년형 PEN 562-140 합.
const OTHER_INCOME_ROWS = MAPPING_2025.filter(m => ["8451", "8452", "8453", "8501"].includes(m.ntsCode) && m.resultCol)
const OI_PEN_CLS:  Record<string, string> = { "8451": "562-100", "8501": "562-140" }
const OI_MAIN_COL: Record<string, string> = { "8452": "STOCK_URDM", "8453": "EMPL_MTN_WAGE_CUT" }
export const getOtherIncomeItems = (year: string) => getGroupItems(year, OTHER_INCOME_ROWS, m => {
  const cls = OI_PEN_CLS[m.ntsCode]
  if (cls) return `SELECT NVL(SUM(s.PEN_SAVE_PMT_AMT), 0) FROM YTS39.PAY_WRK_PEN_SAVE_SPEC s WHERE s.CALC_NO = c.CALC_NO AND s.PEN_SAVE_CLS = '${cls}'`
  const col = OI_MAIN_COL[m.ntsCode]
  return col ? `NVL(m.${col}, 0)` : null
})

// 기타세액공제(잡) = 외국납부(8751)·주택차입금이자(8752)·납세조합(8753). self 대조(YTS RT_* ↔ NTS 각 코드).
// 전송 사용액(대상금액) = PAY_WRK_MAIN 원천. 8754(국외총급여)는 동반입력·결과없음이라 제외(resultCol 없음).
const ETC_CREDIT_ROWS = MAPPING_2025.filter(m => ["8751", "8752", "8753"].includes(m.ntsCode) && m.resultCol)
const EC_MAIN_COL: Record<string, string> = { "8751": "FRGN_PAY_TAX", "8752": "HOUSE_ALR", "8753": "ASSO_SUB_TAX_AMT" }
export const getEtcCreditItems = (year: string) => getGroupItems(year, ETC_CREDIT_ROWS, m => {
  const col = EC_MAIN_COL[m.ntsCode]
  return col ? `NVL(m.${col}, 0)` : null
}, "세액공제")

// 세액감면 = 소득세법(8601)·조특법30조(8603/8608)·조특법30조제외(8602 등)·조세조약(8606). self 대조(YTS RT_* ↔ NTS 각 코드).
// 전송 사용액(감면대상급여) = 8601 MAIN.TAX_GOVM_AGREE / 나머지 FN_PAY_GET_WRK_NTAX(MAIN+SUB, Txx) 합.
// ⚠조특법30조제외(8602·8612·8609·8611·8617·8610·8616·8614)는 YTS 공제액이 RT_R_LAW 한 컬럼에 합산돼 개별 대조 불가(합 표시). 8601/8606/8603/8608은 개별.
const TAX_CUT_ROWS = MAPPING_2025.filter(m => m.group === "세액감면" && m.resultCol)
const TC_TXX: Record<string, string> = {
  "8603": "T12", "8608": "T13", "8602": "T01", "8612": "T02", "8609": "T30",
  "8611": "T50", "8606": "T20", "8617": "T42", "8610": "T40", "8616": "T43", "8614": "T41",
}
export const getTaxCutItems = (year: string) => getGroupItems(year, TAX_CUT_ROWS, m => {
  if (m.ntsCode === "8601") return `NVL(m.TAX_GOVM_AGREE, 0)`
  const t = TC_TXX[m.ntsCode]
  return t ? `FN_PAY_GET_WRK_NTAX(c.CALC_NO,'MAIN',NULL,'${t}') + FN_PAY_GET_WRK_NTAX(c.CALC_NO,'SUB',NULL,'${t}')` : null
}, "세액감면", true)   // resultCol 공유(RT_R_LAW/RT_R_LAW_CLAUS30) → 전송사용액>0 항목만 표시

// 보험료 세액공제 = 보장성(8710, 12%)·장애인전용 보장성(8711, 15%). self 대조(YTS RT_IF_* ↔ NTS 각 코드).
// 전송 사용액(공제대상금액, 100만 capped) = PAY_WRK_CALC.SPCL_IF_* — resultCol 고유(공유 아님).
const INSURANCE_ROWS = MAPPING_2025.filter(m => ["8710", "8711"].includes(m.ntsCode) && m.resultCol)
const INS_CALC_COL: Record<string, string> = { "8710": "SPCL_IF_GRT_INSU_AMT", "8711": "SPCL_IF_HDC_PERS_INSU_AMT" }
export const getInsuranceItems = (year: string) => getGroupItems(year, INSURANCE_ROWS, m => {
  const col = INS_CALC_COL[m.ntsCode]
  return col ? `NVL(c.${col}, 0)` : null
}, "세액공제")

// 교육비 = 소계형(8735). 8730에 공제대상 총액(SPCL_EDU_AMT, 한도후) 전송 → 서버 ×15% → 8735 소계 ↔ RT_EDU_AMT.
// 구분(8731~34)은 서버 무시라 1항목(8735)만 대조. getGroupItems(resultCol 기반)를 못 쓰고 전용 조회.
export async function getEducationItems(year: string): Promise<HousingListItem[]> {
  const dbRows = await ytsDb.query<Record<string, unknown>>(`
    SELECT c.CALC_NO,
           SUBSTR(f.NM, 1, 4) AS NM,
           c.TOT_PAY_AMT, c.EXHAUSTED_POINT, c.CALC_METHOD, c.CALC_PROC_TOTAL,
           m.EMP_NO, m.KEEP_PS,
           NVL(c.RT_EDU_AMT, 0) AS DDC, NVL(c.SPCL_EDU_AMT, 0) AS INAMT
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
    JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
    WHERE m.YY = :1
      AND NVL(c.RT_EDU_AMT, 0) > 0
    ORDER BY c.CALC_NO
  `, [year])

  return dbRows.map(r => {
    const ex = exhaustInfo(r.EXHAUSTED_POINT as string | null)
    return {
      calcNo:     String(r.CALC_NO),
      nm:         String(r.NM ?? ""),
      totPayAmt:  Number(r.TOT_PAY_AMT ?? 0),
      exhausted:  ex.exhausted, exhaustLabel: ex.exhaustLabel,
      empNo:      (r.EMP_NO as string) ?? "-",
      calcType:   calcMethodLabel(r.CALC_METHOD as string | null),
      workStatus: workStatusLabel(r.KEEP_PS as string | null),
      calcProcTotal: (r.CALC_PROC_TOTAL as string) ?? null,
      lines: [{ code: "8735", label: "교육비 세액공제", kind: "세액공제", ytsDdc: Number(r.DDC ?? 0), ytsInput: Number(r.INAMT ?? 0) }],
    }
  })
}
