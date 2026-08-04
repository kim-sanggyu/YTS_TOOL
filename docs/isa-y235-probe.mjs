/**
 * ISA 이중계좌 배분 실측 — Y202600235(상규님 테스트용 2계좌 입력).
 * 목적: per-code YTS 세액공제(PEN_SAVE_SUB_AMT 8707/8708) 가 국세청 per-code ddcAmt 와
 *       갈리는지 확인 → ISA per-code 판정 기준 채택 가능 여부 결정.
 * SW=순차배정 / 국세청=공제대상액 기준 배분(상규님). 합은 동일 예상.
 * 사용: node docs/isa-y235-probe.mjs
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
const CALC_NO = "Y202600235"
const CLS_CODE = { "562-130": "8707(ISA-퇴직연금)", "562-120": "8708(ISA-개인연금)" }

const c = (await q(`SELECT TOT_PAY_AMT, NVL(RT_ISA_PEN_AMT,0) RT_ISA FROM PAY_WRK_CALC WHERE CALC_NO=:1`, [CALC_NO]))[0]
const rate = Number(c.TOT_PAY_AMT) <= 55000000 ? 0.15 : 0.12
console.log(`=== ${CALC_NO}  총급여 ${f(c.TOT_PAY_AMT)} (세율 ${rate*100}%)`)
console.log(`    YTS 합산 RT_ISA_PEN_AMT = ${f(c.RT_ISA)}`)
const rows = await q(`
  SELECT ACC_NO, PEN_SAVE_CLS, SEQ, AMT_ENT_CLS,
         NVL(PEN_SAVE_PMT_AMT,0) PMT, NVL(PEN_SAVE_SUB_AMT,0) SUB
    FROM PAY_WRK_PEN_SAVE_SPEC
   WHERE CALC_NO=:1 AND PEN_SAVE_CLS IN ('562-130','562-120')
   ORDER BY PEN_SAVE_CLS, SEQ`, [CALC_NO])
console.log("    ── ISA 계좌별(PAY_WRK_PEN_SAVE_SPEC) ──")
let subSum = 0
for (const r of rows) {
  subSum += Number(r.SUB)
  console.log(`    ${CLS_CODE[r.PEN_SAVE_CLS] ?? r.PEN_SAVE_CLS} | ACC ${r.ACC_NO ?? "-"} SEQ ${r.SEQ} AMT_ENT ${r.AMT_ENT_CLS ?? "-"}`
    + ` | 납입 ${f(r.PMT)}  per-code 세액공제 PEN_SAVE_SUB_AMT = ${f(r.SUB)}`)
}
console.log(`    per-code SUB 합 = ${f(subSum)}  (RT_ISA_PEN_AMT ${f(c.RT_ISA)} 와 ${subSum === Number(c.RT_ISA) ? "일치 ✓" : "불일치 ✗"})`)
process.exit(0)
