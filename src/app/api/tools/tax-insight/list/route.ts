import { NextRequest, NextResponse } from "next/server"
import { ytsDb } from "@/lib/db/oracle"
import { CALC_NO_PATTERN, YEAR_PATTERN } from "@/features/tax-insight/constants"

export const revalidate = 3600 // 1시간 캐시

export async function GET(req: NextRequest) {
  const year         = req.nextUrl.searchParams.get("year")         ?? "2026"
  const calcNoPattern = YEAR_PATTERN[year] ?? CALC_NO_PATTERN
  const taxFilter    = req.nextUrl.searchParams.get("taxFilter")    ?? "all"
  const calcFilter   = req.nextUrl.searchParams.get("calcFilter")   ?? "all"
  const workFilter   = req.nextUrl.searchParams.get("workFilter")   ?? "all"
  const reviewFilter = req.nextUrl.searchParams.get("reviewFilter") ?? "all"

  const needsMain = workFilter !== "all" || reviewFilter === "houserent" || reviewFilter === "housingsavings" || reviewFilter === "ralr"

  const clauses: string[] = []
  if (taxFilter    === "zero")      clauses.push("c.RES_INCM_TAX = 0")
  if (taxFilter    === "nonzero")   clauses.push("c.RES_INCM_TAX > 0")
  if (calcFilter   === "standard")  clauses.push("c.CALC_METHOD LIKE '%표준세액공제 적용 세액%'")
  if (calcFilter   === "special")   clauses.push("c.CALC_METHOD LIKE '%특별소득%세액공제 적용 세액%'")
  if (workFilter   === "continue")  clauses.push("m.KEEP_PS = '1'")
  if (workFilter   === "midleave")  clauses.push("m.KEEP_PS = '2'")
  if (reviewFilter === "houserent") clauses.push(
    "NVL(m.HOUSE_RENT, 0) > 0 AND NVL(c.RT_HOUSE_RENT_AMT, 0) = 0"
  )
  if (reviewFilter === "housingsavings") clauses.push(
    "(NVL(m.HOUSE_LOAN_SBSC,0) + NVL(m.HOUSE_LOAN_ALL,0) + NVL(m.HOUSE_LOAN_WRK,0)) > 0" +
    " AND (NVL(c.OTO_HOUSE_LOAN_SBSC_AMT,0) + NVL(c.OTO_HOUSE_LOAN_ALL_AMT,0) + NVL(c.OTO_HOUSE_LOAN_WRK_AMT,0)) = 0"
  )
  if (reviewFilter === "insurance") clauses.push(
    "((NVL(c.SPCL_IF_HLTH_INSU_OBJ_AMT,0) > 0 AND NVL(c.SPCL_IF_HLTH_INSU_AMT,0) = 0)" +
    " OR (NVL(c.SPCL_IF_EMP_INSU_OBJ_AMT,0) > 0 AND NVL(c.SPCL_IF_EMP_INSU_AMT,0) = 0))"
  )
  if (reviewFilter === "ralr") clauses.push(
    "((NVL(m.HOUSE_RALR_LENDER,0) > 0 AND NVL(c.SP_HOUSE_RALR_LENDER_AMT,0) = 0)" +
    " OR (NVL(m.HOUSE_RALR_HABT,0) > 0 AND NVL(c.SP_HOUSE_RALR_HABT_AMT,0) = 0))"
  )

  const whereExtra = clauses.length ? "AND " + clauses.join(" AND ") : ""

  const sql = `
    SELECT
      c.CALC_NO,
      c.RES_INCM_TAX,
      c.SUB_INCM_TAX,
      c.TOT_PAY_AMT,
      SUBSTR(f.NM, 1, 4) AS NAME
    FROM YTS39.PAY_WRK_CALC c
    INNER JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
    ${needsMain ? "INNER JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO" : ""}
    WHERE c.CALC_NO LIKE '${calcNoPattern}'
    ${whereExtra}
    ORDER BY c.CALC_NO
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
