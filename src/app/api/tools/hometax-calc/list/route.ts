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
  const calcNo  = req.nextUrl.searchParams.get("calcNo") ?? undefined   // 지정 시 그 1명만 반환 — 재비교 후 해당 행 list refresh용. SQL WHERE 로 1건만 조회

  // calcNo 있으면 그 행만 필터(재비교 단건 갱신). 없으면 전체.
  // ※ SQL WHERE(각 get*Items 의 calcNo 인자)로 이미 1건만 조회하나, 안전망으로 메모리 필터도 유지(SQL 누락 방지).
  const json = (items: { calcNo: string }[]) =>
    Response.json({ items: calcNo ? items.filter(i => i.calcNo === calcNo) : items })

  if (type === "gift")    return json(await getGiftItems(year, ntsYear, calcNo))
  if (type === "card")    return json(await getCardItems(year, calcNo))
  if (type === "medi")    return json(await getMediItems(year, calcNo))
  if (type === "pension") return json(await getPensionItems(year, calcNo))
  if (type === "etc")     return json(await getEtcItems(year, calcNo))
  if (type === "personal") {
    const group = req.nextUrl.searchParams.get("group")
    const kind  = group === "credit" ? "세액공제" : group === "income" ? "소득공제" : undefined
    return json(await getPersonalItems(year, kind, calcNo))
  }
  if (type === "housing") return json(await getHousingItems(year, calcNo))
  if (type === "housingsavings") return json(await getHousingSavingsItems(year, calcNo))
  if (type === "otherincome") return json(await getOtherIncomeItems(year, calcNo))
  if (type === "etccredit") return json(await getEtcCreditItems(year, calcNo))
  if (type === "taxcut")    return json(await getTaxCutItems(year, calcNo))
  if (type === "insurance") return json(await getInsuranceItems(year, calcNo))
  if (type === "education") return json(await getEducationItems(year, calcNo))
  if (type === "investment") return json(await getInvestmentItems(year, ntsYear, calcNo))

  return json(await getAllItems(year, calcNo))
}
