/**
 * 기부금 이월 연차(diff) 갭 확인 — 특례(548-010)/일반(548-060 종교외·548-070 종교)이
 * 세법상 10년 이월인데 현재 매핑(gift.ts GIFT_TYPES.carry)은 5년치(8811~8815 등)만 전송.
 * diff = 데이터연도(calcNo 2~5자리) − GIFT_YY. diff>=6 이면 국세청 미전송 사각.
 * 사용법: node docs/gift-carry-probe.mjs   ⚠ 읽기전용 SELECT.
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

async function main() {
  oracledb.initOracleClient({ libDir: ORACLE_LIB })

  // 1) GIFT_CLS 분포 — 어떤 유형이 실제 있나
  console.log("=== 1) GIFT_CLS 분포 (전체) ===")
  console.table(await q(`
    SELECT GIFT_CLS, COUNT(*) AS CNT, MIN(GIFT_YY) AS MIN_YY, MAX(GIFT_YY) AS MAX_YY
    FROM YTS39.PAY_WRK_GIFT_ADJ GROUP BY GIFT_CLS ORDER BY GIFT_CLS`))

  // 2) 특례/일반 이월 연차(diff) 분포
  console.log("=== 2) 특례/일반 이월 연차(diff) 분포 ===  (diff>=6 = 현재 미전송 사각)")
  console.table(await q(`
    SELECT DIFF, COUNT(*) AS CNT, COUNT(DISTINCT CALC_NO) AS PPL,
           SUM(GIFT_ABLE_SUB_AMT) AS ABLE_SUM, SUM(GIFT_SUB_AMT) AS SUB_SUM
    FROM (
      SELECT g.CALC_NO,
             TO_NUMBER(SUBSTR(g.CALC_NO,2,4)) - TO_NUMBER(g.GIFT_YY) AS DIFF,
             NVL(g.GIFT_ABLE_SUB_AMT,0) AS GIFT_ABLE_SUB_AMT, NVL(g.GIFT_SUB_AMT,0) AS GIFT_SUB_AMT
      FROM YTS39.PAY_WRK_GIFT_ADJ g
      WHERE g.GIFT_CLS IN ('548-010','548-060','548-070')
        AND g.GIFT_YY IS NOT NULL
    )
    GROUP BY DIFF ORDER BY DIFF`))

  // 3) diff>=6 상세 (사람별) — 실제 영향자
  console.log("=== 3) 6년차+ 이월 상세 (diff>=6, 실제 미전송 영향자) ===")
  const rows = await q(`
    SELECT g.CALC_NO, g.GIFT_CLS, g.GIFT_YY,
           TO_NUMBER(SUBSTR(g.CALC_NO,2,4)) - TO_NUMBER(g.GIFT_YY) AS DIFF,
           NVL(g.GIFT_ABLE_SUB_AMT,0) AS ABLE, NVL(g.GIFT_SUB_AMT,0) AS SUB
    FROM YTS39.PAY_WRK_GIFT_ADJ g
    WHERE g.GIFT_CLS IN ('548-010','548-060','548-070')
      AND g.GIFT_YY IS NOT NULL
      AND TO_NUMBER(SUBSTR(g.CALC_NO,2,4)) - TO_NUMBER(g.GIFT_YY) >= 6
    ORDER BY DIFF DESC, g.CALC_NO`)
  console.log(`총 ${rows.length}행 (diff>=6)`)
  console.table(rows.slice(0, 40))
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
