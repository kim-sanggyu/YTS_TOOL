import { ytsDb } from "@/lib/db/oracle"
import { MAPPING_2025 } from "@/features/hometax-calc/mapping/2025"
import { exhaustInfo } from "@/features/hometax-calc/lib/exhaust"
import { calcMethodLabel, workStatusLabel } from "@/features/hometax-calc/lib/personInfo"

export interface HousingLine { code: string; label: string; kind: string; ytsDdc: number }
export interface HousingListItem {
  calcNo: string; nm: string; totPayAmt: number
  exhausted: boolean; exhaustLabel: string | null
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  lines: HousingLine[]
}

// 주택자금(특별소득공제) 대조 대상 = 매핑에서 원본전송(LOAN_) 배선된 행(resultCol=SP_*_AMT 공제액).
const HOUSING_ROWS = MAPPING_2025.filter(m => m.ytsCol?.startsWith("LOAN_") && m.resultCol)

// 사람별 YTS 공제액(SP_*_AMT). 값(>0) 있는 항목만 line. NTS 대조값은 화면에서 results.ntsMap[code] 로 조인.
export async function getHousingItems(year: string): Promise<HousingListItem[]> {
  if (HOUSING_ROWS.length === 0) return []
  const prefix      = `X${year}%`
  const ddcSel      = HOUSING_ROWS.map(m => `NVL(c.${m.resultCol}, 0) AS DDC_${m.ntsCode}`).join(", ")
  const anyPositive = HOUSING_ROWS.map(m => `NVL(c.${m.resultCol}, 0) > 0`).join(" OR ")

  const rows = await ytsDb.query<Record<string, unknown>>(`
    SELECT c.CALC_NO,
           SUBSTR(f.NM, 1, 4) AS NM,
           c.TOT_PAY_AMT, c.EXHAUSTED_POINT, c.CALC_METHOD, c.CALC_PROC_TOTAL,
           m.EMP_NO, m.KEEP_PS,
           ${ddcSel}
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
    LEFT JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
    WHERE c.CALC_NO LIKE :1
      AND (${anyPositive})
    ORDER BY c.CALC_NO
  `, [prefix])

  return rows.map(r => {
    const lines: HousingLine[] = HOUSING_ROWS
      .map(m => ({ code: m.ntsCode, label: m.label, kind: "소득공제", ytsDdc: Number(r[`DDC_${m.ntsCode}`] ?? 0) }))
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
