import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { loadResultDetail } from "@/features/hometax-calc/lib/batchResultStore"

export const dynamic = "force-dynamic"

const ATTR_YR = "2025"

// 드로어용 IN/OUT 상세 단건 — 목록 페이로드에서 뺀 ntsIn/ntsOut을 그 한 명치만 반환(실행과정 드로어 열 때 lazy).
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증이 필요합니다." }, { status: 401 })

  const year    = req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear())
  const ntsYear = (req.nextUrl.searchParams.get("ntsYear") ?? ATTR_YR).trim()
  const calcNo  = req.nextUrl.searchParams.get("calcNo")
  if (!calcNo) return Response.json({ error: "calcNo 필요" }, { status: 400 })

  return Response.json(loadResultDetail(year, ntsYear, calcNo) ?? { ntsIn: [], ntsOut: [] })
}
