import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { getMediItems, type MediListItem } from "@/features/hometax-calc/lib/mediList"
import { streamCompareBatch } from "@/features/hometax-calc/lib/streamCompareBatch"
import { upsertBatchResults, batchRowToStored, loadBatchResults } from "@/features/hometax-calc/lib/batchResultStore"

export const dynamic = "force-dynamic"
export const maxDuration = 800

const ATTR_YR = "2025"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증이 필요합니다." }, { status: 401 })

  const year    = req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear())
  const ntsYear = (req.nextUrl.searchParams.get("ntsYear") ?? ATTR_YR).trim()
  const sortKey = req.nextUrl.searchParams.get("sortKey")
  const sort = sortKey ? { key: sortKey, dir: (req.nextUrl.searchParams.get("sortDir") === "desc" ? "desc" : "asc") as "asc" | "desc" } : null

  const stream = streamCompareBatch(
    () => getMediItems(year),
    ntsYear,
    rows => {
      upsertBatchResults(year, ntsYear, rows.map(batchRowToStored))
    },
    loadBatchResults(year, ntsYear)?.rows, sort,   // 지문 같은 사람은 국세청 호출 스킵
  )

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection:      "keep-alive",
    },
  })
}
