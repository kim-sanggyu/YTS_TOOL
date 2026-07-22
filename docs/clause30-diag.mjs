/**
 * 세액감면 injectTaxCutVals SQL 검증 — 확장된 FN_PAY_GET_WRK_NTAX 다중 Txx 조회가 문법·바인드 정상인지.
 * 사용법: node docs/clause30-diag.mjs   ⚠ 읽기전용(DB SELECT).
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

const TXX_TO_CODE = {
  T12: "8603", T13: "8608", T01: "8602", T02: "8612", T30: "8609", T50: "8611", T20: "8606",
  T42: "8617", T40: "8610", T43: "8616", T41: "8614",
}

async function main() {
  oracledb.initOracleClient({ libDir: ORACLE_LIB })
  const calcNo = "X202600518"   // 조특법30조(T13) 대상자

  const txx = Object.keys(TXX_TO_CODE)
  const sel = txx.map((t, i) =>
    `FN_PAY_GET_WRK_NTAX(:${i * 2 + 1},'MAIN',NULL,'${t}') + FN_PAY_GET_WRK_NTAX(:${i * 2 + 2},'SUB',NULL,'${t}') AS ${t}`
  ).join(", ")
  const params = Array.from({ length: txx.length * 2 }, () => calcNo)

  console.log(`① injectTaxCutVals SQL (${calcNo}) — FN 다중 Txx:`)
  const [r] = await q(`SELECT ${sel} FROM DUAL`, params)
  const mapped = {}
  for (const t of txx) mapped[`CUT_${TXX_TO_CODE[t]} (${t})`] = Number(r[t] ?? 0)
  console.table(mapped)

  console.log("\n② TAX_GOVM_AGREE (소득세법 8601):")
  const gov = await q(`SELECT TAX_GOVM_AGREE FROM YTS39.PAY_WRK_MAIN WHERE CALC_NO=:1`, [calcNo])
  console.log("  TAX_GOVM_AGREE =", Number(gov?.[0]?.TAX_GOVM_AGREE ?? 0))
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
