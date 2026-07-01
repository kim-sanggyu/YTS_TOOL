import { NextRequest, NextResponse } from "next/server"
import { ytsDb } from "@/lib/db/oracle"
import { CALC_NO_PATTERN, YEAR_PATTERN } from "@/features/tax-insight/constants"

export const revalidate = 0

export async function GET(req: NextRequest) {
  const year          = req.nextUrl.searchParams.get("year")       ?? "2026"
  const workTarget    = req.nextUrl.searchParams.get("workTarget") ?? "all"
  const calcNoPattern = YEAR_PATTERN[year] ?? CALC_NO_PATTERN
  const YEAR          = year

  // 비-JOIN 쿼리용 서브쿼리 필터
  const subFilter =
    workTarget === "continue"     ? `AND CALC_NO IN (SELECT CALC_NO FROM YTS39.PAY_WRK_MAIN WHERE CALC_NO LIKE '${calcNoPattern}' AND KEEP_PS = '1')` :
    workTarget === "continue-dec" ? `AND CALC_NO IN (SELECT CALC_NO FROM YTS39.PAY_WRK_MAIN WHERE CALC_NO LIKE '${calcNoPattern}' AND KEEP_PS = '1' AND BEL_FRM_DT = '${YEAR}0101')` :
    workTarget === "continue-nodec" ? `AND CALC_NO IN (SELECT CALC_NO FROM YTS39.PAY_WRK_MAIN WHERE CALC_NO LIKE '${calcNoPattern}' AND KEEP_PS = '1' AND BEL_FRM_DT <> '${YEAR}0101')` :
    workTarget === "midleave"     ? `AND CALC_NO IN (SELECT CALC_NO FROM YTS39.PAY_WRK_MAIN WHERE CALC_NO LIKE '${calcNoPattern}' AND KEEP_PS = '2')` : ""

  // MAIN JOIN 쿼리용 직접 필터
  const mainFilter =
    workTarget === "continue"     ? `AND m.KEEP_PS = '1'` :
    workTarget === "continue-dec" ? `AND m.KEEP_PS = '1' AND m.BEL_FRM_DT = '${YEAR}0101'` :
    workTarget === "continue-nodec" ? `AND m.KEEP_PS = '1' AND m.BEL_FRM_DT <> '${YEAR}0101'` :
    workTarget === "midleave"     ? `AND m.KEEP_PS = '2'` : ""

  try {
    // ── 1. 개요 통계 ──────────────────────────────────────────
    const [overview] = await ytsDb.query<{
      TOTAL: number; REFUND_CNT: number; EXTRA_CNT: number; ZERO_CNT: number
      STD_CNT: number; AVG_RATE: number; TOTAL_REFUND: number; TOTAL_EXTRA: number; AVG_PAY: number
    }>(`
      SELECT
        COUNT(*)                                                          AS TOTAL,
        COUNT(CASE WHEN SUB_INCM_TAX < 0 THEN 1 END)                    AS REFUND_CNT,
        COUNT(CASE WHEN SUB_INCM_TAX > 0 THEN 1 END)                    AS EXTRA_CNT,
        COUNT(CASE WHEN RES_INCM_TAX  = 0 THEN 1 END)                   AS ZERO_CNT,
        COUNT(CASE WHEN CALC_METHOD LIKE '%표준세액공제 적용 세액%' THEN 1 END) AS STD_CNT,
        ROUND(AVG(EFFCTV_TAX_RATE), 1)                                   AS AVG_RATE,
        SUM(CASE WHEN SUB_INCM_TAX < 0 THEN ABS(SUB_INCM_TAX) ELSE 0 END) AS TOTAL_REFUND,
        SUM(CASE WHEN SUB_INCM_TAX > 0 THEN SUB_INCM_TAX       ELSE 0 END) AS TOTAL_EXTRA,
        ROUND(AVG(TOT_PAY_AMT))                                          AS AVG_PAY
      FROM YTS39.PAY_WRK_CALC
      WHERE CALC_NO LIKE '${calcNoPattern}'
      ${subFilter}
    `)

    // ── 2. 특이사항 — MAIN JOIN ───────────────────────────────
    const [anomalies] = await ytsDb.query<{
      RENT_MISS: number; RENT_STD: number; RENT_INCOME_EXH: number; RENT_TAX_EXH: number
      INS_MISS: number; INS_STD: number; INS_EXHAUSTED: number
      SAVINGS_MISS: number; SAVINGS_MEMBER: number; SAVINGS_LIMIT: number
      RALR_MISS: number; RALR_LENDER_MISS: number; RALR_HABT_MISS: number
    }>(`
      SELECT
        -- 월세: 전체 / 표준방식 / 소득소진(산출세액=0) / 세액소진(결정세액=0)
        COUNT(CASE WHEN NVL(m.HOUSE_RENT,0) > 0
                    AND NVL(c.RT_HOUSE_RENT_AMT,0) = 0 THEN 1 END)                         AS RENT_MISS,
        COUNT(CASE WHEN NVL(m.HOUSE_RENT,0) > 0
                    AND NVL(c.RT_HOUSE_RENT_AMT,0) = 0
                    AND c.CALC_METHOD LIKE '%표준세액공제 적용 세액%' THEN 1 END)            AS RENT_STD,
        COUNT(CASE WHEN NVL(m.HOUSE_RENT,0) > 0
                    AND NVL(c.RT_HOUSE_RENT_AMT,0) = 0
                    AND c.CALC_METHOD NOT LIKE '%표준세액공제 적용 세액%'
                    AND c.PROD_TAX_AMT = 0 THEN 1 END)                                      AS RENT_INCOME_EXH,
        COUNT(CASE WHEN NVL(m.HOUSE_RENT,0) > 0
                    AND NVL(c.RT_HOUSE_RENT_AMT,0) = 0
                    AND c.CALC_METHOD NOT LIKE '%표준세액공제 적용 세액%'
                    AND c.PROD_TAX_AMT > 0 AND c.RES_INCM_TAX = 0 THEN 1 END)              AS RENT_TAX_EXH,
        -- 건강/고용보험 합산 (OR): 전체 / 표준방식 / 소득소진
        COUNT(CASE WHEN ((NVL(c.SPCL_IF_HLTH_INSU_OBJ_AMT,0) > 0 AND NVL(c.SPCL_IF_HLTH_INSU_AMT,0) = 0)
                       OR (NVL(c.SPCL_IF_EMP_INSU_OBJ_AMT,0) > 0 AND NVL(c.SPCL_IF_EMP_INSU_AMT,0) = 0))
                   THEN 1 END)                                                              AS INS_MISS,
        COUNT(CASE WHEN ((NVL(c.SPCL_IF_HLTH_INSU_OBJ_AMT,0) > 0 AND NVL(c.SPCL_IF_HLTH_INSU_AMT,0) = 0)
                       OR (NVL(c.SPCL_IF_EMP_INSU_OBJ_AMT,0) > 0 AND NVL(c.SPCL_IF_EMP_INSU_AMT,0)  = 0))
                    AND c.CALC_METHOD LIKE '%표준세액공제 적용 세액%' THEN 1 END)            AS INS_STD,
        COUNT(CASE WHEN ((NVL(c.SPCL_IF_HLTH_INSU_OBJ_AMT,0) > 0 AND NVL(c.SPCL_IF_HLTH_INSU_AMT,0) = 0)
                       OR (NVL(c.SPCL_IF_EMP_INSU_OBJ_AMT,0) > 0 AND NVL(c.SPCL_IF_EMP_INSU_AMT,0)  = 0))
                    AND c.CALC_METHOD NOT LIKE '%표준세액공제 적용 세액%' THEN 1 END)        AS INS_EXHAUSTED,
        -- 주택마련저축: 전체 / 세대원 / 400만원 한도 소진
        COUNT(CASE WHEN (NVL(m.HOUSE_LOAN_SBSC,0)+NVL(m.HOUSE_LOAN_ALL,0)+NVL(m.HOUSE_LOAN_WRK,0)) > 0
                    AND (NVL(c.OTO_HOUSE_LOAN_SBSC_AMT,0)+NVL(c.OTO_HOUSE_LOAN_ALL_AMT,0)+NVL(c.OTO_HOUSE_LOAN_WRK_AMT,0)) = 0
                    THEN 1 END)                                                              AS SAVINGS_MISS,
        COUNT(CASE WHEN (NVL(m.HOUSE_LOAN_SBSC,0)+NVL(m.HOUSE_LOAN_ALL,0)+NVL(m.HOUSE_LOAN_WRK,0)) > 0
                    AND (NVL(c.OTO_HOUSE_LOAN_SBSC_AMT,0)+NVL(c.OTO_HOUSE_LOAN_ALL_AMT,0)+NVL(c.OTO_HOUSE_LOAN_WRK_AMT,0)) = 0
                    AND m.HOUSE_HLDR_YN = '2' THEN 1 END)                                  AS SAVINGS_MEMBER,
        COUNT(CASE WHEN (NVL(m.HOUSE_LOAN_SBSC,0)+NVL(m.HOUSE_LOAN_ALL,0)+NVL(m.HOUSE_LOAN_WRK,0)) > 0
                    AND (NVL(c.OTO_HOUSE_LOAN_SBSC_AMT,0)+NVL(c.OTO_HOUSE_LOAN_ALL_AMT,0)+NVL(c.OTO_HOUSE_LOAN_WRK_AMT,0)) = 0
                    AND m.HOUSE_HLDR_YN = '1'
                    AND (NVL(c.SP_HOUSE_RALR_LENDER_AMT,0)+NVL(c.SP_HOUSE_RALR_HABT_AMT,0)) >= 4000000
                    THEN 1 END)                                                              AS SAVINGS_LIMIT,
        -- 주택임차차입금원리금상환액: 전체 / 대출기관 / 거주자
        COUNT(CASE WHEN (NVL(m.HOUSE_RALR_LENDER,0) > 0 AND NVL(c.SP_HOUSE_RALR_LENDER_AMT,0) = 0)
                       OR (NVL(m.HOUSE_RALR_HABT,0)   > 0 AND NVL(c.SP_HOUSE_RALR_HABT_AMT,0)   = 0)
                   THEN 1 END)                                                              AS RALR_MISS,
        COUNT(CASE WHEN NVL(m.HOUSE_RALR_LENDER,0) > 0
                    AND NVL(c.SP_HOUSE_RALR_LENDER_AMT,0) = 0 THEN 1 END)                 AS RALR_LENDER_MISS,
        COUNT(CASE WHEN NVL(m.HOUSE_RALR_HABT,0) > 0
                    AND NVL(c.SP_HOUSE_RALR_HABT_AMT,0) = 0 THEN 1 END)                   AS RALR_HABT_MISS
      FROM YTS39.PAY_WRK_CALC c
      INNER JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
      WHERE c.CALC_NO LIKE '${calcNoPattern}'
      ${mainFilter}
    `)

    // ── 3. 절세기회 — 특별방식+산출세액>0 기준 ──────────────────
    const [ins] = await ytsDb.query<{
      ELIGIBLE: number; PENSION_NONE: number; PENSION_UNDER: number
      HDC_TOTAL: number; HDC_NO_INS: number; HOMETOWN_NONE: number
    }>(`
      SELECT
        COUNT(*)                                                          AS ELIGIBLE,
        COUNT(CASE WHEN (NVL(RSIGN_PEN_RET_AMT,0)+NVL(RSIGN_PEN_PF_AMT,0)+NVL(RSIGN_PEN_TECH_AMT,0)) = 0
                   THEN 1 END)                                            AS PENSION_NONE,
        COUNT(CASE WHEN (NVL(RSIGN_PEN_RET_AMT,0)+NVL(RSIGN_PEN_PF_AMT,0)+NVL(RSIGN_PEN_TECH_AMT,0)) > 0
                    AND (NVL(RSIGN_PEN_RET_AMT,0)+NVL(RSIGN_PEN_PF_AMT,0)+NVL(RSIGN_PEN_TECH_AMT,0))
                        < CASE WHEN TOT_PAY_AMT > 55000000 THEN 9000000 ELSE 6000000 END
                   THEN 1 END)                                            AS PENSION_UNDER,
        COUNT(CASE WHEN NVL(ADD_SUB_HDC_PERS_CNT,0) > 0 THEN 1 END)    AS HDC_TOTAL,
        COUNT(CASE WHEN NVL(ADD_SUB_HDC_PERS_CNT,0) > 0
                    AND NVL(RT_IF_HDC_PERS_INSU_AMT,0) = 0 THEN 1 END) AS HDC_NO_INS,
        COUNT(CASE WHEN NVL(SPCL_HL_AMT,0) = 0
                    AND NVL(SPCL_HOME_LOVE,0) = 0 THEN 1 END)           AS HOMETOWN_NONE
      FROM YTS39.PAY_WRK_CALC
      WHERE CALC_NO LIKE '${calcNoPattern}'
        AND CALC_METHOD NOT LIKE '%표준세액공제 적용 세액%'
        AND PROD_TAX_AMT > 0
      ${subFilter}
    `)

    // ── 4. 신용카드·의료비 — CLOB JSON 파싱 ─────────────────────
    const clobRows = await ytsDb.query<{
      CALC_PROC_CARD: string | null; CALC_PROC_MEDI: string | null
    }>(`
      SELECT CALC_PROC_CARD, CALC_PROC_MEDI
      FROM YTS39.PAY_WRK_CALC
      WHERE CALC_NO LIKE '${calcNoPattern}'
        AND CALC_METHOD NOT LIKE '%표준세액공제 적용 세액%'
        AND PROD_TAX_AMT > 0
      ${subFilter}
    `)

    let cardMiss = 0; let cardHighCredit = 0; let mediNear = 0
    for (const r of clobRows) {
      if (r.CALC_PROC_CARD) {
        try {
          const c = JSON.parse(r.CALC_PROC_CARD)
          if (c.총사용액 > 0 && c.최종공제금액 === 0) cardMiss++
          if (c.총사용액 > 0 && c.최종공제금액 > 0 && c.가 / c.총사용액 > 0.5) cardHighCredit++
        } catch { /* ignore */ }
      }
      if (r.CALC_PROC_MEDI) {
        try {
          const m = JSON.parse(r.CALC_PROC_MEDI)
          const shortage = m.의료비최저사용액 - m.의료비지출금액
          if (m.의료비지출금액 > 0 && m.의료비_공제금액 === 0 && shortage > 0 && shortage <= 1_000_000) mediNear++
        } catch { /* ignore */ }
      }
    }

    return NextResponse.json({
      overview: {
        total: overview.TOTAL, refundCnt: overview.REFUND_CNT, extraCnt: overview.EXTRA_CNT,
        zeroCnt: overview.ZERO_CNT, stdCnt: overview.STD_CNT, spcCnt: overview.TOTAL - overview.STD_CNT,
        avgRate: overview.AVG_RATE, totalRefund: overview.TOTAL_REFUND,
        totalExtra: overview.TOTAL_EXTRA, avgPay: overview.AVG_PAY,
      },
      anomalies: {
        rentMiss: anomalies.RENT_MISS, rentStd: anomalies.RENT_STD,
        rentIncomeExh: anomalies.RENT_INCOME_EXH, rentTaxExh: anomalies.RENT_TAX_EXH,
        insMiss: anomalies.INS_MISS ?? 0, insStd: anomalies.INS_STD ?? 0, insExhausted: anomalies.INS_EXHAUSTED ?? 0,
        savingsMiss: anomalies.SAVINGS_MISS, savingsMember: anomalies.SAVINGS_MEMBER, savingsLimit: anomalies.SAVINGS_LIMIT,
        ralrMiss: anomalies.RALR_MISS ?? 0, ralrLenderMiss: anomalies.RALR_LENDER_MISS ?? 0, ralrHabtMiss: anomalies.RALR_HABT_MISS ?? 0,
      },
      insights: {
        eligible: ins.ELIGIBLE, pensionNone: ins.PENSION_NONE, pensionUnder: ins.PENSION_UNDER,
        hdcTotal: ins.HDC_TOTAL, hdcNoIns: ins.HDC_NO_INS, hometownNone: ins.HOMETOWN_NONE,
        cardMiss, cardHighCredit, mediNear,
      },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "DB 조회 실패" }, { status: 500 })
  }
}
