/**
 * 2025 데이터연도(CALC_NO 2~5자리='2025') 기부금 유형별(GIFT_CLS) 건수.
 * 행수 = 유형×연도별 확정행 수, 인원 = DISTINCT CALC_NO. 당해/이월 분해도 함께.
 * 사용법: node docs/gift-type-count-2025.mjs   ⚠ 읽기전용 SELECT.
 */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"

const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const DB_USER = "YTS39", DB_PASS = "Yts391234!"

const LABEL = {
  "548-020": "정치자금", "548-100": "고향(일반)", "548-110": "고향(특별)",
  "548-010": "특례기부금", "548-080": "우리사주", "548-060": "일반(종교외)", "548-070": "일반(종교)",
}

async function q(sql, params = []) {
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  try { return (await conn.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? [] }
  finally { await conn.close() }
}

async function main() {
  oracledb.initOracleClient({ libDir: ORACLE_LIB })

  console.log("=== 2025 데이터연도 기부금 유형별 건수 (SUBSTR(CALC_NO,2,4)='2025') ===")
  const rows = await q(`
    SELECT g.GIFT_CLS,
           COUNT(*) AS ROWS_CNT,
           COUNT(DISTINCT g.CALC_NO) AS PPL,
           SUM(CASE WHEN TO_NUMBER(g.GIFT_YY) = 2025 THEN 1 ELSE 0 END) AS CUR_ROWS,
           SUM(CASE WHEN TO_NUMBER(g.GIFT_YY) < 2025 THEN 1 ELSE 0 END) AS CARRY_ROWS,
           SUM(NVL(g.GIFT_SUB_AMT,0)) AS SUB_SUM
    FROM YTS39.PAY_WRK_GIFT_ADJ g
    WHERE SUBSTR(g.CALC_NO,2,4) = '2025' AND g.GIFT_YY IS NOT NULL
    GROUP BY g.GIFT_CLS
    ORDER BY g.GIFT_CLS`)
  console.table(rows.map(r => ({
    GIFT_CLS: r.GIFT_CLS, 유형: LABEL[r.GIFT_CLS] ?? "?",
    행수: Number(r.ROWS_CNT), 인원: Number(r.PPL),
    당해행: Number(r.CUR_ROWS), 이월행: Number(r.CARRY_ROWS),
    YTS공제합: Number(r.SUB_SUM),
  })))

  const [tot] = await q(`
    SELECT COUNT(*) AS ROWS_CNT, COUNT(DISTINCT g.CALC_NO) AS PPL
    FROM YTS39.PAY_WRK_GIFT_ADJ g
    WHERE SUBSTR(g.CALC_NO,2,4) = '2025' AND g.GIFT_YY IS NOT NULL`)
  console.log(`\n합계: 행수 ${Number(tot.ROWS_CNT)} · 기부금 보유 인원(DISTINCT CALC_NO) ${Number(tot.PPL)}`)
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
