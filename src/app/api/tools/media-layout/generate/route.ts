import { NextRequest, NextResponse } from "next/server"
import { getLatestHwpFile, getTaxRows, getJavaRows, buildCompareRows } from "@/lib/tax-oracle"
import { auth } from "@/auth"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const userId = parseInt(session.user?.id ?? "0")
  const { record } = await req.json()

  const hwp = await getLatestHwpFile(userId)
  if (!hwp) {
    return NextResponse.json(
      { message: "업로드된 데이터가 없습니다. 먼저 HWP 파일을 업로드하세요." },
      { status: 400 }
    )
  }

  const [taxRows, javaRows] = await Promise.all([
    getTaxRows(hwp.year, userId, record),
    getJavaRows(hwp.year, userId, record),
  ])

  const rows = buildCompareRows(taxRows, javaRows)
  if (rows.length === 0) {
    return NextResponse.json({ message: "비교 데이터가 없습니다." }, { status: 400 })
  }

  const codeLines: string[] = []
  let totalBytes = 0

  for (const row of rows) {
    if (!row.tax || !row.java) continue
    if (row.cmd === "D") continue

    const javaCode = row.java.raw
    const taxCode  = row.tax.코드.padEnd(4)
    codeLines.push(`${javaCode} // ${taxCode} 【${row.tax.항목}】`)
    totalBytes += row.java.len
  }

  codeLines.push('    + "\\n"')

  return NextResponse.json({
    code:  codeLines.join("\n"),
    lines: codeLines.length,
    bytes: totalBytes,
  })
}
