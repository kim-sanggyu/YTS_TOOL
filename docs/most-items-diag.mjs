/** 공제 입력 항목이 많은 calc_no 찾기 — 부양가족·기부·연금투자·카드·의료 원천 건수 합. ⚠읽기전용. */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"
const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
async function q(sql, p = []) {
  const c = await oracledb.getConnection({ user: "YTS39", password: "Yts391234!", connectString: DB })
  try { return (await c.execute(sql, p, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? [] }
  finally { await c.close() }
}
async function main() {
  oracledb.initOracleClient({ libDir: ORACLE_LIB })
  for (const pfx of ["Y2025", "X2026"]) {
    console.log(`\n===== ${pfx} 입력 항목 많은 top 8 =====`)
    console.table(await q(`
      SELECT * FROM (
        SELECT c.CALC_NO,
          NVL(f.cnt,0) 부양가족, NVL(g.cnt,0) 기부, NVL(p.cnt,0) 연금투자,
          CASE WHEN c.CALC_PROC_CARD IS NOT NULL THEN 1 ELSE 0 END 카드,
          CASE WHEN c.CALC_PROC_MEDI IS NOT NULL THEN 1 ELSE 0 END 의료,
          (NVL(f.cnt,0)+NVL(g.cnt,0)+NVL(p.cnt,0)
           + CASE WHEN c.CALC_PROC_CARD IS NOT NULL THEN 1 ELSE 0 END
           + CASE WHEN c.CALC_PROC_MEDI IS NOT NULL THEN 1 ELSE 0 END) 합계
        FROM YTS39.PAY_WRK_CALC c
        LEFT JOIN (SELECT CALC_NO, COUNT(*) cnt FROM YTS39.PAY_WRK_FMLY WHERE BAS_SUB_YN='Y' GROUP BY CALC_NO) f ON f.CALC_NO=c.CALC_NO
        LEFT JOIN (SELECT CALC_NO, COUNT(*) cnt FROM YTS39.PAY_WRK_GIFT_ADJ GROUP BY CALC_NO) g ON g.CALC_NO=c.CALC_NO
        LEFT JOIN (SELECT CALC_NO, COUNT(*) cnt FROM YTS39.PAY_WRK_PEN_SAVE_SPEC GROUP BY CALC_NO) p ON p.CALC_NO=c.CALC_NO
        WHERE c.CALC_NO LIKE '${pfx}%'
        ORDER BY 합계 DESC
      ) WHERE ROWNUM <= 8`))
  }
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
