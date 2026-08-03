/**
 * Y202600235 투자조합출자 per-code 정밀 점검 — 562-110 원시행(INVST_CLS/YY, 납입/공제) vs 코드 매핑. 읽기 전용.
 */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"
const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const DB_USER = "YTS39", DB_PASS = "Yts391234!"
const fmt = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"))
const CN = "Y202600235", DATA_YEAR = 2026
// INVST_CLS × offset → NTS코드
const TYPES = { "2": { label: "벤처등", codes: { "-2": "8416", "-1": "8418", "0": "8420" } },
                "1": { label: "조합1",  codes: { "-2": "8415", "-1": "8417", "0": "8419" } },
                "3": { label: "조합2",  codes: { "-2": "8421", "-1": "8422", "0": "8423" } } }
const conn = await (async () => { oracledb.initOracleClient({ libDir: ORACLE_LIB }); return oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT }) })()
const r = await conn.execute(
  `SELECT INVST_CLS, INVST_YY, PEN_SAVE_PMT_AMT, PEN_SAVE_SUB_AMT FROM YTS39.PAY_WRK_PEN_SAVE_SPEC
   WHERE CALC_NO=:1 AND PEN_SAVE_CLS='562-110' ORDER BY INVST_CLS, INVST_YY`, [CN], { outFormat: oracledb.OUT_FORMAT_OBJECT })
console.log(`[${CN}] 562-110 투자조합 원시행 (dataYear=${DATA_YEAR}):`)
const agg = {}
for (const row of r.rows) {
  const cls = String(row.INVST_CLS), yy = Number(row.INVST_YY), offset = yy - DATA_YEAR
  const code = TYPES[cls]?.codes[String(offset)]
  const rate = cls === "2" ? (offset === 0 ? "100%" : offset === -1 ? "70%" : "30%") : "10%"
  console.log(`  CLS ${cls}(${TYPES[cls]?.label})  YY ${yy}(offset ${offset})  → 코드 ${code ?? "미매핑"}  납입 ${fmt(row.PEN_SAVE_PMT_AMT)}  공제 ${fmt(row.PEN_SAVE_SUB_AMT)}  [율 ${rate}]`)
  if (code) { agg[code] = agg[code] || { pmt: 0, sub: 0 }; agg[code].pmt += Number(row.PEN_SAVE_PMT_AMT||0); agg[code].sub += Number(row.PEN_SAVE_SUB_AMT||0) }
}
console.log(`\n  코드별 집계 (IN=Σ납입 전송 / OUT=Σ공제 대조):`)
for (const [code, v] of Object.entries(agg)) console.log(`    ${code}: IN ${fmt(v.pmt)}  OUT ${fmt(v.sub)}`)
await conn.close()
