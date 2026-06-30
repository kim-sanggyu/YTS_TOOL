import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { yttsDb } from "@/lib/db/oracle"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  // CLOB(NOTES)은 GROUP BY 불가 → 집계는 서브쿼리로 분리
  const rows = await yttsDb.query(`
    SELECT
      g.GROUP_ID, g.GROUP_NAME, g.YEAR_CD, g.NOTES, g.SORT_ORDER,
      NVL(c.TOTAL_COUNT, 0) AS TOTAL_COUNT,
      NVL(c.DONE_COUNT,  0) AS DONE_COUNT
    FROM TASK_GROUP g
    LEFT JOIN (
      SELECT GROUP_ID,
             COUNT(*) AS TOTAL_COUNT,
             SUM(CASE WHEN STATUS = '완료' THEN 1 ELSE 0 END) AS DONE_COUNT
      FROM TASK_ITEM
      GROUP BY GROUP_ID
    ) c ON c.GROUP_ID = g.GROUP_ID
    ORDER BY g.SORT_ORDER, g.GROUP_ID
  `)
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { groupName, yearCd } = await req.json()
  if (!groupName?.trim()) return NextResponse.json({ error: "구분명 필수" }, { status: 400 })

  const [{ NEXTVAL }] = await yttsDb.query<{ NEXTVAL: number }>(
    `SELECT TASK_GROUP_SEQ.NEXTVAL AS NEXTVAL FROM DUAL`
  )
  await yttsDb.execute(
    `INSERT INTO TASK_GROUP (GROUP_ID, GROUP_NAME, YEAR_CD, CREATED_BY)
     VALUES (:1, :2, :3, :4)`,
    [NEXTVAL, groupName.trim(), yearCd ?? null, session.user?.name ?? session.user?.email]
  )
  return NextResponse.json({ ok: true, id: NEXTVAL })
}
