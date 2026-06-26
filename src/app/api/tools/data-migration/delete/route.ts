import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { withConnection } from "@/lib/db/oracle"
import { DELETE_ORDER } from "@/features/tax-calculate/data-migration/lib/scripts"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { tables, toYear }: { tables: string[]; toYear: string } = await req.json()

  const orderedTables = DELETE_ORDER.filter(t => tables.includes(t))

  try {
    const results = await withConnection("yts", async (conn) => {
      const summary: { table: string; deleted: number }[] = []
      for (const table of orderedTables) {
        const result = await conn.execute(
          `DELETE FROM ${table} WHERE CALC_NO LIKE :cond`,
          [`X${toYear}%`]
        )
        summary.push({ table, deleted: result.rowsAffected ?? 0 })
      }
      return summary
    })

    const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0)
    return NextResponse.json({ success: true, results, totalDeleted })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
