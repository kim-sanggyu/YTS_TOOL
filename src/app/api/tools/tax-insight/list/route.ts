import { NextRequest, NextResponse } from "next/server"
import { ytsDb } from "@/lib/db/oracle"
import { CALC_NO_PATTERN } from "@/features/tax-insight/constants"

export const revalidate = 3600 // 1시간 캐시

export async function GET(req: NextRequest) {
  const filter = req.nextUrl.searchParams.get("filter") ?? "all"

  const whereClause =
    filter === "zero"     ? "AND RES_INCM_TAX = 0" :
    filter === "nonzero"  ? "AND RES_INCM_TAX > 0" :
    filter === "standard" ? "AND CALC_METHOD LIKE '%표준세액공제 적용 세액%'" :
    filter === "special"  ? "AND CALC_METHOD LIKE '%특별소득%세액공제 적용 세액%'" : ""

  const sql = `
    SELECT
      CALC_NO,
      RES_INCM_TAX,
      SUB_INCM_TAX,
      TOT_PAY_AMT,
      REGEXP_SUBSTR(
        DBMS_LOB.SUBSTR(CALC_PROC_TOTAL, 80, DBMS_LOB.GETLENGTH(CALC_PROC_TOTAL) - 80),
        '[^\\s]+(?=님\\()'
      ) AS NAME
    FROM YTS39.PAY_WRK_CALC
    WHERE CALC_NO LIKE '${CALC_NO_PATTERN}'
    ${whereClause}
    ORDER BY CALC_NO
  `

  try {
    const rows = await ytsDb.query<{
      CALC_NO: string
      RES_INCM_TAX: number
      SUB_INCM_TAX: number
      TOT_PAY_AMT: number
      NAME: string | null
    }>(sql)

    return NextResponse.json({
      items: rows.map(r => ({
        calcNo: r.CALC_NO,
        name: r.NAME ?? "-",
        resIncmTax: r.RES_INCM_TAX,
        subIncmTax: r.SUB_INCM_TAX,
        totPayAmt: r.TOT_PAY_AMT,
      })),
      total: rows.length,
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "DB 조회 실패" }, { status: 500 })
  }
}
