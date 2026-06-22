import { NextRequest, NextResponse } from "next/server"
import { getParseLogs } from "@/lib/tax-oracle"
import { auth } from "@/auth"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const year   = parseInt(req.nextUrl.searchParams.get("year") ?? "0")
  const userId = parseInt((session.user as { id?: string })?.id ?? "0")
  if (!year) return NextResponse.json({ logs: [] })

  const logs = await getParseLogs(year, userId)
  return NextResponse.json({ logs })
}
