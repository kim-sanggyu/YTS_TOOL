import { NextResponse } from "next/server"
import { ytsDb } from "@/lib/db/oracle"

// 임시 진단 라우트 — 사용 후 삭제
export async function GET() {
  try {
    const rows = await ytsDb.query<{
      CALC_NO: string
      LENDER_INPUT: number
      HABT_INPUT: number
      LENDER_DED: number
      HABT_DED: number
    }>(`
      SELECT
        c.CALC_NO,
        NVL(m.HOUSE_RALR_LENDER, 0) AS LENDER_INPUT,
        NVL(m.HOUSE_RALR_HABT,   0) AS HABT_INPUT,
        NVL(c.SP_HOUSE_RALR_LENDER_AMT, 0) AS LENDER_DED,
        NVL(c.SP_HOUSE_RALR_HABT_AMT,   0) AS HABT_DED
      FROM YTS39.PAY_WRK_CALC c
      INNER JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
      WHERE c.CALC_NO LIKE 'X2026%'
        AND (
          (NVL(m.HOUSE_RALR_LENDER, 0) > 0 AND NVL(c.SP_HOUSE_RALR_LENDER_AMT, 0) = 0)
          OR (NVL(m.HOUSE_RALR_HABT, 0) > 0 AND NVL(c.SP_HOUSE_RALR_HABT_AMT, 0) = 0)
        )
      ORDER BY c.CALC_NO
    `)

    return NextResponse.json({
      summary: {
        total:       rows.length,
        lenderNoDed: rows.filter(r => r.LENDER_INPUT > 0 && r.LENDER_DED === 0).length,
        habitNoDed:  rows.filter(r => r.HABT_INPUT   > 0 && r.HABT_DED   === 0).length,
      },
      rows,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
