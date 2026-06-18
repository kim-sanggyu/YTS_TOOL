import { NextRequest, NextResponse } from "next/server"
import { getTaxSectConfig, saveSectConfigWithRows } from "@/lib/tax-oracle"
import { auth } from "@/auth"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const year   = parseInt(req.nextUrl.searchParams.get("year")   ?? "0")
  const record = req.nextUrl.searchParams.get("record") ?? ""
  const target = (req.nextUrl.searchParams.get("target") ?? "TAX") as "TAX" | "JAVA"

  if (!year || !record) return NextResponse.json({ config: null })

  const userId = parseInt(session.user?.id ?? "0")
  return NextResponse.json({ config: await getTaxSectConfig(year, userId, record, target) })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const body = await req.json()
  const { year, record, target = "TAX", sectMode, bodyStart = null, bodyEnd = null, repeatCount = null, sectRows = [] } = body

  if (!year || !record || !sectMode) {
    return NextResponse.json({ message: "필수 값 누락" }, { status: 400 })
  }

  const userId = parseInt(session.user?.id ?? "0")
  await saveSectConfigWithRows(
    { year, userId, record, target, sectMode, bodyStart, bodyEnd, repeatCount },
    sectRows,
  )

  return NextResponse.json({ ok: true })
}
