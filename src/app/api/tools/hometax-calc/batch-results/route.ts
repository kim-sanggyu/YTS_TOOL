import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { loadBatchResults, deleteBatchResults, slimResultForList } from "@/features/hometax-calc/lib/batchResultStore"

export const dynamic = "force-dynamic"

const ATTR_YR = "2025"

// (year, ntsYear)에 대해 저장된 마지막 비교결과(calcNo별)를 반환.
// 화면 마운트/파라미터 변경 시 이걸 읽어 results state를 복원한다.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증이 필요합니다." }, { status: 401 })

  const year    = req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear())
  const ntsYear = (req.nextUrl.searchParams.get("ntsYear") ?? ATTR_YR).trim()

  const store = loadBatchResults(year, ntsYear)
  if (!store) return Response.json({ savedAt: null, rows: [] })

  // 목록 페이로드 슬림화: 드로어 전용 IN/OUT·미사용 inputs 제거(24MB→수 MB). 상세는 batch-results/detail에서 lazy.
  const rows = Object.values(store.rows).map(r =>
    r.result ? { ...r, result: slimResultForList(r.result) } : r)

  return Response.json({ savedAt: store.savedAt, rows })
}

// 저장된 이전 실행 결과(해당 year+ntsYear) 삭제.
export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증이 필요합니다." }, { status: 401 })

  const year    = req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear())
  const ntsYear = (req.nextUrl.searchParams.get("ntsYear") ?? ATTR_YR).trim()

  deleteBatchResults(year, ntsYear)
  return Response.json({ ok: true })
}
