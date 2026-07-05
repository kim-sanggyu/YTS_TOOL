import { NextRequest, NextResponse } from "next/server"
import { ytsDb } from "@/lib/db/oracle"
import { analyze } from "@/features/tax-insight/analyzer"
import type { CalcRow } from "@/features/tax-insight/types"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ calcNo: string }> }
) {
  const { calcNo } = await params

  const sql = `
    SELECT
      c.CALC_NO,
      SUBSTR(f.NM, 1, 4)              AS NAME,
      c.TOT_PAY_AMT,
      c.ADD_SUB_HDC_PERS_CNT,
      c.SPCL_IF_HLTH_INSU_AMT,
      c.SPCL_IF_EMP_INSU_AMT,
      c.SP_HOUSE_RALR_LENDER_AMT,
      c.SP_HOUSE_RALR_HABT_AMT,
      c.PROD_TAX_AMT,
      c.SPCL_IF_GRT_INSU_AMT,
      c.SPCL_IF_HDC_PERS_INSU_AMT,
      c.SPCL_MEDI_AMT,
      c.SPCL_EDU_AMT,
      c.SPCL_HL_AMT,
      c.SPCL_HOME_LOVE,
      c.RSIGN_PEN_TECH_AMT,
      c.RSIGN_PEN_RET_AMT,
      c.RSIGN_PEN_PF_AMT,
      c.ISA_PEN_AMT,
      c.RES_INCM_TAX,
      c.EFFCTV_TAX_RATE,
      c.CALC_METHOD,
      c.CALC_PROC_TOTAL,
      c.CALC_PROC_CARD,
      c.CALC_PROC_MEDI,
      m.HOUSE_HLDR_YN,
      m.HOUSE_RENT       AS MAIN_HOUSE_RENT,
      m.HLTH_INSU_AMT    AS MAIN_HLTH_INSU_AMT,
      m.EMP_INSU_AMT     AS MAIN_EMP_INSU_AMT,
      m.HOUSE_LOAN_SBSC  AS MAIN_HOUSE_LOAN_SBSC,
      m.HOUSE_LOAN_ALL   AS MAIN_HOUSE_LOAN_ALL,
      m.HOUSE_LOAN_WRK   AS MAIN_HOUSE_LOAN_WRK,
      m.HOUSE_RALR_LENDER AS MAIN_HOUSE_RALR_LENDER,
      m.HOUSE_RALR_HABT   AS MAIN_HOUSE_RALR_HABT
    FROM YTS39.PAY_WRK_CALC c
    INNER JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
    INNER JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
    WHERE c.CALC_NO = :calcNo
  `

  try {
    const rows = await ytsDb.query<CalcRow>(sql, [calcNo])
    if (rows.length === 0) {
      return NextResponse.json({ error: "데이터 없음" }, { status: 404 })
    }
    const result = analyze(rows[0])
    return NextResponse.json(result)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "DB 조회 실패" }, { status: 500 })
  }
}
