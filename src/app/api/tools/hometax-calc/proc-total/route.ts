import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { getProcTotal } from "@/features/hometax-calc/lib/procTotal"

export const revalidate = 0

// 계산과정(CALC_PROC_TOTAL) 단건 조회 — 목록 쿼리에서 뺀 CLOB을 팝업/드로어 열 때만 lazy 로드.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증 필요" }, { status: 401 })

  const calcNo = req.nextUrl.searchParams.get("calcNo")
  if (!calcNo) return Response.json({ error: "calcNo 필요" }, { status: 400 })

  return Response.json({ text: await getProcTotal(calcNo) })
}
