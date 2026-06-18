import { sajaList } from "@/features/dashboard/lib/sajaseongeo"

export const revalidate = 86400 // 24시간 캐시

const PER_DAY = 10

export async function GET() {
  // KST(UTC+9) 기준 일 인덱스
  const kstMs = Date.now() + 9 * 60 * 60 * 1000
  const dayIndex = Math.floor(kstMs / 86400000)

  const totalPages = Math.ceil(sajaList.length / PER_DAY)
  const page = dayIndex % totalPages
  const start = page * PER_DAY

  let daily = sajaList.slice(start, start + PER_DAY)

  // 마지막 페이지가 10개 미만이면 앞에서 채움
  if (daily.length < PER_DAY) {
    daily = [...daily, ...sajaList.slice(0, PER_DAY - daily.length)]
  }

  return Response.json(daily)
}
