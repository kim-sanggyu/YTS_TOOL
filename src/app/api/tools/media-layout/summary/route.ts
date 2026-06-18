import { NextRequest, NextResponse } from "next/server"
import { getMediaSummary } from "@/lib/tax-oracle"
import { auth } from "@/auth"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const year   = parseInt(req.nextUrl.searchParams.get("year") ?? "0")
  const userId = parseInt(session.user?.id ?? "0")

  if (!year) return NextResponse.json({ hwpFile: null, javaFile: null, taxBytes: {}, javaBytes: {}, sectConfigs: {} })

  const summary = await getMediaSummary(year, userId)
  return NextResponse.json(summary)
}
