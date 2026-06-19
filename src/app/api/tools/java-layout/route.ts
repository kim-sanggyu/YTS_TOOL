import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { parseJavaLayout } from "@/features/media-layout/lib/java-layout-parser"
import { getJavaFile, getAllJavaRows, saveJavaFile, initMapFromDB } from "@/lib/tax-oracle"
import { yttsDb } from "@/lib/db/oracle"

function getUserId(session: { user?: { id?: string } | null } | null): number {
  return parseInt(session?.user?.id ?? "0")
}

// GET: 업로드 파일 정보 + 전체 행 조회
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const year   = parseInt(req.nextUrl.searchParams.get("year") ?? "0")
  const userId = getUserId(session)
  if (!year) return NextResponse.json({ upload: null, rows: [] })

  const [upload, rows] = await Promise.all([
    getJavaFile(year, userId),
    getAllJavaRows(year, userId),
  ])
  return NextResponse.json({ upload, rows })
}

// POST: Java 파일 업로드 + 파싱 + Oracle 저장
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  try {
    const form     = await req.formData()
    const yearStr  = form.get("year") as string | null
    const javaFile = form.get("java") as File | null

    if (!yearStr)  return NextResponse.json({ message: "연도를 입력하세요." }, { status: 400 })
    if (!javaFile) return NextResponse.json({ message: "Java 파일이 없습니다." }, { status: 400 })

    const year = parseInt(yearStr)
    if (isNaN(year) || year < 2000 || year > 2100)
      return NextResponse.json({ message: "연도가 올바르지 않습니다." }, { status: 400 })

    const userId = getUserId(session)
    const text   = await javaFile.text()
    const { fields } = parseJavaLayout(text)
    await saveJavaFile(userId, year, javaFile.name, null, text, fields)
    await initMapFromDB(year, userId)

    return NextResponse.json({ rows: fields.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : "파싱 오류"
    return NextResponse.json({ message }, { status: 500 })
  }
}

// DELETE: 특정 연도 Java 데이터 삭제
export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const year   = parseInt(req.nextUrl.searchParams.get("year") ?? "0")
  const userId = getUserId(session)
  if (!year) return NextResponse.json({ message: "연도를 입력하세요." }, { status: 400 })

  const { rowsAffected } = await yttsDb.execute(
    `DELETE FROM MLAY_JAVA_FILE WHERE YEAR = :1 AND USER_ID = :2`,
    [year, userId]
  )
  // JAVA_SEQ 참조가 무효화되므로 MAP 삭제
  await yttsDb.execute(
    `DELETE FROM MLAY_TAX_JAVA_MAP WHERE YEAR = :1 AND USER_ID = :2`,
    [year, userId]
  )
  await yttsDb.execute(
    `DELETE FROM MLAY_COMPARE WHERE YEAR = :1 AND USER_ID = :2`,
    [year, userId]
  )

  return NextResponse.json({ ok: true, deleted: rowsAffected })
}
