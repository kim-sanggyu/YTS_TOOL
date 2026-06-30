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
      CALC_NO, TOT_PAY_AMT, NTAX_SUM,
      PAYM_INCM_TAX, PAYM_INHABT_TAX,
      WORK_AMT,
      BASC_SUB_SELF_AMT, BASC_SUB_MATE_AMT, BASC_SUB_FAMILY_CNT, BASC_SUB_FAMILY_AMT,
      ADD_SUB_OAT_CNT, ADD_SUB_OAT_AMT,
      ADD_SUB_HDC_PERS_CNT, ADD_SUB_HDC_PERS_AMT,
      ADD_SUB_LADY_AMT, ADD_SUB_SNGL_PRNT_AMT,
      NP_INSU_OBJ_AMT, NP_INSU_AMT,
      SPCL_IF_HLTH_INSU_AMT, SPCL_IF_EMP_INSU_AMT,
      SP_HOUSE_RALR_LENDER_AMT, SP_HOUSE_RALR_HABT_AMT,
      OTO_CARD_ETC, OTO_SUM,
      TOT_PTB, PROD_TAX_AMT, TAX_CUT,
      RT_WIA, RT_MRRG,
      RT_HWC_CNT, RT_HWC_AMT,
      RT_PER_CHI_CNT, RT_PER_CHI_AMT,
      SPCL_IF_GRT_INSU_AMT, RT_IF_GRT_INSU_AMT,
      SPCL_IF_HDC_PERS_INSU_AMT, RT_IF_HDC_PERS_INSU_AMT,
      SPCL_MEDI_AMT, RT_MEDI_AMT,
      SPCL_EDU_AMT, RT_EDU_AMT,
      RT_BASE_SUB_AMT,
      SP_HOUSE_RENT_AMT, RT_HOUSE_RENT_AMT,
      SPCL_PSA, RT_PSA,
      SPCL_PSA_RELGN_AMT, RT_PSA_RELGN,
      SPCL_HL_AMT, RT_HL,
      SPCL_HOME_LOVE, RT_HOME_LOVE,
      RSIGN_PEN_TECH_AMT, RT_RSIGN_PEN_TECH_AMT,
      RSIGN_PEN_RET_AMT, RT_RSIGN_PEN_RET_AMT,
      RSIGN_PEN_PF_AMT, RT_RSIGN_PEN_PF_AMT,
      ISA_PEN_AMT, RT_ISA_PEN_AMT,
      RT_SUM,
      RES_INCM_TAX, RES_INHABT_TAX,
      EFFCTV_TAX_RATE,
      SUB_INCM_TAX, SUB_INHABT_TAX,
      EXHAUSTED_POINT, CALC_METHOD,
      CALC_PROC_TOTAL, CALC_PROC_CARD, CALC_PROC_MEDI, CALC_PROC_INPUT
    FROM YTS39.PAY_WRK_CALC
    WHERE CALC_NO = :calcNo
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
