import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { yttsDb } from "@/lib/db/oracle"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const itemId = new URL(req.url).searchParams.get("itemId")
  if (!itemId) return NextResponse.json({ error: "itemId 필수" }, { status: 400 })

  const rows = await yttsDb.query<Record<string, unknown>>(`
    SELECT
      l.LOG_ID, l.ITEM_ID, l.CONTENT, l.LOGGED_BY,
      TO_CHAR(l.LOGGED_AT, 'YYYY-MM-DD HH24:MI') AS LOGGED_AT,
      f.FILE_ID, f.FILE_NAME, f.MIME_TYPE
    FROM TASK_LOG l
    LEFT JOIN TASK_FILE f ON f.LOG_ID = l.LOG_ID
    WHERE l.ITEM_ID = :1
    ORDER BY l.LOGGED_AT, l.LOG_ID, f.FILE_ID
  `, [itemId])

  // 파일 목록을 각 로그 항목 아래로 병합
  const logsMap = new Map<number, {
    LOG_ID: number; ITEM_ID: number; CONTENT: string
    LOGGED_BY: string | null; LOGGED_AT: string
    FILES: { FILE_ID: number; FILE_NAME: string; MIME_TYPE: string | null }[]
  }>()
  for (const row of rows) {
    const logId = row.LOG_ID as number
    if (!logsMap.has(logId)) {
      logsMap.set(logId, {
        LOG_ID:     logId,
        ITEM_ID:    row.ITEM_ID as number,
        CONTENT:    row.CONTENT as string,
        LOGGED_BY:  row.LOGGED_BY as string | null,
        LOGGED_AT:  row.LOGGED_AT as string,
        FILES: [],
      })
    }
    if (row.FILE_ID) {
      logsMap.get(logId)!.FILES.push({
        FILE_ID:   row.FILE_ID as number,
        FILE_NAME: row.FILE_NAME as string,
        MIME_TYPE: row.MIME_TYPE as string | null,
      })
    }
  }
  return NextResponse.json(Array.from(logsMap.values()))
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { itemId, content } = await req.json()
  if (!itemId || !content?.trim()) return NextResponse.json({ error: "itemId, content 필수" }, { status: 400 })

  const [{ NEXTVAL }] = await yttsDb.query<{ NEXTVAL: number }>(
    `SELECT TASK_LOG_SEQ.NEXTVAL AS NEXTVAL FROM DUAL`
  )
  await yttsDb.execute(
    `INSERT INTO TASK_LOG (LOG_ID, ITEM_ID, CONTENT, LOGGED_BY)
     VALUES (:1, :2, :3, :4)`,
    [NEXTVAL, itemId, content.trim(), session.user?.name ?? session.user?.email]
  )
  return NextResponse.json({ ok: true, logId: NEXTVAL })
}
