import { NextRequest, NextResponse } from "next/server"
import {
  getHwpFile, getLatestHwpFile,
  getTaxRows, getJavaRows,
  getTaxSectConfig,
  buildCompareRows, calcSummary,
} from "@/lib/tax-oracle"
import { auth } from "@/auth"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const userId    = parseInt(session.user?.id ?? "0")
  const record    = req.nextUrl.searchParams.get("record") ?? "A"
  const yearParam = parseInt(req.nextUrl.searchParams.get("year") ?? "0")

  const hwp = yearParam
    ? await getHwpFile(yearParam, userId)
    : await getLatestHwpFile(userId)

  if (!hwp) {
    return NextResponse.json({
      rows: [], summary: { taxBytes: 0, javaBytes: 0, errors: 0 },
      year: null, sectConfig: null,
    })
  }

  const [taxRows, javaRows, sectConfig] = await Promise.all([
    getTaxRows(hwp.year, userId, record),
    getJavaRows(hwp.year, userId, record),
    getTaxSectConfig(hwp.year, userId, record, "TAX"),
  ])

  const rows    = buildCompareRows(taxRows, javaRows)
  const summary = calcSummary(rows)

  return NextResponse.json({ rows, summary, year: hwp.year, sectConfig })
}

export async function PATCH(req: NextRequest) {
  if (!(await auth())) return NextResponse.json({ message: "인증 필요" }, { status: 401 })
  // TODO: MLAY_COMPARE 저장 (향후 구현)
  return NextResponse.json({ ok: true })
}
