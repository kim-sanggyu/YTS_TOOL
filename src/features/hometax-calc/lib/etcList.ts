import { ytsDb } from "@/lib/db/oracle"
import { MAPPING_2025 } from "@/features/hometax-calc/mapping/2025"
import { exhaustInfo } from "@/features/hometax-calc/lib/exhaust"
import { calcMethodLabel, workStatusLabel } from "@/features/hometax-calc/lib/personInfo"

export interface EtcLine { code: string; label: string; ytsInput: number; ytsDdc: number }
export interface EtcListItem {
  calcNo: string; nm: string; totPayAmt: number; etcDdc: number
  exhausted: boolean; exhaustLabel: string | null
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  lines: EtcLine[]
}

// 매핑에서 tab:"기타" 로 선언된 잡다한 단일 세액공제 항목(현재 월세 8750)을 한 탭에 모아 대조.
// 항목별로 YTS 공제(resultCol=RT_*) ↔ NTS(각 ntsCode)를 직접 비교한다(이질항목이라 항목행 자체가 비교단위).
// 입력원천(전송값)은 항목마다 다름: 월세(8750)=PAY_WRK_MAIN.HOUSE_RENT(원본 지급총액).
//   그 외 항목이 추가되면 아래 RENT_INPUT 처럼 원천 조회를 확장한다(없으면 공제액으로 대체 표시).
const ETC_ROWS = MAPPING_2025.filter(m => m.tab === "기타" && m.send && m.resultCol)

export async function getEtcItems(year: string): Promise<EtcListItem[]> {
  if (ETC_ROWS.length === 0) return []
  const prefix = `X${year}%`

  const ddcSel      = ETC_ROWS.map(m => `NVL(c.${m.resultCol}, 0) AS DDC_${m.ntsCode}`).join(", ")
  const anyPositive = ETC_ROWS.map(m => `NVL(c.${m.resultCol}, 0) > 0`).join(" OR ")

  const rows = await ytsDb.query<Record<string, unknown>>(`
    SELECT c.CALC_NO,
           SUBSTR(f.NM, 1, 4) AS NM,
           c.TOT_PAY_AMT, c.EXHAUSTED_POINT, c.CALC_METHOD, c.CALC_PROC_TOTAL,
           ${ddcSel},
           NVL(m.HOUSE_RENT, 0) AS RENT_INPUT,
           (SELECT NVL(SUM(s.PEN_SAVE_PMT_AMT), 0) FROM YTS39.PAY_WRK_PEN_SAVE_SPEC s
              WHERE s.CALC_NO = c.CALC_NO AND s.PEN_SAVE_CLS = '562-030') AS PPF_INPUT,
           NVL(m.SM_ETPR_AMT, 0) AS SM_ETPR_INPUT,
           m.EMP_NO, m.KEEP_PS
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
    LEFT JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
    WHERE c.CALC_NO LIKE :1
      AND (${anyPositive})
    ORDER BY c.CALC_NO
  `, [prefix])

  return rows.map(r => {
    const lines: EtcLine[] = ETC_ROWS
      .map(m => {
        const ddc   = Number(r[`DDC_${m.ntsCode}`] ?? 0)
        // 전송 원천값(전송 사용액 표시용): 항목마다 다름. 월세=지급총액, 개인연금저축=562-030 납입액, 그 외=공제액 대체.
        const input = m.ntsCode === "8750" ? Number(r.RENT_INPUT ?? 0)
                    : m.ntsCode === "8401" ? Number(r.PPF_INPUT ?? 0)
                    : m.ntsCode === "8402" ? Number(r.SM_ETPR_INPUT ?? 0)
                    : ddc
        return { code: m.ntsCode, label: m.label, ytsInput: input, ytsDdc: ddc }
      })
      .filter(l => l.ytsDdc > 0)
    const ex = exhaustInfo(r.EXHAUSTED_POINT as string | null)
    return {
      calcNo:     String(r.CALC_NO),
      nm:         String(r.NM ?? ""),
      totPayAmt:  Number(r.TOT_PAY_AMT ?? 0),
      etcDdc:     lines.reduce((s, l) => s + l.ytsDdc, 0),
      exhausted:  ex.exhausted, exhaustLabel: ex.exhaustLabel,
      empNo:      (r.EMP_NO as string) ?? "-",
      calcType:   calcMethodLabel(r.CALC_METHOD as string | null),
      workStatus: workStatusLabel(r.KEEP_PS as string | null),
      calcProcTotal: (r.CALC_PROC_TOTAL as string) ?? null,
      lines,
    }
  })
}
