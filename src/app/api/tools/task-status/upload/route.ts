import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { yttsDb } from "@/lib/db/oracle"
import { mkdir, writeFile } from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "task-files")

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const formData = await req.formData()
  const file   = formData.get("file")   as File | null
  const itemId = formData.get("itemId") as string | null
  const logId  = formData.get("logId")  as string | null

  if (!file || !itemId) return NextResponse.json({ error: "file, itemId 필수" }, { status: 400 })

  const bytes  = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  const ext    = path.extname(file.name).toLowerCase()
  const filename = `${randomUUID()}${ext}`

  await mkdir(UPLOAD_DIR, { recursive: true })
  await writeFile(path.join(UPLOAD_DIR, filename), buffer)

  const [{ NEXTVAL }] = await yttsDb.query<{ NEXTVAL: number }>(
    `SELECT TASK_FILE_SEQ.NEXTVAL AS NEXTVAL FROM DUAL`
  )
  await yttsDb.execute(
    `INSERT INTO TASK_FILE (FILE_ID, ITEM_ID, LOG_ID, FILE_NAME, FILE_PATH, FILE_SIZE, MIME_TYPE, UPLOADED_BY)
     VALUES (:1, :2, :3, :4, :5, :6, :7, :8)`,
    [
      NEXTVAL,
      parseInt(itemId),
      logId ? parseInt(logId) : null,
      file.name,
      filename,
      file.size,
      file.type || null,
      session.user?.name ?? session.user?.email,
    ]
  )
  return NextResponse.json({ ok: true, fileId: NEXTVAL })
}
