import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { SCRIPT_META } from "@/features/tax-calculate/data-migration/lib/scripts"
import { query } from "@/lib/db/oracle"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const fromYear = searchParams.get("fromYear") ?? String(new Date().getFullYear() - 1)
  const toYear = searchParams.get("toYear") ?? String(new Date().getFullYear())

  const counts = await Promise.all(
    SCRIPT_META.map(async ({ table }) => {
      const [fromRow, toRow] = await Promise.all([
        query<{ CNT: number }>("yts", `SELECT COUNT(*) AS CNT FROM ${table} WHERE CALC_NO LIKE '%Y${fromYear}%'`),
        query<{ CNT: number }>("yts", `SELECT COUNT(*) AS CNT FROM ${table} WHERE CALC_NO LIKE 'X${toYear}%'`),
      ])
      return {
        table,
        fromCount: Number(fromRow[0]?.CNT ?? 0),
        toCount: Number(toRow[0]?.CNT ?? 0),
      }
    })
  )

  return NextResponse.json(counts)
}
