import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { ytsDb } from "@/lib/db/oracle"
import { getGiftItems } from "@/features/hometax-calc/lib/giftList"
import { getCardItems } from "@/features/hometax-calc/lib/cardList"
import { getMediItems } from "@/features/hometax-calc/lib/mediList"
import { getPensionItems } from "@/features/hometax-calc/lib/pensionList"

export const revalidate = 0

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증 필요" }, { status: 401 })

  const year   = req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear())
  const type   = req.nextUrl.searchParams.get("type")
  const prefix = `X${year}%`

  if (type === "gift")    return Response.json({ items: await getGiftItems(year) })
  if (type === "card")    return Response.json({ items: await getCardItems(year) })
  if (type === "medi")    return Response.json({ items: await getMediItems(year) })
  if (type === "pension") return Response.json({ items: await getPensionItems(year) })

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
