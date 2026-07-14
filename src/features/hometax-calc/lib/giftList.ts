import { ytsDb } from "@/lib/db/oracle"
import { giftCarryDiff, giftNtsCode, giftTypeLabel, giftTypeRank } from "@/features/hometax-calc/mapping/gift"
import { exhaustInfo } from "@/features/hometax-calc/lib/exhaust"
import { calcMethodLabel, workStatusLabel } from "@/features/hometax-calc/lib/personInfo"

export interface GiftLine { code: string | null; giftCls: string; label: string; giftYy: string; ytsSub: number; ableSub: number }
export interface GiftListItem {
  calcNo: string; nm: string; totPayAmt: number; giftTax: number
  exhausted: boolean; exhaustLabel: string | null
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  lines: GiftLine[]
}

// 세액계산된 건(PAY_WRK_CALC 존재)의 기부금 유형×연도별 라인.
// YTS 공제금액 = GIFT_SUB_AMT, 보낼 대상금액 = GIFT_ABLE_SUB_AMT.
export async function getGiftItems(year: string, ntsYear: string): Promise<GiftListItem[]> {
  const prefix = `X${year}%`
  const dataYear = Number(year)
  const ntsBase  = Number(ntsYear)   // 국세청 귀속연도(이월 연차 기준)

  const rows = await ytsDb.query<{
    CALC_NO: string; NM: string; TOT_PAY_AMT: number; EXHAUSTED_POINT: string | null
    CALC_METHOD: string | null; CALC_PROC_TOTAL: string | null
    EMP_NO: string | null; KEEP_PS: string | null
    GIFT_CLS: string; GIFT_YY: string
    GIFT_ABLE_SUB_AMT: number; GIFT_SUB_AMT: number
  }>(`
    SELECT c.CALC_NO,
           SUBSTR(f.NM, 1, 4) AS NM,
           c.TOT_PAY_AMT, c.EXHAUSTED_POINT, c.CALC_METHOD, c.CALC_PROC_TOTAL,
           m.EMP_NO, m.KEEP_PS,
           g.GIFT_CLS, g.GIFT_YY,
           g.GIFT_ABLE_SUB_AMT, g.GIFT_SUB_AMT
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
    LEFT JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
    JOIN YTS39.PAY_WRK_GIFT_ADJ g ON g.CALC_NO = c.CALC_NO
    WHERE c.CALC_NO LIKE :1
    ORDER BY c.CALC_NO
  `, [prefix])

  // CALC_NO 단위로 그룹핑
  const map = new Map<string, GiftListItem>()

  for (const r of rows) {
    let item = map.get(r.CALC_NO)
    if (!item) {
      const ex = exhaustInfo(r.EXHAUSTED_POINT)
      item = {
        calcNo: r.CALC_NO, nm: r.NM, totPayAmt: Number(r.TOT_PAY_AMT), giftTax: 0,
        exhausted: ex.exhausted, exhaustLabel: ex.exhaustLabel,
        empNo: r.EMP_NO ?? "-", calcType: calcMethodLabel(r.CALC_METHOD), workStatus: workStatusLabel(r.KEEP_PS),
        calcProcTotal: r.CALC_PROC_TOTAL,
        lines: [],
      }
      map.set(r.CALC_NO, item)
    }
    const yy   = Number(r.GIFT_YY)
    const diff = giftCarryDiff(yy, dataYear, ntsBase)   // 국세청 귀속연도 기준 이월 연차(당해=0)
    const sub  = Number(r.GIFT_SUB_AMT ?? 0)
    item.giftTax += sub
    item.lines.push({
      code:    giftNtsCode(r.GIFT_CLS, diff),
      giftCls: r.GIFT_CLS,
      label:   giftTypeLabel(r.GIFT_CLS),
      giftYy:  String(ntsBase - diff),   // 국세청 기준 표시연도(당해→ntsYear, 이월→실제 기부연도)
      ytsSub:  sub,
      ableSub: Number(r.GIFT_ABLE_SUB_AMT ?? 0),
    })
  }

  // 라인 정렬: 유형 rank → 연도 내림차순(당해 먼저)
  const items = [...map.values()]
  for (const it of items) {
    it.lines.sort((a, b) =>
      giftTypeRank(a.giftCls) - giftTypeRank(b.giftCls) || Number(b.giftYy) - Number(a.giftYy)
    )
  }

  return items
}
