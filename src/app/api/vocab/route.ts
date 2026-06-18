import { vocabList } from "@/features/dashboard/lib/vocabulary"

export const revalidate = 86400

const PER_DAY = 20

export async function GET() {
  const kstMs = Date.now() + 9 * 60 * 60 * 1000
  const dayIndex = Math.floor(kstMs / 86400000)

  const totalPages = Math.ceil(vocabList.length / PER_DAY)
  const page = dayIndex % totalPages
  const start = page * PER_DAY

  let daily = vocabList.slice(start, start + PER_DAY)
  if (daily.length < PER_DAY) {
    daily = [...daily, ...vocabList.slice(0, PER_DAY - daily.length)]
  }

  return Response.json(daily)
}
