/**
 * 소득공제(총급여−과세표준) 항등식 실데이터 검증 (2025 귀속).
 *
 * 목적: 드로어 ①결과비교에 "소득공제" 행을 넣을 때, 이 값을 어떤 컬럼으로 표현할지 확정.
 *   기본 정의: 소득공제(표시) = 총급여(TOT_PAY_AMT) − 과세표준(TOT_PTB)   [총급여−소득공제=과세표준]
 *
 * 검증 항등식:
 *   (A) 근로소득금액   : WORK_AMT = TOT_PAY_AMT − WORK_TAX
 *   (B) 과세표준       : TOT_PTB  = BIA_AMT + SPCL_TOT_LMT_OV_AMT   (한도초과 가산)
 *   (C) 소득공제 정통분해: (TOT_PAY_AMT − TOT_PTB) = WORK_TAX + (WORK_AMT − BIA_AMT) − SPCL_TOT_LMT_OV_AMT
 *   (D) 상규님 제안식   : (TOT_PAY_AMT − TOT_PTB) = WORK_TAX + 2*SPCL_SUB_AMT_SUM + BIA_AMT + WORK_AMT + SPCL_TOT_LMT_OV_AMT
 *
 * 실행: node docs/income-ddc-identity-probe.mjs
 */
import fs from "node:fs"
import oracledb from "../node_modules/oracledb/lib/oracledb.js"

// .env.local 파싱 (시크릿 하드코딩 금지)
const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/).filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)

const YEAR = process.argv[2] ?? "2025"

oracledb.initOracleClient({ libDir: env.ORACLE_CLIENT_PATH })
const conn = await oracledb.getConnection({
  user: env.YTS_DB_USER, password: env.YTS_DB_PASSWORD, connectString: env.YTS_DB_CONNECT_STRING,
})

const { rows: [agg] } = await conn.execute(`
  SELECT
    COUNT(*) AS N,
    SUM(CASE WHEN c.WORK_AMT = c.TOT_PAY_AMT - c.WORK_TAX THEN 1 ELSE 0 END) AS OK_A_WORKAMT,
    SUM(CASE WHEN c.TOT_PTB = c.BIA_AMT + NVL(c.SPCL_TOT_LMT_OV_AMT,0) THEN 1 ELSE 0 END) AS OK_B_PTB,
    SUM(CASE WHEN c.TOT_PTB = c.BIA_AMT THEN 1 ELSE 0 END) AS OK_B2_PTB_NOLMT,
    SUM(CASE WHEN (c.TOT_PAY_AMT - c.TOT_PTB) =
                  c.WORK_TAX + (c.WORK_AMT - c.BIA_AMT) - NVL(c.SPCL_TOT_LMT_OV_AMT,0) THEN 1 ELSE 0 END) AS OK_C_DECOMP,
    SUM(CASE WHEN (c.TOT_PAY_AMT - c.TOT_PTB) =
                  c.WORK_TAX + 2*NVL(c.SPCL_SUB_AMT_SUM,0) + c.BIA_AMT + c.WORK_AMT + NVL(c.SPCL_TOT_LMT_OV_AMT,0) THEN 1 ELSE 0 END) AS OK_D_USER
  FROM YTS39.PAY_WRK_CALC c
  JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
  WHERE m.YY = :1
`, [YEAR], { outFormat: oracledb.OUT_FORMAT_OBJECT })

console.log(`\n=== 소득공제 항등식 검증 (YY=${YEAR}) — 전체 ${agg.N}건 ===`)
const pct = (n) => `${n}/${agg.N} (${(100 * n / agg.N).toFixed(1)}%)`
console.log(`(A) WORK_AMT = TOT_PAY_AMT − WORK_TAX            : ${pct(agg.OK_A_WORKAMT)}`)
console.log(`(B) TOT_PTB  = BIA_AMT + SPCL_TOT_LMT_OV_AMT      : ${pct(agg.OK_B_PTB)}`)
console.log(`(B2) TOT_PTB = BIA_AMT (한도초과 무시)             : ${pct(agg.OK_B2_PTB_NOLMT)}`)
console.log(`(C) 소득공제 = WORK_TAX+(WORK_AMT−BIA_AMT)−한도초과 : ${pct(agg.OK_C_DECOMP)}`)
console.log(`(D) 상규님 제안식                                  : ${pct(agg.OK_D_USER)}`)

// 표본 5건 — 실제 숫자로 눈으로 확인
const { rows: sample } = await conn.execute(`
  SELECT * FROM (
    SELECT c.CALC_NO, c.TOT_PAY_AMT, c.WORK_TAX, c.WORK_AMT, c.BIA_AMT, c.TOT_PTB,
           NVL(c.SPCL_TOT_LMT_OV_AMT,0) AS LMT_OV, NVL(c.SPCL_SUB_AMT_SUM,0) AS SPCL_SUM, NVL(c.OTO_SUM,0) AS OTO_SUM,
           (c.TOT_PAY_AMT - c.TOT_PTB) AS DDC_SHOWN
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
    WHERE m.YY = :1 AND c.TOT_PTB > 0
    ORDER BY c.CALC_NO
  ) WHERE ROWNUM <= 5
`, [YEAR], { outFormat: oracledb.OUT_FORMAT_OBJECT })

console.log(`\n=== 표본 5건 (총급여−과세표준 = 소득공제 표시값) ===`)
for (const r of sample) {
  console.log(`\n${r.CALC_NO}: 총급여=${r.TOT_PAY_AMT.toLocaleString()} 과세표준=${r.TOT_PTB.toLocaleString()} → 소득공제(표시)=${r.DDC_SHOWN.toLocaleString()}`)
  console.log(`   근로소득공제=${r.WORK_TAX.toLocaleString()} 근로소득금액=${r.WORK_AMT.toLocaleString()} 차감소득금액=${r.BIA_AMT.toLocaleString()} 한도초과=${r.LMT_OV.toLocaleString()}`)
  console.log(`   종합소득공제(WORK_AMT−BIA_AMT)=${(r.WORK_AMT - r.BIA_AMT).toLocaleString()}  특별소득공제계=${r.SPCL_SUM.toLocaleString()} 그밖의계=${r.OTO_SUM.toLocaleString()}`)
  console.log(`   정통분해(C)=${(r.WORK_TAX + (r.WORK_AMT - r.BIA_AMT) - r.LMT_OV).toLocaleString()}  제안식(D)=${(r.WORK_TAX + 2*r.SPCL_SUM + r.BIA_AMT + r.WORK_AMT + r.LMT_OV).toLocaleString()}`)
}

await conn.close()
