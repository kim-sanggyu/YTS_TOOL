import { ytsDb } from "@/lib/db/oracle"
import { PERSONAL_ROWS, type PersonalKind } from "@/features/hometax-calc/mapping/personal"
import { exhaustInfo } from "@/features/hometax-calc/lib/exhaust"
import { calcMethodLabel, workStatusLabel } from "@/features/hometax-calc/lib/personInfo"

export interface PersonalLine { code: string; label: string; kind: string; ytsDdc: number }
export interface PersonalListItem {
  calcNo: string; nm: string; totPayAmt: number
  exhausted: boolean; exhaustLabel: string | null
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  lines: PersonalLine[]
}

// 인적공제 그룹(본인 제외) 사람별 YTS 공제액. 값(>0) 있는 항목만 line 으로.
// kind 지정 시 그 성격(소득공제=인적공제 / 세액공제=혼인·자녀·출산)만 필터.
// NTS 대조값은 화면에서 results.ntsMap[code] 로 조인(코드 전부 이미 send/요청됨).
export async function getPersonalItems(year: string, kind?: PersonalKind): Promise<PersonalListItem[]> {
  const cols      = kind ? PERSONAL_ROWS.filter(r => r.kind === kind) : PERSONAL_ROWS
  const prefix    = `X${year}%`
  const ddcSel    = cols.map(r => `NVL(c.${r.ytsCol}, 0) AS DDC_${r.code}`).join(", ")
  const anyPositive = cols.map(r => `NVL(c.${r.ytsCol}, 0) > 0`).join(" OR ")

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
    const lines: PersonalLine[] = cols
      .map(row => ({ code: row.code, label: row.label, kind: row.kind, ytsDdc: Number(r[`DDC_${row.code}`] ?? 0) }))
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
