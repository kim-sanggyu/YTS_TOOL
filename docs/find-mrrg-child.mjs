/**
 * 혼인공제(RT_MRRG>0)와 자녀세액공제(RT_HWC_AMT>0)를 둘 다 가진 2025 대상자 찾기.
 * 혼인 원본전송(500,000) 전환 후 ③표 재실행 검증용(두 세액공제 나란히 대조).
 * 사용법: node docs/find-mrrg-child.mjs   ⚠ 읽기전용 SELECT.
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
  const rows = await q(`
    SELECT c.CALC_NO, SUBSTR(f.NM,1,4) AS NM,
           NVL(c.RT_MRRG,0)     AS RT_MRRG,
           NVL(c.RT_HWC_AMT,0)  AS RT_HWC_AMT,
           NVL(c.RT_HWC_CNT,0)  AS RT_HWC_CNT,
           NVL(c.PROD_TAX_AMT,0) AS SANCHUL, c.EXHAUSTED_POINT
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO=c.CALC_NO AND f.FMLY_SEQ=1
    JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO=c.CALC_NO
    WHERE m.YY='2025' AND NVL(c.RT_MRRG,0) > 0 AND NVL(c.RT_HWC_AMT,0) > 0
    ORDER BY c.RT_MRRG, c.RT_HWC_AMT
  `)
  console.log(`혼인공제(RT_MRRG>0) + 자녀세액공제(RT_HWC_AMT>0) 둘 다 있는 2025 대상: ${rows.length}명\n`)
  console.table(rows)
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
