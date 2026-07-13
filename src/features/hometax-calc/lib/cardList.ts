import { ytsDb } from "@/lib/db/oracle"
import { CARD_CATS, parseCardProc } from "@/features/hometax-calc/mapping/card"
import { calcMethodLabel, workStatusLabel } from "@/features/hometax-calc/lib/personInfo"

export interface CardLine { code: string; label: string; useAmt: number }
export interface CardListItem {
  calcNo: string; nm: string; totPayAmt: number; cardDdc: number
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  lines: CardLine[]
}

// 카드공제 발생 건(CALC_PROC_CARD 존재 + OTO_CARD_ETC>0)의 가~아 사용액 라인.
// YTS 카드공제(비교 기준) = OTO_CARD_ETC(=최종공제금액), NTS 8430(카드소계)과 대조.
export async function getCardItems(year: string): Promise<CardListItem[]> {
  const prefix = `X${year}%`

  const rows = await ytsDb.query<{
    CALC_NO: string; NM: string; TOT_PAY_AMT: number
    OTO_CARD_ETC: number; CALC_PROC_CARD: string | null
    CALC_METHOD: string | null; CALC_PROC_TOTAL: string | null
    EMP_NO: string | null; KEEP_PS: string | null
  }>(`
    SELECT c.CALC_NO,
           SUBSTR(f.NM, 1, 4) AS NM,
           c.TOT_PAY_AMT,
           NVL(c.OTO_CARD_ETC, 0) AS OTO_CARD_ETC,
           c.CALC_PROC_CARD, c.CALC_METHOD, c.CALC_PROC_TOTAL,
           m.EMP_NO, m.KEEP_PS
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
    LEFT JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
    WHERE c.CALC_NO LIKE :1
      AND c.CALC_PROC_CARD IS NOT NULL
      AND NVL(c.OTO_CARD_ETC, 0) > 0
    ORDER BY c.CALC_NO
  `, [prefix])

  return rows.map(r => {
    const parsed = parseCardProc(r.CALC_PROC_CARD)
    const lines = CARD_CATS
      .map(cat => ({ code: cat.code, label: cat.label, useAmt: Number(parsed?.catAmts[cat.key] ?? 0) }))
      .filter(l => l.useAmt > 0)
    return {
      calcNo:    r.CALC_NO,
      nm:        r.NM,
      totPayAmt: Number(r.TOT_PAY_AMT),
      cardDdc:   Number(r.OTO_CARD_ETC),   // YTS 카드소득공제 (비교 기준)
      empNo:     r.EMP_NO ?? "-",
      calcType:  calcMethodLabel(r.CALC_METHOD),
      workStatus: workStatusLabel(r.KEEP_PS),
      calcProcTotal: r.CALC_PROC_TOTAL,
      lines,
    }
  })
}
