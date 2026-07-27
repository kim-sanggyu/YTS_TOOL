/**
 * 기타세액공제(8751/8752/8753) + 그밖의소득공제(8451/8452/8501/8453) 2025 실대상자 찾기.
 * 두 그룹 모두 "대상자0 미검증" 상태 → 검증 가능한 실납세자 존재 여부 확인용.
 *   기타세액공제(PAY_WRK_MAIN): 8751=FRGN_PAY_TAX, 8752=HOUSE_ALR, 8753=ASSO_SUB_TAX_AMT (+8754=FRGN_TOT_PAY_AMT)
 *   그밖의소득공제: 8452=MAIN.STOCK_URDM, 8453=MAIN.EMPL_MTN_WAGE_CUT,
 *                  8451=PEN_SAVE_SPEC 562-100 Σ, 8501=PEN_SAVE_SPEC 562-140 Σ
 * 사용법: node docs/find-etc-other-2025.mjs   ⚠ 읽기전용 SELECT.
 */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"

const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const DB_USER = "YTS39", DB_PASS = "Yts391234!"

async function q(sql, params = []) {
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  try { return (await conn.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? [] }
  finally { await conn.close() }
}

async function main() {
  oracledb.initOracleClient({ libDir: ORACLE_LIB })

  // 기타세액공제 3항목 + 8754
  const etc = await q(`
    SELECT c.CALC_NO, SUBSTR(f1.NM,1,4) AS NM,
           NVL(m.FRGN_PAY_TAX,0)      AS FRGN_PAY_TAX,      -- 8751 외국납부세액
           NVL(m.FRGN_TOT_PAY_AMT,0)  AS FRGN_TOT_PAY_AMT,  -- 8754 국외근로총급여
           NVL(m.HOUSE_ALR,0)         AS HOUSE_ALR,         -- 8752 주택차입금이자상환
           NVL(m.ASSO_SUB_TAX_AMT,0)  AS ASSO_SUB_TAX_AMT,  -- 8753 납세조합
           NVL(c.RT_FCG,0) AS RT_FCG, NVL(c.RT_HBA,0) AS RT_HBA, NVL(c.RT_PTU,0) AS RT_PTU
    FROM YTS39.PAY_WRK_MAIN m
    JOIN YTS39.PAY_WRK_CALC c ON c.CALC_NO = m.CALC_NO
    JOIN YTS39.PAY_WRK_FMLY f1 ON f1.CALC_NO = c.CALC_NO AND f1.FMLY_SEQ = 1
    WHERE m.YY = '2025'
      AND (NVL(m.FRGN_PAY_TAX,0) > 0 OR NVL(m.HOUSE_ALR,0) > 0 OR NVL(m.ASSO_SUB_TAX_AMT,0) > 0)
    ORDER BY c.CALC_NO
  `)
  console.log(`\n=== 기타세액공제 8751/8752/8753 실대상자: ${etc.length}명 ===`)
  console.table(etc)

  // 그밖의소득공제 4항목
  const other = await q(`
    SELECT c.CALC_NO, SUBSTR(f1.NM,1,4) AS NM,
           NVL(m.STOCK_URDM,0)          AS STOCK_URDM,       -- 8452 우리사주
           NVL(m.EMPL_MTN_WAGE_CUT,0)   AS EMPL_MTN_WAGE_CUT,-- 8453 고용유지
           NVL(p100.AMT,0) AS LONG_STOCK_100,               -- 8451 장기집합 562-100
           NVL(p140.AMT,0) AS YM_LONG_STOCK_140,            -- 8501 청년형 562-140
           NVL(c.OTO_SU,0) AS OTO_SU, NVL(c.OTO_LONG_STOCK_SAVING,0) AS OTO_LONG,
           NVL(c.OTO_YM_LONG_STOCK_SAVING,0) AS OTO_YM, NVL(c.OTO_EMPL_MTN_WAGE_CUT,0) AS OTO_EMPL
    FROM YTS39.PAY_WRK_MAIN m
    JOIN YTS39.PAY_WRK_CALC c ON c.CALC_NO = m.CALC_NO
    JOIN YTS39.PAY_WRK_FMLY f1 ON f1.CALC_NO = c.CALC_NO AND f1.FMLY_SEQ = 1
    LEFT JOIN (SELECT CALC_NO, SUM(PEN_SAVE_PMT_AMT) AMT FROM YTS39.PAY_WRK_PEN_SAVE_SPEC
                 WHERE PEN_SAVE_CLS='562-100' GROUP BY CALC_NO) p100 ON p100.CALC_NO = c.CALC_NO
    LEFT JOIN (SELECT CALC_NO, SUM(PEN_SAVE_PMT_AMT) AMT FROM YTS39.PAY_WRK_PEN_SAVE_SPEC
                 WHERE PEN_SAVE_CLS='562-140' GROUP BY CALC_NO) p140 ON p140.CALC_NO = c.CALC_NO
    WHERE m.YY = '2025'
      AND (NVL(m.STOCK_URDM,0) > 0 OR NVL(m.EMPL_MTN_WAGE_CUT,0) > 0
           OR NVL(p100.AMT,0) > 0 OR NVL(p140.AMT,0) > 0)
    ORDER BY c.CALC_NO
  `)
  console.log(`\n=== 그밖의소득공제 8451/8452/8501/8453 실대상자: ${other.length}명 ===`)
  console.table(other)
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
