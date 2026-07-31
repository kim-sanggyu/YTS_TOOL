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
  const calcNo  = req.nextUrl.searchParams.get("calcNo")   // 지정 시 그 1명만 반환 — 재비교 후 해당 행 list refresh용

  // calcNo 있으면 그 행만 필터(재비교 단건 갱신). 없으면 전체.
  const json = (items: { calcNo: string }[]) =>
    Response.json({ items: calcNo ? items.filter(i => i.calcNo === calcNo) : items })

  if (type === "gift")    return json(await getGiftItems(year, ntsYear))
  if (type === "card")    return json(await getCardItems(year))
  if (type === "medi")    return json(await getMediItems(year))
  if (type === "pension") return json(await getPensionItems(year))
  if (type === "etc")     return json(await getEtcItems(year))
  if (type === "personal") {
    const group = req.nextUrl.searchParams.get("group")
    const kind  = group === "credit" ? "세액공제" : group === "income" ? "소득공제" : undefined
    return json(await getPersonalItems(year, kind))
  }
  if (type === "housing") return json(await getHousingItems(year))
  if (type === "housingsavings") return json(await getHousingSavingsItems(year))
  if (type === "otherincome") return json(await getOtherIncomeItems(year))
  if (type === "etccredit") return json(await getEtcCreditItems(year))
  if (type === "taxcut")    return json(await getTaxCutItems(year))
  if (type === "insurance") return json(await getInsuranceItems(year))
  if (type === "education") return json(await getEducationItems(year))
  if (type === "investment") return json(await getInvestmentItems(year, ntsYear))

  return json(await getAllItems(year))
}
