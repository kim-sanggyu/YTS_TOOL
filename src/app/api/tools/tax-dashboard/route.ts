import { NextResponse } from "next/server"
import { ytsDb } from "@/lib/db/oracle"
import { CALC_NO_PATTERN } from "@/features/tax-insight/constants"

export const revalidate = 3600

export async function GET() {
  try {
    // ── 1. 개요 통계 ──────────────────────────────────────────
    const [overview] = await ytsDb.query<{
      TOTAL: number
      REFUND_CNT: number
      EXTRA_CNT: number
      ZERO_CNT: number
      EXHAUSTED_CNT: number
      STD_CNT: number
      AVG_RATE: number
      TOTAL_REFUND: number
      TOTAL_EXTRA: number
      AVG_PAY: number
    }>(`
      SELECT
        COUNT(*)                                                         AS TOTAL,
        COUNT(CASE WHEN SUB_INCM_TAX < 0 THEN 1 END)                   AS REFUND_CNT,
        COUNT(CASE WHEN SUB_INCM_TAX > 0 THEN 1 END)                   AS EXTRA_CNT,
        COUNT(CASE WHEN RES_INCM_TAX  = 0 THEN 1 END)                  AS ZERO_CNT,
        COUNT(CASE WHEN EXHAUSTED_POINT <> 'NOT_EXHAUSTED' THEN 1 END) AS EXHAUSTED_CNT,
        COUNT(CASE WHEN CALC_METHOD LIKE '%표준세액공제 적용 세액%' THEN 1 END) AS STD_CNT,
        ROUND(AVG(EFFCTV_TAX_RATE), 1)                                  AS AVG_RATE,
        SUM(CASE WHEN SUB_INCM_TAX < 0 THEN ABS(SUB_INCM_TAX) ELSE 0 END) AS TOTAL_REFUND,
        SUM(CASE WHEN SUB_INCM_TAX > 0 THEN SUB_INCM_TAX        ELSE 0 END) AS TOTAL_EXTRA,
        ROUND(AVG(TOT_PAY_AMT))                                         AS AVG_PAY
      FROM YTS39.PAY_WRK_CALC
      WHERE CALC_NO LIKE '${CALC_NO_PATTERN}'
    `)

    // ── 2. 절세 기회 — 수치 컬럼 기반 (특별방식+산출세액>0) ────
    const [ins] = await ytsDb.query<{
      ELIGIBLE: number
      PENSION_NONE: number
      PENSION_UNDER: number
      PENSION_OVER: number
      HDC_TOTAL: number
      HDC_NO_INS: number
      HOMETOWN_NONE: number
    }>(`
      SELECT
        COUNT(*)                                                         AS ELIGIBLE,
        COUNT(CASE WHEN (NVL(RSIGN_PEN_RET_AMT,0)+NVL(RSIGN_PEN_PF_AMT,0)+NVL(RSIGN_PEN_TECH_AMT,0)) = 0 THEN 1 END) AS PENSION_NONE,
        COUNT(CASE WHEN (NVL(RSIGN_PEN_RET_AMT,0)+NVL(RSIGN_PEN_PF_AMT,0)+NVL(RSIGN_PEN_TECH_AMT,0)) > 0
                    AND (NVL(RSIGN_PEN_RET_AMT,0)+NVL(RSIGN_PEN_PF_AMT,0)+NVL(RSIGN_PEN_TECH_AMT,0))
                        < CASE WHEN TOT_PAY_AMT > 55000000 THEN 9000000 ELSE 6000000 END THEN 1 END) AS PENSION_UNDER,
        COUNT(CASE WHEN (NVL(RSIGN_PEN_RET_AMT,0)+NVL(RSIGN_PEN_PF_AMT,0)+NVL(RSIGN_PEN_TECH_AMT,0))
                        > CASE WHEN TOT_PAY_AMT > 55000000 THEN 9000000 ELSE 6000000 END THEN 1 END) AS PENSION_OVER,
        COUNT(CASE WHEN NVL(ADD_SUB_HDC_PERS_CNT,0) > 0 THEN 1 END)    AS HDC_TOTAL,
        COUNT(CASE WHEN NVL(ADD_SUB_HDC_PERS_CNT,0) > 0
                    AND NVL(RT_IF_HDC_PERS_INSU_AMT,0) = 0 THEN 1 END) AS HDC_NO_INS,
        COUNT(CASE WHEN NVL(SPCL_HL_AMT,0) = 0
                    AND NVL(SPCL_HOME_LOVE,0) = 0 THEN 1 END)           AS HOMETOWN_NONE
      FROM YTS39.PAY_WRK_CALC
      WHERE CALC_NO LIKE '${CALC_NO_PATTERN}'
        AND CALC_METHOD NOT LIKE '%표준세액공제 적용 세액%'
        AND PROD_TAX_AMT > 0
    `)

    // ── 3. 신용카드·의료비 — CLOB JSON 파싱으로 동적 집계 ───────
    const clobRows = await ytsDb.query<{
      CALC_PROC_CARD: string | null
      CALC_PROC_MEDI: string | null
    }>(`
      SELECT CALC_PROC_CARD, CALC_PROC_MEDI
      FROM YTS39.PAY_WRK_CALC
      WHERE CALC_NO LIKE '${CALC_NO_PATTERN}'
        AND CALC_METHOD NOT LIKE '%표준세액공제 적용 세액%'
        AND PROD_TAX_AMT > 0
    `)

    let cardMiss = 0        // 카드 사용했지만 최저사용금액 미달 → 공제 0
    let cardHighCredit = 0  // 신용카드 비중 50% 초과 (체크카드 전환 권장)
    let mediNear = 0        // 의료비 최저한도까지 100만원 이내 부족

    for (const r of clobRows) {
      if (r.CALC_PROC_CARD) {
        try {
          const c = JSON.parse(r.CALC_PROC_CARD)
          // 사용액은 있는데 최종공제 0 → 최저사용금액 미달
          if (c.총사용액 > 0 && c.최종공제금액 === 0) cardMiss++
          // 공제는 받는데 신용카드 비중 50% 초과 → 체크카드 전환 여지
          if (c.총사용액 > 0 && c.최종공제금액 > 0 && c.가 / c.총사용액 > 0.5) cardHighCredit++
        } catch { /* JSON 파싱 실패 시 무시 */ }
      }
      if (r.CALC_PROC_MEDI) {
        try {
          const m = JSON.parse(r.CALC_PROC_MEDI)
          const shortage = m.의료비최저사용액 - m.의료비지출금액
          // 지출은 있는데 공제 0 + 최저한도까지 100만원 이내 부족
          if (m.의료비지출금액 > 0 && m.의료비_공제금액 === 0 && shortage > 0 && shortage <= 1_000_000) {
            mediNear++
          }
        } catch { /* JSON 파싱 실패 시 무시 */ }
      }
    }

    // ── 4. 총급여 구간 분포 ──────────────────────────────────
    const payDist = await ytsDb.query<{ RANGE: string; CNT: number }>(`
      SELECT
        CASE
          WHEN TOT_PAY_AMT <= 30000000  THEN '3천만원 이하'
          WHEN TOT_PAY_AMT <= 50000000  THEN '3천~5천만원'
          WHEN TOT_PAY_AMT <= 70000000  THEN '5천~7천만원'
          WHEN TOT_PAY_AMT <= 100000000 THEN '7천~1억원'
          WHEN TOT_PAY_AMT <= 150000000 THEN '1억~1.5억원'
          ELSE '1.5억원 초과'
        END AS RANGE,
        COUNT(*) AS CNT
      FROM YTS39.PAY_WRK_CALC
      WHERE CALC_NO LIKE '${CALC_NO_PATTERN}'
      GROUP BY
        CASE
          WHEN TOT_PAY_AMT <= 30000000  THEN '3천만원 이하'
          WHEN TOT_PAY_AMT <= 50000000  THEN '3천~5천만원'
          WHEN TOT_PAY_AMT <= 70000000  THEN '5천~7천만원'
          WHEN TOT_PAY_AMT <= 100000000 THEN '7천~1억원'
          WHEN TOT_PAY_AMT <= 150000000 THEN '1억~1.5억원'
          ELSE '1.5억원 초과'
        END
      ORDER BY MIN(TOT_PAY_AMT)
    `)

    // ── 5. 실효세율 구간 분포 ─────────────────────────────────
    const rateDist = await ytsDb.query<{ RANGE: string; CNT: number }>(`
      SELECT
        CASE
          WHEN EFFCTV_TAX_RATE = 0               THEN '0%'
          WHEN EFFCTV_TAX_RATE <= 5              THEN '1~5%'
          WHEN EFFCTV_TAX_RATE <= 10             THEN '5~10%'
          WHEN EFFCTV_TAX_RATE <= 15             THEN '10~15%'
          WHEN EFFCTV_TAX_RATE <= 20             THEN '15~20%'
          ELSE '20% 초과'
        END AS RANGE,
        COUNT(*) AS CNT
      FROM YTS39.PAY_WRK_CALC
      WHERE CALC_NO LIKE '${CALC_NO_PATTERN}'
      GROUP BY
        CASE
          WHEN EFFCTV_TAX_RATE = 0               THEN '0%'
          WHEN EFFCTV_TAX_RATE <= 5              THEN '1~5%'
          WHEN EFFCTV_TAX_RATE <= 10             THEN '5~10%'
          WHEN EFFCTV_TAX_RATE <= 15             THEN '10~15%'
          WHEN EFFCTV_TAX_RATE <= 20             THEN '15~20%'
          ELSE '20% 초과'
        END
      ORDER BY MIN(EFFCTV_TAX_RATE)
    `)

    return NextResponse.json({
      overview: {
        total:        overview.TOTAL,
        refundCnt:    overview.REFUND_CNT,
        extraCnt:     overview.EXTRA_CNT,
        zeroCnt:      overview.ZERO_CNT,
        exhaustedCnt: overview.EXHAUSTED_CNT,
        stdCnt:       overview.STD_CNT,
        spcCnt:       overview.TOTAL - overview.STD_CNT,
        avgRate:      overview.AVG_RATE,
        totalRefund:  overview.TOTAL_REFUND,
        totalExtra:   overview.TOTAL_EXTRA,
        avgPay:       overview.AVG_PAY,
      },
      insights: {
        eligible:       ins.ELIGIBLE,
        pensionNone:    ins.PENSION_NONE,
        pensionUnder:   ins.PENSION_UNDER,
        pensionOver:    ins.PENSION_OVER,
        hdcTotal:       ins.HDC_TOTAL,
        hdcNoIns:       ins.HDC_NO_INS,
        hometownNone:   ins.HOMETOWN_NONE,
        cardMiss,
        cardHighCredit,
        mediNear,
      },
      payDist,
      rateDist,
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "DB 조회 실패" }, { status: 500 })
  }
}
