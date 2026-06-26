import { NextRequest, NextResponse } from "next/server"
import {
  getHwpFile, getLatestHwpFile, getTaxRows, getJavaRows, getJavaCodeEdits,
  buildCompareRowsFromMap,
} from "@/lib/tax-oracle"
import { auth } from "@/auth"
import { buildAlignedOutput } from "@/features/media-layout/lib/make-str-builder"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const userId = parseInt(session.user?.id ?? "0")
  const { record, year: yearParam } = await req.json()

  const hwp = yearParam
    ? await getHwpFile(yearParam, userId)
    : await getLatestHwpFile(userId)
  if (!hwp) {
    return NextResponse.json(
      { message: "업로드된 데이터가 없습니다. 먼저 HWP 파일을 업로드하세요." },
      { status: 400 }
    )
  }

  const [taxRows, javaRows, edits] = await Promise.all([
    getTaxRows(hwp.year, userId, record),
    getJavaRows(hwp.year, userId, record),
    getJavaCodeEdits(hwp.year, userId, record),
  ])

  const rows = await buildCompareRowsFromMap(hwp.year, userId, record, taxRows, javaRows, edits) ?? []
  if (rows.length === 0) {
    return NextResponse.json({ message: "비교 데이터가 없습니다." }, { status: 400 })
  }

  const { displaySections, downloadCode, totalBytes } = buildAlignedOutput(rows)

  return NextResponse.json({
    code:     downloadCode,
    sections: displaySections,
    lines:    downloadCode.split("\n").length,
    bytes:    totalBytes,
  })
}
