/**
 * 국민연금(8201) yts IN 함수전환 실측 — 읽기전용(SELECT만).
 *
 * 질문 두 가지:
 *   ① FN_PAY_GET_WRK_SOC_INSU_AMT(CALC_NO,'NP') 가 이 DB(YTS39)에서 호출되는가? (쿼리 성공=실재)
 *   ② 국민연금은 국세청 에코(전액공제)인가? = 저장 OBJ(공제대상)와 AMT(공제액)가 늘 같은가?
 *      · OBJ=AMT 전부 → 전액공제=국세청이 재판정 안 함(에코 사각) → 함수전환은 소스 신선도뿐.
 *      · OBJ≠AMT 존재 → 상한캡 등 재판정 여지 → 국세청 검증 가치 있음.
 *   + 함수값 FN 이 저장 OBJ 와 같은가(주석 "동일 실측" 재확인).
 *
 * 사용:  node docs/np-8201-fn-probe.mjs
 * ⚠ SELECT 만. DB 접속정보는 db-ping.mjs 와 동일(YTS39).
 */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"

const ORACLE_LIB  = "D:/tools/instantclient_11_2"
const DB_CONNECT  = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"

const fmt = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"))

oracledb.initOracleClient({ libDir: ORACLE_LIB })
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT

const conn = await oracledb.getConnection({ user: "YTS39", password: "Yts391234!", connectString: DB_CONNECT })

// 국민연금 있는 표본 30명(2025 귀속): 저장 OBJ/AMT + 함수 재계산값 FN 3자 대조. 11g: ROWNUM 인라인뷰.
const { rows } = await conn.execute(`
  SELECT * FROM (
    SELECT CALC_NO,
           NP_INSU_OBJ_AMT AS OBJ,
           NP_INSU_AMT      AS AMT,
           FN_PAY_GET_WRK_SOC_INSU_AMT(CALC_NO, 'NP') AS FN
    FROM YTS39.PAY_WRK_CALC
    WHERE NP_INSU_AMT > 0 AND CALC_NO LIKE '%Y2025%'
    ORDER BY CALC_NO
  ) WHERE ROWNUM <= 30
`)

console.log(`\n국민연금 표본 ${rows.length}명 (Y2025)\n`)
console.log("CALC_NO           | 저장OBJ       | 저장AMT       | 함수FN        | FN=OBJ | OBJ=AMT")
console.log("------------------|---------------|---------------|---------------|--------|--------")
let fnEqObj = 0, objEqAmt = 0
const mismatch = []
for (const r of rows) {
  const a = Number(r.FN) === Number(r.OBJ)
  const b = Number(r.OBJ) === Number(r.AMT)
  if (a) fnEqObj++
  if (b) objEqAmt++
  if (!a || !b) mismatch.push(r)
  console.log(`${String(r.CALC_NO).padEnd(17)} | ${fmt(r.OBJ).padStart(13)} | ${fmt(r.AMT).padStart(13)} | ${fmt(r.FN).padStart(13)} |   ${a ? "✓" : "✗"}    |   ${b ? "✓" : "✗"}`)
}
console.log(`\n함수 호출 성공 = FN_PAY_GET_WRK_SOC_INSU_AMT 실재 확인.`)
console.log(`FN=OBJ ${fnEqObj}/${rows.length}   ·   OBJ=AMT ${objEqAmt}/${rows.length}`)
console.log(`\n판정:`)
console.log(`  · FN=OBJ 전부✓ → 함수전환해도 값 동일(저장컬럼과 함수 정합, 주석 '동일 실측' 재확인).`)
console.log(`  · OBJ=AMT 전부✓ → 국민연금 전액공제=국세청 에코(self 대조 사각). 함수전환 실익=소스 신선도뿐.`)
console.log(`  · OBJ≠AMT/FN≠OBJ 존재(${mismatch.length}건) → 재판정·저장드리프트 여지 → 검증 가치.`)
if (mismatch.length) {
  console.log(`\n  불일치 표본:`)
  for (const r of mismatch.slice(0, 10)) console.log(`    ${r.CALC_NO}  OBJ=${fmt(r.OBJ)} AMT=${fmt(r.AMT)} FN=${fmt(r.FN)}`)
}
await conn.close()
