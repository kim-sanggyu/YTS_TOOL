import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { ytsDb } from "@/lib/db/oracle"
import { giftNtsCode, giftTypeLabel, giftTypeRank } from "@/features/hometax-calc/mapping/gift"

export const revalidate = 0

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증 필요" }, { status: 401 })

  const year   = req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear())
  const type   = req.nextUrl.searchParams.get("type")
  const prefix = `X${year}%`
  const dataYear = Number(year)

  if (type === "gift") {
    // 세액계산된 건(PAY_WRK_CALC 존재)의 기부금 유형×연도별 라인.
    // YTS 공제금액 = GIFT_SUB_AMT, 보낼 대상금액 = GIFT_ABLE_SUB_AMT.
    const rows = await ytsDb.query<{
      CALC_NO: string; NM: string; TOT_PAY_AMT: number
      GIFT_CLS: string; GIFT_YY: string
      GIFT_ABLE_SUB_AMT: number; GIFT_SUB_AMT: number
    }>(`
      SELECT c.CALC_NO,
             SUBSTR(f.NM, 1, 4) AS NM,
             c.TOT_PAY_AMT,
             g.GIFT_CLS, g.GIFT_YY,
             g.GIFT_ABLE_SUB_AMT, g.GIFT_SUB_AMT
      FROM YTS39.PAY_WRK_CALC c
      JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
      JOIN YTS39.PAY_WRK_GIFT_ADJ g ON g.CALC_NO = c.CALC_NO
      WHERE c.CALC_NO LIKE :1
      ORDER BY c.CALC_NO
    `, [prefix])

    // CALC_NO 단위로 그룹핑
    interface GiftLine { code: string | null; giftCls: string; label: string; giftYy: string; ytsSub: number; ableSub: number }
    interface GiftItem { calcNo: string; nm: string; totPayAmt: number; giftTax: number; lines: GiftLine[] }
    const map = new Map<string, GiftItem>()

    for (const r of rows) {
      let item = map.get(r.CALC_NO)
      if (!item) {
        item = { calcNo: r.CALC_NO, nm: r.NM, totPayAmt: Number(r.TOT_PAY_AMT), giftTax: 0, lines: [] }
        map.set(r.CALC_NO, item)
      }
      const diff = dataYear - Number(r.GIFT_YY)
      const sub  = Number(r.GIFT_SUB_AMT ?? 0)
      item.giftTax += sub
      item.lines.push({
        code:    giftNtsCode(r.GIFT_CLS, diff),
        giftCls: r.GIFT_CLS,
        label:   giftTypeLabel(r.GIFT_CLS),
        giftYy:  String(r.GIFT_YY),
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

    return Response.json({ items })
  }

  const rows = await ytsDb.query<{
    CALC_NO: string; NM: string
    TOT_PAY_AMT: number; PROD_TAX_AMT: number; RES_INCM_TAX: number; EFFCTV_TAX_RATE: number
  }>(`
    SELECT c.CALC_NO,
           SUBSTR(f.NM, 1, 4) AS NM,
           c.TOT_PAY_AMT,
           c.PROD_TAX_AMT,
           c.RES_INCM_TAX,
           c.EFFCTV_TAX_RATE
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
    WHERE c.CALC_NO LIKE :1
    ORDER BY c.CALC_NO
  `, [prefix])

  return Response.json({
    items: rows.map(r => ({
      calcNo:        r.CALC_NO,
      nm:            r.NM,
      totPayAmt:     Number(r.TOT_PAY_AMT),
      prodTaxAmt:    Number(r.PROD_TAX_AMT),
      resIncmTax:    Number(r.RES_INCM_TAX),
      effctvTaxRate: Number(r.EFFCTV_TAX_RATE),
    })),
  })
}
