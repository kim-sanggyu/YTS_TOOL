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
  year: string, rows: MappingRow[], inputExpr?: (m: MappingRow) => string | null,
): Promise<HousingListItem[]> {
  if (rows.length === 0) return []
  const prefix      = `X${year}%`
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
    LEFT JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
    WHERE c.CALC_NO LIKE :1
      AND (${anyPositive})
    ORDER BY c.CALC_NO
  `, [prefix])

  return dbRows.map(r => {
    const lines: HousingLine[] = rows
      .map(m => ({
        code: m.ntsCode, label: m.label, kind: "소득공제", ytsDdc: Number(r[`DDC_${m.ntsCode}`] ?? 0),
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
export const getHousingItems = (year: string) => getGroupItems(year, HOUSING_ROWS)

// 주택마련저축(그밖의소득공제) = 청약저축(8403)·주택청약종합저축(8405)·근로자주택마련저축(8404).
// 전송 사용액(납입액) = PAY_WRK_PEN_SAVE_SPEC CLS별 합(562-050/060/080).
const HOUSING_SAVINGS_ROWS = MAPPING_2025.filter(m => ["8403", "8404", "8405"].includes(m.ntsCode) && m.resultCol)
const HS_PEN_CLS: Record<string, string> = { "8403": "562-050", "8404": "562-080", "8405": "562-060" }
export const getHousingSavingsItems = (year: string) => getGroupItems(year, HOUSING_SAVINGS_ROWS, m => {
  const cls = HS_PEN_CLS[m.ntsCode]
  return cls
    ? `SELECT NVL(SUM(s.PEN_SAVE_PMT_AMT), 0) FROM YTS39.PAY_WRK_PEN_SAVE_SPEC s WHERE s.CALC_NO = c.CALC_NO AND s.PEN_SAVE_CLS = '${cls}'`
    : null
})
