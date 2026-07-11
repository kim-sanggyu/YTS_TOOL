import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { startNtsSession, stopNtsSession, getNtsSessionInfo } from "@/features/hometax-calc/lib/runHometaxCalc"

export const maxDuration = 60

export async function GET() {
  const session = await auth()
  if (!session) return Response.json({ error: "인증 필요" }, { status: 401 })
  return Response.json(getNtsSessionInfo())
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증 필요" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { action?: string }

  if (body.action === "start") {
    await startNtsSession()
    return Response.json(getNtsSessionInfo())
  }
  if (body.action === "stop") {
    stopNtsSession()
    return Response.json({ active: false, ageMinutes: null })
  }

  return Response.json({ error: "action 필요 (start | stop)" }, { status: 400 })
}
