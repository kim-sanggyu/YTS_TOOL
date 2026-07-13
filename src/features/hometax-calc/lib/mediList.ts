import { ytsDb } from "@/lib/db/oracle"
import { MEDI_CATS, parseMediProc } from "@/features/hometax-calc/mapping/medi"
import { exhaustInfo } from "@/features/hometax-calc/lib/exhaust"
import { calcMethodLabel, workStatusLabel } from "@/features/hometax-calc/lib/personInfo"

export interface MediLine { code: string; label: string; useAmt: number }
export interface MediListItem {
  calcNo: string; nm: string; totPayAmt: number; mediDdc: number
  exhausted: boolean; exhaustLabel: string | null
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  lines: MediLine[]
}

// 의료비공제 발생 건(CALC_PROC_MEDI 존재 + RT_MEDI_AMT>0)의 대상자별 지출금액 라인.
// YTS 의료비 세액공제(비교 기준) = RT_MEDI_AMT(=의료비_공제금액), NTS 8726(의료비집계)과 대조.
export async function getMediItems(year: string): Promise<MediListItem[]> {
  const prefix = `X${year}%`

  const rows = await ytsDb.query<{
    CALC_NO: string; NM: string; TOT_PAY_AMT: number; EXHAUSTED_POINT: string | null
    RT_MEDI_AMT: number; CALC_PROC_MEDI: string | null
    CALC_METHOD: string | null; CALC_PROC_TOTAL: string | null
    EMP_NO: string | null; KEEP_PS: string | null
  }>(`
    SELECT c.CALC_NO,
           SUBSTR(f.NM, 1, 4) AS NM,
           c.TOT_PAY_AMT, c.EXHAUSTED_POINT,
           NVL(c.RT_MEDI_AMT, 0) AS RT_MEDI_AMT,
           c.CALC_PROC_MEDI, c.CALC_METHOD, c.CALC_PROC_TOTAL,
           m.EMP_NO, m.KEEP_PS
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
    LEFT JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
    WHERE c.CALC_NO LIKE :1
      AND c.CALC_PROC_MEDI IS NOT NULL
      AND NVL(c.RT_MEDI_AMT, 0) > 0
    ORDER BY c.CALC_NO
  `, [prefix])

  return rows.map(r => {
    const parsed = parseMediProc(r.CALC_PROC_MEDI)
    const lines = MEDI_CATS
      .map(cat => ({ code: cat.code, label: cat.label, useAmt: Number(parsed?.catAmts[cat.key] ?? 0) }))
      .filter(l => l.useAmt > 0)
    const ex = exhaustInfo(r.EXHAUSTED_POINT)
    return {
      calcNo:    r.CALC_NO,
      nm:        r.NM,
      totPayAmt: Number(r.TOT_PAY_AMT),
      mediDdc:   Number(r.RT_MEDI_AMT),   // YTS 의료비 세액공제 (비교 기준)
      exhausted: ex.exhausted, exhaustLabel: ex.exhaustLabel,
      empNo:     r.EMP_NO ?? "-",
      calcType:  calcMethodLabel(r.CALC_METHOD),
      workStatus: workStatusLabel(r.KEEP_PS),
      calcProcTotal: r.CALC_PROC_TOTAL,
      lines,
    }
  })
}
