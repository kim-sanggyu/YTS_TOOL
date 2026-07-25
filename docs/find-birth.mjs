/**
 * 출산입양 순번별(PER_CHI_YN 3/5/7=첫째/둘째/셋째, FMLY_RELN 550-050) 데이터 있는 2025 대상자 찾기.
 * 소계형 8761(개별 8764~8766 합) 재실행 검증용.
 * 사용법: node docs/find-birth.mjs   ⚠ 읽기전용 SELECT.
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
    SELECT c.CALC_NO, SUBSTR(f1.NM,1,4) AS NM,
           fam.CHLD3, fam.CHLD5, fam.CHLD7,
           NVL(c.RT_PER_CHI_AMT,0) AS RT_PER_CHI_AMT,
           NVL(c.RT_PER_CHI_CNT,0) AS RT_PER_CHI_CNT,
           c.EXHAUSTED_POINT
    FROM (
      SELECT CALC_NO,
        SUM(CASE WHEN PER_CHI_YN='3' AND FMLY_RELN='550-050' THEN 1 ELSE 0 END) AS CHLD3,
        SUM(CASE WHEN PER_CHI_YN='5' AND FMLY_RELN='550-050' THEN 1 ELSE 0 END) AS CHLD5,
        SUM(CASE WHEN PER_CHI_YN='7' AND FMLY_RELN='550-050' THEN 1 ELSE 0 END) AS CHLD7
      FROM YTS39.PAY_WRK_FMLY WHERE BAS_SUB_YN='Y'
      GROUP BY CALC_NO
      HAVING SUM(CASE WHEN PER_CHI_YN IN ('3','5','7') AND FMLY_RELN='550-050' THEN 1 ELSE 0 END) > 0
    ) fam
    JOIN YTS39.PAY_WRK_CALC c ON c.CALC_NO = fam.CALC_NO
    JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO AND m.YY='2025'
    JOIN YTS39.PAY_WRK_FMLY f1 ON f1.CALC_NO = c.CALC_NO AND f1.FMLY_SEQ=1
    ORDER BY c.CALC_NO
  `)
  console.log(`출산입양 순번별 데이터 있는 2025 대상: ${rows.length}명 (CHLD3/5/7=첫째/둘째/셋째)\n`)
  console.table(rows)
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
