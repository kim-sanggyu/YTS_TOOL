import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { yttsDb } from "@/lib/db/oracle"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const groupId = new URL(req.url).searchParams.get("groupId")
  if (!groupId) return NextResponse.json({ error: "groupId 필수" }, { status: 400 })

  const rows = await yttsDb.query(`
    SELECT
      ITEM_ID, GROUP_ID, SEQ_NO, CATEGORY, TITLE, IMPL_PLAN,
      STATUS, PRIORITY, ASSIGNEE,
      TO_CHAR(START_DT, 'YYYY-MM-DD') AS START_DT,
      TO_CHAR(END_DT,   'YYYY-MM-DD') AS END_DT,
      REMARKS,
      TO_CHAR(CREATED_AT, 'YYYY-MM-DD HH24:MI') AS CREATED_AT
    FROM TASK_ITEM
    WHERE GROUP_ID = :1
    ORDER BY SEQ_NO, ITEM_ID
  `, [groupId])
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { groupId, title } = await req.json()
  if (!groupId || !title?.trim()) return NextResponse.json({ error: "groupId, title 필수" }, { status: 400 })

  const [{ MAX_SEQ }] = await yttsDb.query<{ MAX_SEQ: number }>(
    `SELECT NVL(MAX(SEQ_NO), 0) AS MAX_SEQ FROM TASK_ITEM WHERE GROUP_ID = :1`, [groupId]
  )
  const [{ NEXTVAL }] = await yttsDb.query<{ NEXTVAL: number }>(
    `SELECT TASK_ITEM_SEQ.NEXTVAL AS NEXTVAL FROM DUAL`
  )
  await yttsDb.execute(
    `INSERT INTO TASK_ITEM (ITEM_ID, GROUP_ID, SEQ_NO, TITLE, CREATED_BY)
     VALUES (:1, :2, :3, :4, :5)`,
    [NEXTVAL, groupId, (MAX_SEQ ?? 0) + 1, title.trim(), session.user?.name ?? session.user?.email]
  )
  return NextResponse.json({ ok: true, id: NEXTVAL })
}
