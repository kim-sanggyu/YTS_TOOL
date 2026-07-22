/**
 * 부양가족 국세청 OUT 확인 — X202600219 캐시 ntsMap에서 8002~8009·8003·8000 OUT + YTS 대조.
 * 사용법: node docs/personal-ded-diag.mjs   ⚠ 읽기전용.
 */
import fs from "node:fs"
import oracledb from "../node_modules/oracledb/lib/oracledb.js"
const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
async function q(sql, p = []) {
  const conn = await oracledb.getConnection({ user: "YTS39", password: "Yts391234!", connectString: DB_CONNECT })
  try { return (await conn.execute(sql, p, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? [] }
  finally { await conn.close() }
}
async function main() {
  oracledb.initOracleClient({ libDir: ORACLE_LIB })
  const calcNo = "X202600219"
  const dir = "data/hometax-batch-results"
  let m = null
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json"))) {
    const data = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"))
    if (data[calcNo]?.result?.ntsMap) { m = data[calcNo].result.ntsMap; console.log("찾음:", f, "ranAt:", data[calcNo].ranAt); break }
  }
  if (!m) { console.log("캐시에 없음 — 재실행 반영 안 됨"); return }

  console.log("\n① 인적공제 관련 국세청 OUT(ddcAmt):")
  const codes = ["8000","8001","8002","8003","8004","8005","8006","8007","8008","8009","8010","8100"]
  console.table(Object.fromEntries(codes.map(c => [c, Number(m[c] ?? 0)])))

  console.log("\n② YTS 대조값:")
  const [r] = await q(`SELECT BASC_SUB_SELF_AMT, BASC_SUB_MATE_AMT, BASC_SUB_FAMILY_AMT, BASC_SUB_FAMILY_CNT,
                              ADD_SUB_LADY_AMT, ADD_SUB_SNGL_PRNT_AMT
                       FROM YTS39.PAY_WRK_CALC WHERE CALC_NO=:1`, [calcNo])
  console.table(r)
  const sumFam = ["8004","8005","8006","8007","8008","8009"].reduce((a,c)=>a+Number(m[c]??0),0)
  console.log(`\n③ Σ부양가족개별OUT(8004~8009)=${sumFam} vs YTS BASC_SUB_FAMILY_AMT=${Number(r?.BASC_SUB_FAMILY_AMT??0)} 일치=${sumFam===Number(r?.BASC_SUB_FAMILY_AMT??0)}`)
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
