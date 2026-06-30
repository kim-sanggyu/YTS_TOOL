import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { yttsDb } from "@/lib/db/oracle"

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { id } = await params

  const files = await yttsDb.query<{ FILE_PATH: string }>(
    `SELECT FILE_PATH FROM TASK_FILE WHERE LOG_ID = :1`, [id]
  )
  if (files.length > 0) {
    const { unlink } = await import("fs/promises")
    const path = await import("path")
    const uploadDir = path.join(process.cwd(), "uploads", "task-files")
    await Promise.allSettled(
      files.map(f => unlink(path.join(uploadDir, f.FILE_PATH)))
    )
  }

  await yttsDb.execute(`DELETE FROM TASK_LOG WHERE LOG_ID = :1`, [id])
  return NextResponse.json({ ok: true })
}
