import { NextRequest, NextResponse } from "next/server"
import { getAllTaxRows, getAllTaxSectConfigs, updateTaxRows } from "@/lib/tax-oracle"
import { auth } from "@/auth"

// GET: 귀속연도의 전체 MLAY_TAX 행 반환
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const year   = parseInt(req.nextUrl.searchParams.get("year") ?? "0")
  const userId = parseInt((session.user as { id?: string }).id ?? "0")

  if (!year) return NextResponse.json({ rows: [], sectConfigs: {} })

  const [rows, sectConfigs] = await Promise.all([
    getAllTaxRows(year, userId),
    getAllTaxSectConfigs(year, userId, "TAX"),
  ])
  return NextResponse.json({ rows, sectConfigs })
}

// PATCH: 수정된 행 일괄 업데이트
export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const userId = parseInt((session.user as { id?: string }).id ?? "0")
  const { year, updates } = await req.json()

  if (!year || !Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ message: "필수 값 누락" }, { status: 400 })
  }

  await updateTaxRows(year, userId, updates)
  return NextResponse.json({ ok: true, updated: updates.length })
}
