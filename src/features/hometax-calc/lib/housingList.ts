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
async function getGroupItems(
  year: string, rows: MappingRow[], inputExpr?: (m: MappingRow) => string | null, kind: string = "소득공제",
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
      .filter(l => l.ytsDdc > 0)
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
const HOUSING_INPUT_COL: Record<string, string> = {
  "8311": "HOUSE_RALR_LENDER", "8312": "HOUSE_RALR_HABT",
  "8321": "LH_LRSF1",  "8322": "LH_LRSF2",  "8323": "LH_LRSF3",
  "8324": "LH_LRSF10", "8325": "LH_LRSF20", "8326": "LH_LRSF30",
  "8327": "LH_LRSF40", "8328": "LH_LRSF50", "8329": "LH_LRSF60",
}
export const getHousingItems = (year: string) => getGroupItems(year, HOUSING_ROWS, m => {
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
