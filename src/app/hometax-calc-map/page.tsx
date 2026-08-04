import { MappingStatusView } from "@/features/hometax-calc/components/HometaxCalcPanel"

// 맵현황 전용 팝업 창 — (portal) 그룹 밖이라 사이드바 없이 맵현황만 꽉 차게.
// 기부금 등 다른 탭(메인 창)을 보면서 이 창에 맵현황을 나란히 띄워 대조하는 용도.
// searchParams(Next 16 = Promise)에서 year 를 받아 MappingStatusView 로 라우팅.
const NTS_YEARS = new Set(["2025", "2026"])

export default async function HometaxCalcMapPopupPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>
}) {
  const { year } = await searchParams
  const ntsYear = year && NTS_YEARS.has(year) ? year : "2026"   // 기본=최신연도(NTS_SELECTABLE[0])
  return (
    <div className="h-full min-h-0 flex flex-col">
      <MappingStatusView ntsYear={ntsYear} />
    </div>
  )
}
