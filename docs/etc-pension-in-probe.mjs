/**
 * 공무원·군인·사학·우체국 연금(8205/8208/8211/8215) yts IN 적정성 실측 — 읽기전용.
 *
 * yts IN = 공제대상금액(ETC_PEN_*_OBJ_AMT)을 useAmt 로 전송, 대조 = 공제액(ETC_PEN_*_AMT).
 * 적정성 질문:
 *   ① 대상자(AMT>0)가 표본에 있는가? (특수직역연금은 희소 — 없으면 "데이터 미검증")
 *   ② ★사각: AMT>0 인데 OBJ=0/NULL 인 건 = 공제는 있는데 전송값이 0 → IN 부적정(국세청이 0 받음).
 *   ③ 소진(OBJ<>AMT): 국민연금처럼 국세청이 소진 재판정하는 교차검증 케이스가 있는가.
 *
 * 사용:  node docs/etc-pension-in-probe.mjs
 * ⚠ SELECT 만. 접속정보 db-ping.mjs 동일(YTS39).
 */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"

const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const fmt = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"))

const PENS = [
  { code: "8205", nm: "공무원연금", obj: "ETC_PEN_PUBL_OBJ_AMT",   amt: "ETC_PEN_PUBL_AMT" },
  { code: "8208", nm: "군인연금",   obj: "ETC_PEN_MLTARY_OBJ_AMT", amt: "ETC_PEN_MLTARY_AMT" },
  { code: "8211", nm: "사학연금",   obj: "ETC_PEN_SCHL_OBJ_AMT",   amt: "ETC_PEN_SCHL_AMT" },
  { code: "8215", nm: "우체국연금", obj: "ETC_PEN_POST_OBJ_AMT",   amt: "ETC_PEN_POST_AMT" },
]

oracledb.initOracleClient({ libDir: ORACLE_LIB })
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT
const conn = await oracledb.getConnection({ user: "YTS39", password: "Yts391234!", connectString: DB_CONNECT })

// 한 방에 4연금 집계 (2025 귀속 전수)
const aggSel = PENS.map(p => `
  COUNT(CASE WHEN ${p.amt} > 0 THEN 1 END) AS ${p.nm.slice(0,2)}_대상,
  COUNT(CASE WHEN ${p.obj} > 0 THEN 1 END) AS ${p.nm.slice(0,2)}_전송,
  COUNT(CASE WHEN NVL(${p.obj},0) = 0 AND ${p.amt} > 0 THEN 1 END) AS ${p.nm.slice(0,2)}_사각,
  COUNT(CASE WHEN ${p.obj} <> ${p.amt} AND ${p.amt} > 0 THEN 1 END) AS ${p.nm.slice(0,2)}_소진`).join(",")
const { rows: [agg] } = await conn.execute(`SELECT ${aggSel} FROM YTS39.PAY_WRK_CALC WHERE CALC_NO LIKE '%Y2025%'`)

console.log(`\n특수직역연금 yts IN 적정성 (Y2025 전수)\n`)
console.log("연금         | 대상자 | OBJ전송 | ★사각(공제有OBJ0) | 소진(OBJ≠AMT)")
console.log("-------------|--------|---------|-------------------|-------------")
for (const p of PENS) {
  const k = p.nm.slice(0,2)
  console.log(`${p.nm.padEnd(11)} | ${String(agg[`${k}_대상`]).padStart(6)} | ${String(agg[`${k}_전송`]).padStart(7)} | ${String(agg[`${k}_사각`]).padStart(17)} | ${String(agg[`${k}_소진`]).padStart(11)}`)
}

// 대상자 있는 연금은 샘플 5건(OBJ/AMT 대조)
for (const p of PENS) {
  const { rows } = await conn.execute(`
    SELECT * FROM (
      SELECT CALC_NO, ${p.obj} AS OBJ, ${p.amt} AS AMT
      FROM YTS39.PAY_WRK_CALC
      WHERE ${p.amt} > 0 AND CALC_NO LIKE '%Y2025%'
      ORDER BY CALC_NO
    ) WHERE ROWNUM <= 5`)
  if (!rows.length) continue
  console.log(`\n[${p.nm}] 샘플 ${rows.length}건 (${p.obj} → ${p.amt})`)
  for (const r of rows) {
    const ok = Number(r.OBJ) === Number(r.AMT)
    console.log(`  ${r.CALC_NO}  OBJ=${fmt(r.OBJ).padStart(12)}  AMT=${fmt(r.AMT).padStart(12)}  ${ok ? "OBJ=AMT" : "★소진"}`)
  }
}

console.log(`\n판정 가이드:`)
console.log(`  · 대상자 0 → 표본에 데이터 없음(구조는 국민연금과 동형이라 배선 자체는 적정, 실데이터 미검증).`)
console.log(`  · ★사각>0 → 공제 있는데 OBJ=0 전송 = IN 부적정(국세청이 0 받음). 즉시 조사 대상.`)
console.log(`  · 소진>0 → OBJ 전송+AMT 대조가 국세청 소진 재판정 교차검증(국민연금 8201과 동형, 정상).`)
await conn.close()
