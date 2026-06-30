import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { yttsDb } from "@/lib/db/oracle"
import { readFile, unlink } from "fs/promises"
import path from "path"

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "task-files")

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return new Response("Unauthorized", { status: 401 })

  const { id } = await params
  const rows = await yttsDb.query<{ FILE_PATH: string; FILE_NAME: string; MIME_TYPE: string }>(
    `SELECT FILE_PATH, FILE_NAME, MIME_TYPE FROM TASK_FILE WHERE FILE_ID = :1`, [id]
  )
  if (!rows.length) return new Response("Not found", { status: 404 })

  const { FILE_PATH, FILE_NAME, MIME_TYPE } = rows[0]
  try {
    const buffer = await readFile(path.join(UPLOAD_DIR, FILE_PATH))
    return new Response(buffer, {
      headers: {
        "Content-Type": MIME_TYPE || "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(FILE_NAME)}`,
      },
    })
  } catch {
    return new Response("File not found", { status: 404 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { id } = await params
  const rows = await yttsDb.query<{ FILE_PATH: string }>(
    `SELECT FILE_PATH FROM TASK_FILE WHERE FILE_ID = :1`, [id]
  )
  if (rows.length) {
    try { await unlink(path.join(UPLOAD_DIR, rows[0].FILE_PATH)) } catch { /* 이미 없음 */ }
  }
  await yttsDb.execute(`DELETE FROM TASK_FILE WHERE FILE_ID = :1`, [id])
  return NextResponse.json({ ok: true })
}
