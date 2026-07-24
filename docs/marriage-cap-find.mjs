/**
 * 소진캡 실측 대상 찾기 — 혼인 소진자(RT_MRRG<500,000) 중 국세청 잔액(8990-8700)<500,000 인 사람.
 * 그런 사람에게 혼인 500,000 강제전송하면 캡 트리거 확실.
 * 사용법: node docs/marriage-cap-find.mjs   ⚠ 읽기전용(DB SELECT + 캐시 read).
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

  // 혼인자 전체 (RT_MRRG > 0) — 소진/미소진 다
  const yts = await q(`
    SELECT c.CALC_NO, SUBSTR(f.NM,1,4) AS NM, NVL(c.RT_MRRG,0) AS RT_MRRG,
           NVL(c.PROD_TAX_AMT,0) AS SANCHUL, c.EXHAUSTED_POINT
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO=c.CALC_NO AND f.FMLY_SEQ=1
    JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO=c.CALC_NO
    WHERE m.YY='2025' AND NVL(c.RT_MRRG,0) > 0
  `)

  const cache = JSON.parse(fs.readFileSync("data/hometax-batch-results/2025-nts2025.json", "utf8")).rows

  const rows = yts.map(r => {
    const nm = cache[r.CALC_NO]?.result?.ntsMap ?? {}
    const nts산출 = Number(nm["8990"] ?? 0)
    const nts근로 = Number(nm["8700"] ?? 0)
    const nts8790 = nm["8790"] == null ? null : Number(nm["8790"])
    const nts잔액 = nts산출 - nts근로
    return {
      CALC_NO: r.CALC_NO, NM: r.NM,
      RT_MRRG: Number(r.RT_MRRG),
      소진: Number(r.RT_MRRG) < 500000 ? "Y(소진)" : "",
      NTS산출_8990: nts산출, NTS근로_8700: nts근로,
      NTS잔액_혼인시점: nts잔액,
      현재_NTS_8790: nts8790,
      캡트리거: nts잔액 > 0 && nts잔액 < 500000 ? "★가능" : "",
    }
  }).sort((a, b) => a.NTS잔액_혼인시점 - b.NTS잔액_혼인시점)

  console.log(`혼인자(RT_MRRG>0) 총 ${rows.length}명. NTS잔액(8990-8700) 오름차순:\n`)
  console.table(rows)
  const targets = rows.filter(r => r.캡트리거 === "★가능")
  console.log(`\n★ 캡 트리거 가능(NTS잔액<500,000) 대상: ${targets.length}명`)
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
