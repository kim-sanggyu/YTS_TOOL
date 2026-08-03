/**
 * ISA(8707/8708) per-code YTS 값 존재/일치 확인 — SPEC per-code SUB_AMT vs NTS per-code ddcAmt. 읽기 전용.
 *   질문: ISA도 투자조합처럼 per-code 대조 가능한가? (PEN_SAVE_SUB_AMT ↔ ntsMap[8707/8708])
 */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"
import fs from "node:fs"
import path from "node:path"
const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const DB_USER = "YTS39", DB_PASS = "Yts391234!"
const fmt = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"))
const CLS2CODE = { "562-130": "8707", "562-120": "8708" }

// 캐시에서 ISA 보유자(ntsMap 8707/8708 nonzero) 찾기
const nts = {}
for (const f of fs.readdirSync("data/hometax-batch-results").filter(f=>f.endsWith(".json"))) {
  const store = JSON.parse(fs.readFileSync(path.join("data/hometax-batch-results", f), "utf8"))
  for (const [cn, row] of Object.entries(store.rows||{})) {
    const n = row.result?.ntsMap; if (!n) continue
    if (Number(n["8707"]??0)||Number(n["8708"]??0)||Number(n["8705"]??0)) nts[cn] = n
  }
}
const cns = Object.keys(nts).slice(0, 8)
console.log(`ISA 보유자(캐시) ${Object.keys(nts).length}명, 상세 ${cns.length}명\n`)

oracledb.initOracleClient({ libDir: ORACLE_LIB })
const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
for (const cn of cns) {
  const [c] = (await conn.execute(`SELECT NVL(RT_ISA_PEN_AMT,0) AS AGG FROM YTS39.PAY_WRK_CALC WHERE CALC_NO=:1`, [cn], {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows
  const rows = (await conn.execute(
    `SELECT PEN_SAVE_CLS, NVL(SUM(PEN_SAVE_PMT_AMT),0) AS PMT, NVL(SUM(PEN_SAVE_SUB_AMT),0) AS SUB
     FROM YTS39.PAY_WRK_PEN_SAVE_SPEC WHERE CALC_NO=:1 AND PEN_SAVE_CLS IN ('562-130','562-120')
     GROUP BY PEN_SAVE_CLS`, [cn], {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows
  console.log(`[${cn}]  RT_ISA_PEN_AMT(소계)=${fmt(c.AGG)}   NTS 소계8705=${fmt(nts[cn]["8705"])}`)
  for (const r of rows) {
    const code = CLS2CODE[r.PEN_SAVE_CLS]
    const ntsPer = nts[cn][code]
    const ok = Number(r.SUB) === Number(ntsPer??0) ? "✓ 일치" : "✗ 불일치"
    console.log(`    ${code}(${r.PEN_SAVE_CLS})  YTS SUB=${fmt(r.SUB)}  vs  NTS per-code=${fmt(ntsPer)}   ${Number(ntsPer??0)!==0||Number(r.SUB)!==0?ok:""}`)
  }
}
await conn.close()
