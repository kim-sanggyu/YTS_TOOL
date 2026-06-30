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
  const body = await req.json()

  await yttsDb.execute(
    `UPDATE TASK_ITEM SET
      CATEGORY  = :1,
      TITLE     = :2,
      IMPL_PLAN = :3,
      STATUS    = :4,
      PRIORITY  = :5,
      ASSIGNEE  = :6,
      START_DT  = TO_DATE(:7, 'YYYY-MM-DD'),
      END_DT    = TO_DATE(:8, 'YYYY-MM-DD'),
      REMARKS   = :9,
      UPDATED_AT = SYSDATE,
      UPDATED_BY = :10
    WHERE ITEM_ID = :11`,
    [
      body.CATEGORY   ?? null,
      body.TITLE,
      body.IMPL_PLAN  ?? null,
      body.STATUS     ?? '미정',
      body.PRIORITY   ?? '보통',
      body.ASSIGNEE   ?? null,
      body.START_DT   ?? null,
      body.END_DT     ?? null,
      body.REMARKS    ?? null,
      session.user?.name ?? session.user?.email,
      id,
    ]
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

  const files = await yttsDb.query<{ FILE_PATH: string }>(
    `SELECT FILE_PATH FROM TASK_FILE WHERE ITEM_ID = :1`, [id]
  )
  if (files.length > 0) {
    const { unlink } = await import("fs/promises")
    const path = await import("path")
    const uploadDir = path.join(process.cwd(), "uploads", "task-files")
    await Promise.allSettled(
      files.map(f => unlink(path.join(uploadDir, f.FILE_PATH)))
    )
  }

  await yttsDb.execute(`DELETE FROM TASK_ITEM WHERE ITEM_ID = :1`, [id])
  return NextResponse.json({ ok: true })
}
