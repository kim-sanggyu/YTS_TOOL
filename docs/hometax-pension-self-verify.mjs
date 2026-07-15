/**
 * 연금 self 전환 검증 — pensionList 신로직(코드별 ΣPEN_SAVE_SUB_AMT)이
 * 캐시 ntsMap(국세청 실제 self ddcAmt)과 항목별·본행 원단위로 맞는지 전수 대조.
 */
import fs from "node:fs"
import oracledb from "../node_modules/oracledb/lib/oracledb.js"
oracledb.initOracleClient({ libDir: "D:/tools/instantclient_11_2" })
const DB = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
async function q(sql, p = []) {
  const c = await oracledb.getConnection({ user: "YTS39", password: "Yts391234!", connectString: DB })
  try { return (await c.execute(sql, p, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? [] } finally { await c.close() }
}
const CLS_CODE = { "562-020": "8701", "562-010": "8702", "562-025": "8702", "562-040": "8703", "562-130": "8707", "562-120": "8708" }
const CODES = ["8701", "8702", "8703", "8707", "8708"]

const cache = JSON.parse(fs.readFileSync("data/hometax-batch-results/2026-nts2025.json", "utf8")).rows
// 연금 보유자 = 국세청 8706>0
const calcNos = Object.keys(cache).filter(k => cache[k].ok && cache[k].result && Number(cache[k].result.ntsMap?.["8706"] || 0) > 0)
console.log("연금 보유자(8706>0):", calcNos.length, "명")

// DB: 코드별 ΣSUB (pensionList 와 동일 필터·매핑)
const binds = calcNos.map((_, i) => `:${i + 1}`).join(",")
const spec = await q(`SELECT CALC_NO, PEN_SAVE_CLS, NVL(PEN_SAVE_SUB_AMT,0) SUB
  FROM PAY_WRK_PEN_SAVE_SPEC WHERE CALC_NO IN (${binds})
  AND PEN_SAVE_CLS IN ('562-020','562-010','562-025','562-040','562-130','562-120')`, calcNos)
const ytsByCalc = {}
for (const r of spec) {
  const code = CLS_CODE[r.PEN_SAVE_CLS]; if (!code) continue
  ;(ytsByCalc[r.CALC_NO] ??= {})[code] = (ytsByCalc[r.CALC_NO]?.[code] || 0) + Number(r.SUB)
}

let lineMismatch = 0, rowMismatch = 0, checkedLines = 0
const samples = []
for (const k of calcNos) {
  const nm = cache[k].result.ntsMap
  const yts = ytsByCalc[k] || {}
  let ytsSum = 0, ntsSum = 0
  for (const c of CODES) {
    const y = Number(yts[c] || 0), n = Number(nm[c] || 0)
    ytsSum += y; ntsSum += n; checkedLines++
    if (y !== n) { lineMismatch++; if (samples.length < 15) samples.push(`  ${k} [${c}] yts ${y.toLocaleString()} vs nts ${n.toLocaleString()} (diff ${n - y})`) }
  }
  if (ytsSum !== ntsSum) rowMismatch++
}
console.log(`\n항목행 대조: ${checkedLines}행 중 불일치 ${lineMismatch}`)
console.log(`본행(Σ) 대조: ${calcNos.length}명 중 불일치 ${rowMismatch}`)
if (samples.length) { console.log("\n불일치 샘플:"); samples.forEach(s => console.log(s)) }
else console.log("\n✅ 전 항목·전 본행 원단위 일치 — self 전환 정합 확인")
process.exit(0)
