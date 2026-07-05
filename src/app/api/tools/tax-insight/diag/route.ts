import { NextResponse } from "next/server"
import { ytsDb } from "@/lib/db/oracle"

// 임시 진단 라우트 — 사용 후 삭제
export async function GET() {
  try {
    const rows = await ytsDb.query<{
      CALC_NO: string
      TAIL: string | null
    }>(`
      SELECT CALC_NO,
        SUBSTR(CALC_PROC_TOTAL, LENGTH(CALC_PROC_TOTAL) - 300) AS TAIL
      FROM YTS39.PAY_WRK_CALC
      WHERE CALC_NO LIKE 'X2026%'
        AND CALC_PROC_TOTAL IS NOT NULL
        AND CALC_NO IN ('X202600414', 'X202600166', 'X202600538', 'X202600001')
    `)

    return NextResponse.json({ rows })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
