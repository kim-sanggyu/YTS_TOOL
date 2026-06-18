import { NextRequest, NextResponse } from "next/server"
import { parseHwpBuffer } from "@/features/media-layout/lib/hwp-parser"
import { parseJavaLayout } from "@/features/media-layout/lib/java-layout-parser"
import { getHwpFile, getJavaFile, saveHwpFile, saveJavaFile } from "@/lib/tax-oracle"
import { yttsDb } from "@/lib/db/oracle"
import { auth } from "@/auth"

function getUserId(session: { user?: { id?: string } | null } | null): number {
  return parseInt(session?.user?.id ?? "0")
}

// GET: 특정 연도 업로드 정보 확인
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const year   = parseInt(req.nextUrl.searchParams.get("year") ?? "0")
  const userId = getUserId(session)
  if (!year) return NextResponse.json({ exists: false, upload: null })

  const [hwp, java] = await Promise.all([
    getHwpFile(year, userId),
    getJavaFile(year, userId),
  ])
  return NextResponse.json({ exists: !!hwp, upload: hwp, javaUpload: java })
}

// POST: HWP 및/또는 Java 파일 업로드 + 파싱 + Oracle 저장
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  try {
    const form    = await req.formData()
    const yearStr = form.get("year") as string | null
    const hwpFile = form.get("hwp")  as File | null
    const javaFile= form.get("java") as File | null

    if (!yearStr) return NextResponse.json({ message: "연도를 입력하세요." }, { status: 400 })
    if (!hwpFile && !javaFile) return NextResponse.json({ message: "HWP 또는 Java 파일이 필요합니다." }, { status: 400 })

    const year   = parseInt(yearStr)
    if (isNaN(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ message: "연도가 올바르지 않습니다." }, { status: 400 })
    }

    const userId = getUserId(session)
    console.log(`[upload] year=${year} userId=${userId} hwp=${hwpFile?.name ?? "-"} java=${javaFile?.name ?? "-"}`)
    const result: Record<string, unknown> = { year }

    // HWP 파일 처리
    if (hwpFile) {
      const buffer = Buffer.from(await hwpFile.arrayBuffer())
      const { fields } = parseHwpBuffer(buffer)
      await saveHwpFile(userId, year, hwpFile.name, null, buffer, fields)
      result.hwpRows = fields.length
    }

    // Java 파일 처리
    if (javaFile) {
      const text = await javaFile.text()
      const { fields } = parseJavaLayout(text)
      await saveJavaFile(userId, year, javaFile.name, null, text, fields)
      result.javaRows = fields.length
    }

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : "파싱 오류"
    console.error(`[upload] 오류:`, err)
    return NextResponse.json({ message }, { status: 500 })
  }
}

// DELETE: 특정 연도 HWP 업로드 데이터 삭제 (MLAY_TAX CASCADE)
export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const year   = parseInt(req.nextUrl.searchParams.get("year") ?? "0")
  const userId = getUserId(session)

  if (!year) return NextResponse.json({ message: "연도를 입력하세요." }, { status: 400 })

  const { rowsAffected } = await yttsDb.execute(
    `DELETE FROM MLAY_HWP_FILE WHERE YEAR = :1 AND USER_ID = :2`,
    [year, userId]
  )
  // MLAY_COMPARE도 함께 정리
  await yttsDb.execute(
    `DELETE FROM MLAY_COMPARE WHERE YEAR = :1 AND USER_ID = :2`,
    [year, userId]
  )

  return NextResponse.json({ ok: true, deleted: rowsAffected })
}
