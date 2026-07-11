import { NextRequest, NextResponse } from "next/server"
import { ytsDb } from "@/lib/db/oracle"

export const revalidate = 0

export async function GET(req: NextRequest) {
  const fromYear = req.nextUrl.searchParams.get("fromYear") ?? String(new Date().getFullYear() - 1)
  const toYear   = req.nextUrl.searchParams.get("toYear")   ?? String(new Date().getFullYear())

  const goldenPfx = `Y${fromYear}`
  const migrPfx   = `X${toYear}`

  const joinCond = `'Y${fromYear}' || SUBSTR(t.CALC_NO, 6) = g.CALC_NO`
  const whereBase = `t.CALC_NO LIKE '${migrPfx}%' AND g.CALC_NO LIKE '${goldenPfx}%'`

  try {
    // 1. 다차원 일치율 요약
    const [sum] = await ytsDb.query<{
      TOTAL: number
      RES_MATCHED: number
      PROD_MATCHED: number
      METHOD_MATCHED: number
      EXHPT_MATCHED: number
    }>(`
      SELECT
        COUNT(*) AS TOTAL,
        SUM(CASE WHEN t.RES_INCM_TAX = g.RES_INCM_TAX THEN 1 ELSE 0 END)
          AS RES_MATCHED,
        SUM(CASE WHEN t.PROD_TAX_AMT = g.PROD_TAX_AMT THEN 1 ELSE 0 END)
          AS PROD_MATCHED,
        SUM(CASE WHEN
              (CASE WHEN t.CALC_METHOD LIKE '%표준세액공제 적용 세액%' THEN '표준' ELSE '특별' END)
            = (CASE WHEN g.CALC_METHOD LIKE '%표준세액공제 적용 세액%' THEN '표준' ELSE '특별' END)
            THEN 1 ELSE 0 END)
          AS METHOD_MATCHED,
        SUM(CASE WHEN
              NVL(t.EXHAUSTED_POINT, 'NOT_EXHAUSTED')
            = NVL(g.EXHAUSTED_POINT, 'NOT_EXHAUSTED')
            THEN 1 ELSE 0 END)
          AS EXHPT_MATCHED
      FROM YTS39.PAY_WRK_CALC t
      JOIN YTS39.PAY_WRK_CALC g ON ${joinCond}
      WHERE ${whereBase}
    `)

    // 2. 불일치 목록 — 4개 차원 중 하나라도 다른 경우
    const mismatches = await ytsDb.query<{
      CALC_NO: string; NM: string
      RES_G: number;  RES_M: number;  RES_DIFF: number
      PROD_G: number; PROD_M: number
      METHOD_G: string; METHOD_M: string
      EXHPT_G: string;  EXHPT_M: string
      TOT_PAY_G: number; TOT_PAY_M: number
    }>(`
      SELECT t.CALC_NO,
             SUBSTR(f.NM, 1, 4) AS NM,
             g.RES_INCM_TAX  AS RES_G,
             t.RES_INCM_TAX  AS RES_M,
             t.RES_INCM_TAX - g.RES_INCM_TAX AS RES_DIFF,
             g.PROD_TAX_AMT  AS PROD_G,
             t.PROD_TAX_AMT  AS PROD_M,
             CASE WHEN g.CALC_METHOD LIKE '%표준세액공제 적용 세액%' THEN '표준' ELSE '특별' END AS METHOD_G,
             CASE WHEN t.CALC_METHOD LIKE '%표준세액공제 적용 세액%' THEN '표준' ELSE '특별' END AS METHOD_M,
             NVL(g.EXHAUSTED_POINT, 'NOT_EXHAUSTED') AS EXHPT_G,
             NVL(t.EXHAUSTED_POINT, 'NOT_EXHAUSTED') AS EXHPT_M,
             g.TOT_PAY_AMT   AS TOT_PAY_G,
             t.TOT_PAY_AMT   AS TOT_PAY_M
      FROM YTS39.PAY_WRK_CALC t
      JOIN YTS39.PAY_WRK_CALC g ON ${joinCond}
      JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = t.CALC_NO AND f.FMLY_SEQ = 1
      WHERE ${whereBase}
        AND (
          t.RES_INCM_TAX <> g.RES_INCM_TAX
          OR t.PROD_TAX_AMT <> g.PROD_TAX_AMT
          OR (CASE WHEN t.CALC_METHOD LIKE '%표준세액공제 적용 세액%' THEN '표준' ELSE '특별' END)
          <> (CASE WHEN g.CALC_METHOD LIKE '%표준세액공제 적용 세액%' THEN '표준' ELSE '특별' END)
          OR NVL(t.EXHAUSTED_POINT,'NOT_EXHAUSTED') <> NVL(g.EXHAUSTED_POINT,'NOT_EXHAUSTED')
        )
      ORDER BY ABS(t.RES_INCM_TAX - g.RES_INCM_TAX) DESC
    `)

    // 3. 기부이월 무결성
    const giftRows = await ytsDb.query<{ DATASET: string; GIFT_YY: string; CNT: number }>(`
      SELECT dataset, GIFT_YY, cnt
      FROM (
        SELECT 'golden' AS dataset, GIFT_YY, COUNT(*) AS cnt
        FROM YTS39.PAY_WRK_GIFT_ADJ
        WHERE CALC_NO LIKE '${goldenPfx}%'
        GROUP BY GIFT_YY
        UNION ALL
        SELECT 'migr' AS dataset, GIFT_YY, COUNT(*) AS cnt
        FROM YTS39.PAY_WRK_GIFT_ADJ
        WHERE CALC_NO LIKE '${migrPfx}%'
        GROUP BY GIFT_YY
      )
      ORDER BY GIFT_YY, dataset
    `)

    const total = Number(sum?.TOTAL ?? 0)

    const cmpGiftRows = giftRows.filter(r => Number(r.GIFT_YY) <= Number(fromYear))
    const dropOk = !cmpGiftRows.some(
      r => r.DATASET === "migr" && String(r.GIFT_YY) === fromYear
    )

    return NextResponse.json({
      fromYear,
      toYear,
      summary: {
        total,
        dims: {
          res:    { matched: Number(sum?.RES_MATCHED    ?? 0), label: "결정세액" },
          prod:   { matched: Number(sum?.PROD_MATCHED   ?? 0), label: "산출세액" },
          method: { matched: Number(sum?.METHOD_MATCHED ?? 0), label: "표준/특별 선택" },
          exhpt:  { matched: Number(sum?.EXHPT_MATCHED  ?? 0), label: "소진지점" },
        },
      },
      mismatches: mismatches.map(r => ({
        calcNo:  r.CALC_NO,
        nm:      r.NM,
        resG:    Number(r.RES_G),   resM:    Number(r.RES_M),   resDiff: Number(r.RES_DIFF),
        prodG:   Number(r.PROD_G),  prodM:   Number(r.PROD_M),
        methodG: r.METHOD_G,        methodM: r.METHOD_M,
        exhptG:  r.EXHPT_G,         exhptM:  r.EXHPT_M,
        totPayG: Number(r.TOT_PAY_G), totPayM: Number(r.TOT_PAY_M),
      })),
      giftIntegrity: {
        rows: cmpGiftRows.map(r => ({
          dataset: r.DATASET,
          giftYy:  String(r.GIFT_YY),
          cnt:     Number(r.CNT),
        })),
        dropOk,
      },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "DB 조회 실패" }, { status: 500 })
  }
}
