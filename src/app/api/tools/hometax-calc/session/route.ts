import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { startNtsSession, stopNtsSession, getNtsSessionInfo } from "@/features/hometax-calc/lib/runHometaxCalc"

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증 필요" }, { status: 401 })
  // 세션은 귀속연도별로 분리 저장 — 조회 연도를 명시(미지정 시 lib 기본값 유지)
  const year = req.nextUrl.searchParams.get("year") ?? undefined
  return Response.json(getNtsSessionInfo(year))
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증 필요" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { action?: string; year?: string }

  if (body.action === "start") {
    // 화면 드롭다운 연도(ntsYear)로 세션 수립 — 전체 실행이 쓸 세션과 동일 연도여야 브라우저 1개로 공유됨
    await startNtsSession(body.year)
    return Response.json(getNtsSessionInfo(body.year))
  }
  if (body.action === "stop") {
    stopNtsSession(body.year)
    return Response.json({ active: false, ageMinutes: null })
  }

  return Response.json({ error: "action 필요 (start | stop)" }, { status: 400 })
}
