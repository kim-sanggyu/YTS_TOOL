/**
 * 교육비(8735) 불일치 진단 — YTS RT_EDU_AMT ↔ NTS ntsMap['8735'] 대조.
 * 사용법: node docs/edu-diag.mjs   ⚠ 읽기전용(DB SELECT + 캐시 read).
 */
import fs from "node:fs"
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

  // YTS: 교육비 그룹 조회조건과 동일 (RT_EDU_AMT>0, YY=2025)
  const yts = await q(`
    SELECT c.CALC_NO, SUBSTR(f.NM,1,4) AS NM,
           NVL(c.RT_EDU_AMT,0) AS RT_EDU, NVL(c.SPCL_EDU_AMT,0) AS SPCL_EDU,
           c.EXHAUSTED_POINT
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO=c.CALC_NO AND f.FMLY_SEQ=1
    JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO=c.CALC_NO
    WHERE m.YY='2025' AND NVL(c.RT_EDU_AMT,0)>0
  `)

  const cache = JSON.parse(fs.readFileSync("data/hometax-batch-results/2025-nts2025.json", "utf8")).rows

  const diffs = []
  for (const r of yts) {
    const c = cache[r.CALC_NO]
    const nts = c?.result?.ntsMap?.["8735"]
    const ntsN = nts == null ? null : Number(nts)
    const ytsN = Number(r.RT_EDU)
    if (ntsN == null) { diffs.push({ ...r, nts: "미실행", d: "?" }); continue }
    if (ntsN !== ytsN) diffs.push({ CALC_NO: r.CALC_NO, NM: r.NM, YTS_RT_EDU: ytsN, NTS_8735: ntsN, DIFF: ntsN - ytsN, SPCL_EDU: Number(r.SPCL_EDU), EXH: r.EXHAUSTED_POINT })
  }

  console.log(`교육비 대상(RT_EDU_AMT>0): ${yts.length}명, 불일치: ${diffs.length}명\n`)
  console.table(diffs)
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
