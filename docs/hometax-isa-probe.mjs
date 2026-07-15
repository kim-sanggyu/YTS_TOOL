/**
 * ISA(8707/8708) 상세 probe — 상규님 제공 쿼리로 PAY_WRK_PEN_SAVE_SPEC 계좌별 조회.
 * 목적: 계좌별 PEN_SAVE_SUB_AMT × 세율(12/15%) 이 국세청 self ddcAmt(8707/8708)와 맞는지 검증.
 * 사용: node docs/hometax-isa-probe.mjs
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

// 캐시 ntsMap 에서 확인된 국세청 self ddcAmt
const NTS = { X202600211: { "8707": 72000, "8708": 0 }, X202600185: { "8707": 0, "8708": 360000 } }
const CLS_CODE = { "562-020": "8701", "562-010": "8702", "562-025": "8702", "562-040": "8703", "562-130": "8707", "562-120": "8708" }

const DETAIL_SQL = `
  SELECT P.CALC_NO, P.ACC_NO, P.PEN_SAVE_CLS, P.INCM_SUB_CLS, P.INVST_CLS, P.SEQ, P.AMT_ENT_CLS,
         P.PEN_SAVE_PMT_AMT, P.PEN_SAVE_SUB_AMT, C.COMM_NM AS COMM_NM,
         DECODE(P.PEN_SAVE_CLS, '562-030','10','562-100','10','562-140','10','562-050','20','562-060','20',
                                '562-080','20','562-110','30','562-020','51','562-010','52','562-040','53',
                                '562-130','54','562-120','55','99') AS SORT_PEN_SAVE_CLS,
         '-' AS MEMO
    FROM PAY_WRK_PEN_SAVE_SPEC P
         INNER JOIN YTS_CODE_MGT C ON P.PEN_SAVE_CLS = C.COMM_CD
   WHERE P.CALC_NO = :1
     AND P.PEN_SAVE_CLS <> '562-110'
   ORDER BY SORT_PEN_SAVE_CLS, P.PEN_SAVE_CLS, P.PEN_SAVE_PMT_AMT DESC`

for (const CALC_NO of Object.keys(NTS)) {
  const c = (await q(`SELECT TOT_PAY_AMT, NVL(RT_ISA_PEN_AMT,0) RT_ISA,
      NVL(RT_RSIGN_PEN_TECH_AMT,0) TECH, NVL(RT_RSIGN_PEN_RET_AMT,0) RET, NVL(RT_RSIGN_PEN_PF_AMT,0) PF
      FROM PAY_WRK_CALC WHERE CALC_NO = :1`, [CALC_NO]))[0]
  const rate = Number(c.TOT_PAY_AMT) <= 55000000 ? 0.15 : 0.12
  console.log(`\n=== ${CALC_NO}  총급여 ${f(c.TOT_PAY_AMT)}  (세율 ${rate * 100}%)`)
  console.log(`    YTS  RT_ISA_PEN_AMT ${f(c.RT_ISA)} | TECH ${f(c.TECH)} RET ${f(c.RET)} PF ${f(c.PF)}`)
  console.log(`    국세청 8707 ${f(NTS[CALC_NO]["8707"])}  8708 ${f(NTS[CALC_NO]["8708"])}`)
  const rows = await q(DETAIL_SQL, [CALC_NO])
  console.log("    ── 상세(PAY_WRK_PEN_SAVE_SPEC) ──")
  for (const r of rows) {
    const code = CLS_CODE[r.PEN_SAVE_CLS] ?? "—"
    const sub = Number(r.PEN_SAVE_SUB_AMT || 0)
    console.log(`    [${code}] ${r.PEN_SAVE_CLS} ${r.COMM_NM || ""} | ACC ${r.ACC_NO ?? "-"} SEQ ${r.SEQ} AMT_ENT ${r.AMT_ENT_CLS ?? "-"}`
      + ` | 납입 ${f(r.PEN_SAVE_PMT_AMT)} 공제대상 ${f(sub)}  →SUB×${rate * 100}% = ${f(Math.round(sub * rate))}`)
  }
}
process.exit(0)
