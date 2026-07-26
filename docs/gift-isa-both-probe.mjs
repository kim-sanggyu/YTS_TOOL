/**
 * ISA 이중(8707+8708 동시 non-zero) 케이스 탐색 — 읽기 전용.
 * 목적: 국세청 L03 OUT 이 per-code(8707/8708) 인지 합산(8705) 인지 확정하기 위한 대상자 발굴.
 * 사용: node docs/gift-isa-both-probe.mjs
 */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"
const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
oracledb.initOracleClient({ libDir: ORACLE_LIB })

async function q(sql, p = []) {
  const c = await oracledb.getConnection({ user: "YTS39", password: "Yts391234!", connectString: DB_CONNECT })
  try { return (await c.execute(sql, p, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? [] }
  finally { await c.close() }
}
const f = n => n == null ? "—" : Number(n).toLocaleString("ko-KR")

// 562-130 = ISA 퇴직연금(8707), 562-120 = ISA 개인연금(8708)
const SQL = `
  SELECT CALC_NO,
         SUM(CASE WHEN PEN_SAVE_CLS='562-130' THEN NVL(PEN_SAVE_PMT_AMT,0) ELSE 0 END) AS ISA_8707,
         SUM(CASE WHEN PEN_SAVE_CLS='562-120' THEN NVL(PEN_SAVE_PMT_AMT,0) ELSE 0 END) AS ISA_8708
    FROM PAY_WRK_PEN_SAVE_SPEC
   WHERE PEN_SAVE_CLS IN ('562-130','562-120')
   GROUP BY CALC_NO
  HAVING SUM(CASE WHEN PEN_SAVE_CLS='562-130' THEN NVL(PEN_SAVE_PMT_AMT,0) ELSE 0 END) > 0
     AND SUM(CASE WHEN PEN_SAVE_CLS='562-120' THEN NVL(PEN_SAVE_PMT_AMT,0) ELSE 0 END) > 0`

const rows = await q(SQL)
console.log(`\n=== 8707·8708 동시 non-zero CALC_NO: ${rows.length}건 ===`)
for (const r of rows) {
  const c = (await q(`SELECT NVL(RT_ISA_PEN_AMT,0) RT_ISA, TOT_PAY_AMT FROM PAY_WRK_CALC WHERE CALC_NO=:1`, [r.CALC_NO]))[0]
  console.log(`  ${r.CALC_NO} | 8707납입 ${f(r.ISA_8707)}  8708납입 ${f(r.ISA_8708)}  | YTS RT_ISA_PEN_AMT ${f(c?.RT_ISA)}  총급여 ${f(c?.TOT_PAY_AMT)}`)
}
process.exit(0)
