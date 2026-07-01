import { NextRequest, NextResponse } from "next/server"
import { ytsDb } from "@/lib/db/oracle"
import { analyze } from "@/features/tax-insight/analyzer"
import type { CalcRow } from "@/features/tax-insight/types"
// CALC_NO_PATTERN: [calcNo] 라우트는 특정 건 조회라 패턴 불필요

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ calcNo: string }> }
) {
  const { calcNo } = await params

  const sql = `
    SELECT
      c.CALC_NO, c.TOT_PAY_AMT, c.NTAX_SUM,
      c.PAYM_INCM_TAX, c.PAYM_INHABT_TAX,
      c.WORK_AMT,
      c.BASC_SUB_SELF_AMT, c.BASC_SUB_MATE_AMT, c.BASC_SUB_FAMILY_CNT, c.BASC_SUB_FAMILY_AMT,
      c.ADD_SUB_OAT_CNT, c.ADD_SUB_OAT_AMT,
      c.ADD_SUB_HDC_PERS_CNT, c.ADD_SUB_HDC_PERS_AMT,
      c.ADD_SUB_LADY_AMT, c.ADD_SUB_SNGL_PRNT_AMT,
      c.NP_INSU_OBJ_AMT, c.NP_INSU_AMT,
      c.SPCL_IF_HLTH_INSU_AMT, c.SPCL_IF_EMP_INSU_AMT,
      c.SP_HOUSE_RALR_LENDER_AMT, c.SP_HOUSE_RALR_HABT_AMT,
      c.OTO_CARD_ETC, c.OTO_SUM,
      c.TOT_PTB, c.PROD_TAX_AMT, c.TAX_CUT,
      c.RT_WIA, c.RT_MRRG,
      c.RT_HWC_CNT, c.RT_HWC_AMT,
      c.RT_PER_CHI_CNT, c.RT_PER_CHI_AMT,
      c.SPCL_IF_GRT_INSU_AMT, c.RT_IF_GRT_INSU_AMT,
      c.SPCL_IF_HDC_PERS_INSU_AMT, c.RT_IF_HDC_PERS_INSU_AMT,
      c.SPCL_MEDI_AMT, c.RT_MEDI_AMT,
      c.SPCL_EDU_AMT, c.RT_EDU_AMT,
      c.RT_BASE_SUB_AMT,
      c.SP_HOUSE_RENT_AMT, c.RT_HOUSE_RENT_AMT,
      c.SPCL_PSA, c.RT_PSA,
      c.SPCL_PSA_RELGN_AMT, c.RT_PSA_RELGN,
      c.SPCL_HL_AMT, c.RT_HL,
      c.SPCL_HOME_LOVE, c.RT_HOME_LOVE,
      c.RSIGN_PEN_TECH_AMT, c.RT_RSIGN_PEN_TECH_AMT,
      c.RSIGN_PEN_RET_AMT, c.RT_RSIGN_PEN_RET_AMT,
      c.RSIGN_PEN_PF_AMT, c.RT_RSIGN_PEN_PF_AMT,
      c.ISA_PEN_AMT, c.RT_ISA_PEN_AMT,
      c.RT_SUM,
      c.RES_INCM_TAX, c.RES_INHABT_TAX,
      c.EFFCTV_TAX_RATE,
      c.SUB_INCM_TAX, c.SUB_INHABT_TAX,
      c.EXHAUSTED_POINT, c.CALC_METHOD,
      c.CALC_PROC_TOTAL, c.CALC_PROC_CARD, c.CALC_PROC_MEDI, c.CALC_PROC_INPUT,
      m.KEEP_PS, m.HOUSE_HLDR_YN, m.BEL_FRM_DT, m.BEL_TO_DT,
      m.CONF_YN, m.REL_WRKR_YN, m.HABT_CLS, m.HOME_CLS,
      m.MEDI_ISA_AMT, m.MEDI_CA_AMT,
      m.EDU_SELF_AMT, m.EDU_ENT_PREV_AMT, m.EDU_INFC_AMT,
      m.EDU_UNV_STUD_AMT, m.EDU_HDC_PERS_AMT,
      m.HOUSE_RENT       AS MAIN_HOUSE_RENT,
      m.HLTH_INSU_AMT    AS MAIN_HLTH_INSU_AMT,
      m.EMP_INSU_AMT     AS MAIN_EMP_INSU_AMT,
      m.HOUSE_LOAN_SBSC   AS MAIN_HOUSE_LOAN_SBSC,
      m.HOUSE_LOAN_ALL    AS MAIN_HOUSE_LOAN_ALL,
      m.HOUSE_LOAN_WRK    AS MAIN_HOUSE_LOAN_WRK,
      m.HOUSE_RALR_LENDER AS MAIN_HOUSE_RALR_LENDER,
      m.HOUSE_RALR_HABT   AS MAIN_HOUSE_RALR_HABT
    FROM YTS39.PAY_WRK_CALC c
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
