import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { getAllItems } from "@/features/hometax-calc/lib/allList"
import { getGiftItems } from "@/features/hometax-calc/lib/giftList"
import { getCardItems } from "@/features/hometax-calc/lib/cardList"
import { getMediItems } from "@/features/hometax-calc/lib/mediList"
import { getPensionItems } from "@/features/hometax-calc/lib/pensionList"
import { getEtcItems } from "@/features/hometax-calc/lib/etcList"
import { getPersonalItems } from "@/features/hometax-calc/lib/personalList"
import { getHousingItems, getHousingSavingsItems, getOtherIncomeItems, getEtcCreditItems, getTaxCutItems, getInsuranceItems, getEducationItems } from "@/features/hometax-calc/lib/housingList"
import { getInvestmentItems } from "@/features/hometax-calc/lib/investmentList"

export const revalidate = 0

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증 필요" }, { status: 401 })

  const year    = req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear())
  const ntsYear = (req.nextUrl.searchParams.get("ntsYear") ?? year).trim()
  const type    = req.nextUrl.searchParams.get("type")

  if (type === "gift")    return Response.json({ items: await getGiftItems(year, ntsYear) })
  if (type === "card")    return Response.json({ items: await getCardItems(year) })
  if (type === "medi")    return Response.json({ items: await getMediItems(year) })
  if (type === "pension") return Response.json({ items: await getPensionItems(year) })
  if (type === "etc")     return Response.json({ items: await getEtcItems(year) })
  if (type === "personal") {
    const group = req.nextUrl.searchParams.get("group")
    const kind  = group === "credit" ? "세액공제" : group === "income" ? "소득공제" : undefined
    return Response.json({ items: await getPersonalItems(year, kind) })
  }
  if (type === "housing") return Response.json({ items: await getHousingItems(year) })
  if (type === "housingsavings") return Response.json({ items: await getHousingSavingsItems(year) })
  if (type === "otherincome") return Response.json({ items: await getOtherIncomeItems(year) })
  if (type === "etccredit") return Response.json({ items: await getEtcCreditItems(year) })
  if (type === "taxcut")    return Response.json({ items: await getTaxCutItems(year) })
  if (type === "insurance") return Response.json({ items: await getInsuranceItems(year) })
  if (type === "education") return Response.json({ items: await getEducationItems(year) })
  if (type === "investment") return Response.json({ items: await getInvestmentItems(year, ntsYear) })

  return Response.json({ items: await getAllItems(year) })
}
