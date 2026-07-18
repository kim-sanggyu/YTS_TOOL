/**
 * 투자조합출자 데이터 진단 — PAY_WRK_PEN_SAVE_SPEC 에서 562-110 / INVST_CLS / INVST_YY 실제값 확인.
 * (그밖의소득공제 투자조합 리스트가 비어 나올 때 필터가 데이터와 맞는지 점검)
 *
 * 사용법: node docs/investment-diag.mjs
 * ⚠ 읽기전용(DB SELECT). 브라우저 불필요.
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

  console.log("① PEN_SAVE_CLS 별 건수 (X2026, INVST_CLS 있는 행만):")
  console.table(await q(`
    SELECT PEN_SAVE_CLS, COUNT(*) CNT, COUNT(DISTINCT CALC_NO) PPL
    FROM YTS39.PAY_WRK_PEN_SAVE_SPEC
    WHERE CALC_NO LIKE 'X2026%' AND INVST_CLS IS NOT NULL
    GROUP BY PEN_SAVE_CLS ORDER BY CNT DESC`))

  console.log("\n② 562-110 의 INVST_CLS / INVST_YY 분포 (X2026):")
  console.table(await q(`
    SELECT INVST_CLS, INVST_YY, COUNT(*) CNT,
           SUM(NVL(PEN_SAVE_PMT_AMT,0)) PMT, SUM(NVL(PEN_SAVE_SUB_AMT,0)) SUBAMT
    FROM YTS39.PAY_WRK_PEN_SAVE_SPEC
    WHERE CALC_NO LIKE 'X2026%' AND PEN_SAVE_CLS = '562-110'
    GROUP BY INVST_CLS, INVST_YY ORDER BY INVST_YY, INVST_CLS`))

  console.log("\n③ 투자조합 추정 행 샘플 5건 (562-110 아니어도 INVST_CLS 있는 것):")
  console.table(await q(`
    SELECT * FROM (
      SELECT CALC_NO, PEN_SAVE_CLS, INVST_CLS, INVST_YY, PEN_SAVE_PMT_AMT, PEN_SAVE_SUB_AMT
      FROM YTS39.PAY_WRK_PEN_SAVE_SPEC
      WHERE CALC_NO LIKE 'X2026%' AND INVST_CLS IS NOT NULL
      ORDER BY CALC_NO
    ) WHERE ROWNUM <= 5`))
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
