import { NextRequest, NextResponse } from "next/server"
import { ytsDb } from "@/lib/db/oracle"
import { CALC_NO_PATTERN, YEAR_PATTERN } from "@/features/tax-insight/constants"

export const revalidate = 0

export async function GET(req: NextRequest) {
  const year          = req.nextUrl.searchParams.get("year") ?? "2026"
  const calcNoPattern = YEAR_PATTERN[year] ?? CALC_NO_PATTERN

  try {
    const rows = await ytsDb.query<{
      CALC_NO: string
      NAME: string | null
      TOT_PAY_AMT: number
      RES_INCM_TAX: number
      STD: number
      INCOME_EXH: number
      TAX_EXH: number
      SAVINGS_MEMBER: number
      SAVINGS_LIMIT: number
      RALR_MISS: number
      CARD_MISS: number
      MEDI_MISS: number
      CARD_CNT: number
      KEEP_PS: string | null
    }>(`
      SELECT
        c.CALC_NO,
        SUBSTR(f.NM, 1, 4)                                                           AS NAME,
        c.TOT_PAY_AMT,
        c.RES_INCM_TAX,
        -- 표준방식
        CASE WHEN c.CALC_METHOD LIKE '%표준세액공제 적용 세액%' THEN 1 ELSE 0 END      AS STD,
        -- 소득소진
        CASE WHEN INSTR(c.CALC_PROC_TOTAL, '근로소득 잔액이 ''0''이 되었습니다') > 0
             THEN 1 ELSE 0 END                                                        AS INCOME_EXH,
        -- 세액소진
        CASE WHEN INSTR(c.CALC_PROC_TOTAL, '항목에서 산출세액이 모두 소진') > 0
             THEN 1 ELSE 0 END                                                        AS TAX_EXH,
        -- 주택마련저축 세대원
        CASE WHEN (NVL(m.HOUSE_LOAN_SBSC,0)+NVL(m.HOUSE_LOAN_ALL,0)+NVL(m.HOUSE_LOAN_WRK,0)) > 0
              AND NVL(m.HOUSE_HLDR_YN,'0') != '1'
             THEN 1 ELSE 0 END                                                        AS SAVINGS_MEMBER,
        -- 주택마련저축 400한도
        CASE WHEN (NVL(m.HOUSE_LOAN_SBSC,0)+NVL(m.HOUSE_LOAN_ALL,0)+NVL(m.HOUSE_LOAN_WRK,0)) > 0
              AND NVL(m.HOUSE_HLDR_YN,'0') = '1'
              AND REGEXP_LIKE(c.CALC_PROC_TOTAL, '주택4백한도\\s*0[,)]')
             THEN 1 ELSE 0 END                                                        AS SAVINGS_LIMIT,
        -- 원리금상환액 미공제 (소득소진 제외)
        CASE WHEN ((NVL(m.HOUSE_RALR_LENDER,0) > 0 AND NVL(c.SP_HOUSE_RALR_LENDER_AMT,0) = 0)
               OR  (NVL(m.HOUSE_RALR_HABT,0)   > 0 AND NVL(c.SP_HOUSE_RALR_HABT_AMT,0)   = 0))
              AND INSTR(c.CALC_PROC_TOTAL, '근로소득 잔액이 ''0''이 되었습니다') = 0
             THEN 1 ELSE 0 END                                                        AS RALR_MISS,
        -- 신용카드 최저미달
        CASE WHEN c.CALC_PROC_CARD IS NOT NULL AND NVL(c.OTO_CARD_ETC, 0) = 0
             THEN 1 ELSE 0 END                                                        AS CARD_MISS,
        -- 의료비 최저미달 (필터 조건과 동일)
        CASE WHEN NVL(c.RT_MEDI_AMT, 0) = 0
              AND c.CALC_PROC_MEDI IS NOT NULL
              AND c.CALC_METHOD NOT LIKE '%표준세액공제 적용 세액%'
              AND NVL(c.EXHAUSTED_POINT, 'NOT_EXHAUSTED') = 'NOT_EXHAUSTED'
              AND NVL(m.LOSS_INSU_MEDI, 0) = 0
              AND INSTR(c.CALC_PROC_MEDI, '실손') = 0
             THEN 1 ELSE 0 END                                                        AS MEDI_MISS,
        -- 근로형태
        m.KEEP_PS,
        -- 분석카드 합계 (위 8개 합산)
        (CASE WHEN c.CALC_METHOD LIKE '%표준세액공제 적용 세액%' THEN 1 ELSE 0 END
       + CASE WHEN INSTR(c.CALC_PROC_TOTAL, '근로소득 잔액이 ''0''이 되었습니다') > 0 THEN 1 ELSE 0 END
       + CASE WHEN INSTR(c.CALC_PROC_TOTAL, '항목에서 산출세액이 모두 소진') > 0 THEN 1 ELSE 0 END
       + CASE WHEN (NVL(m.HOUSE_LOAN_SBSC,0)+NVL(m.HOUSE_LOAN_ALL,0)+NVL(m.HOUSE_LOAN_WRK,0)) > 0 AND NVL(m.HOUSE_HLDR_YN,'0') != '1' THEN 1 ELSE 0 END
       + CASE WHEN (NVL(m.HOUSE_LOAN_SBSC,0)+NVL(m.HOUSE_LOAN_ALL,0)+NVL(m.HOUSE_LOAN_WRK,0)) > 0 AND NVL(m.HOUSE_HLDR_YN,'0') = '1' AND REGEXP_LIKE(c.CALC_PROC_TOTAL, '주택4백한도\\s*0[,)]') THEN 1 ELSE 0 END
       + CASE WHEN ((NVL(m.HOUSE_RALR_LENDER,0) > 0 AND NVL(c.SP_HOUSE_RALR_LENDER_AMT,0) = 0) OR (NVL(m.HOUSE_RALR_HABT,0) > 0 AND NVL(c.SP_HOUSE_RALR_HABT_AMT,0) = 0)) AND INSTR(c.CALC_PROC_TOTAL, '근로소득 잔액이 ''0''이 되었습니다') = 0 THEN 1 ELSE 0 END
       + CASE WHEN c.CALC_PROC_CARD IS NOT NULL AND NVL(c.OTO_CARD_ETC, 0) = 0 THEN 1 ELSE 0 END
       + CASE WHEN NVL(c.RT_MEDI_AMT, 0) = 0 AND c.CALC_PROC_MEDI IS NOT NULL AND c.CALC_METHOD NOT LIKE '%표준세액공제 적용 세액%' AND NVL(c.EXHAUSTED_POINT, 'NOT_EXHAUSTED') = 'NOT_EXHAUSTED' AND NVL(m.LOSS_INSU_MEDI, 0) = 0 AND INSTR(c.CALC_PROC_MEDI, '실손') = 0 THEN 1 ELSE 0 END)
                                                                                      AS CARD_CNT
      FROM YTS39.PAY_WRK_CALC c
      INNER JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
      LEFT JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
      WHERE c.CALC_NO LIKE '${calcNoPattern}'
      ORDER BY CARD_CNT DESC, c.CALC_NO
    `)

    const headers = [
      "CALC_NO", "이름", "근로형태", "총급여", "결정세액", "분석카드수",
      "표준방식", "소득소진", "세액소진",
      "주택저축세대원", "주택저축400한도", "원리금미공제",
      "신용카드미달", "의료비미달",
    ]

    const yn = (v: number) => v === 1 ? "Y" : ""
    const keepPs = (v: string | null) =>
      v === "1" ? "계속근로" : v === "2" ? "중도퇴사" : v ?? ""

    const csvRows = rows.map(r => [
      r.CALC_NO,
      r.NAME ?? "",
      keepPs(r.KEEP_PS),
      r.TOT_PAY_AMT,
      r.RES_INCM_TAX,
      r.CARD_CNT,
      yn(r.STD),
      yn(r.INCOME_EXH),
      yn(r.TAX_EXH),
      yn(r.SAVINGS_MEMBER),
      yn(r.SAVINGS_LIMIT),
      yn(r.RALR_MISS),
      yn(r.CARD_MISS),
      yn(r.MEDI_MISS),
    ])

    const csv = [headers, ...csvRows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\r\n")

    // UTF-8 BOM — Excel 한글 깨짐 방지
    const bom = "﻿"
    return new NextResponse(bom + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="tax-insight-cards-${year}.csv"`,
      },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
