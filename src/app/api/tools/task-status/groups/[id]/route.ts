import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { yttsDb } from "@/lib/db/oracle"

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { id } = await params
  const { groupName, yearCd, notes } = await req.json()

  await yttsDb.execute(
    `UPDATE TASK_GROUP SET GROUP_NAME=:1, YEAR_CD=:2, NOTES=:3 WHERE GROUP_ID=:4`,
    [groupName, yearCd ?? null, notes ?? null, id]
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { id } = await params

  // 첨부파일 경로 수집 후 물리 파일 삭제
  const files = await yttsDb.query<{ FILE_PATH: string }>(
    `SELECT f.FILE_PATH FROM TASK_FILE f
     JOIN TASK_ITEM i ON i.ITEM_ID = f.ITEM_ID
     WHERE i.GROUP_ID = :1`,
    [id]
  )
  if (files.length > 0) {
    const { unlink } = await import("fs/promises")
    const path = await import("path")
    const uploadDir = path.join(process.cwd(), "uploads", "task-files")
    await Promise.allSettled(
      files.map(f => unlink(path.join(uploadDir, f.FILE_PATH)))
    )
  }

  await yttsDb.execute(`DELETE FROM TASK_GROUP WHERE GROUP_ID=:1`, [id])
  return NextResponse.json({ ok: true })
}
