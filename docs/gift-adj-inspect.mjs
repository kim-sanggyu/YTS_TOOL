/**
 * 종교기부 이월분 8746 ✗ 오탐 진단 — 두 사람의 PAY_WRK_GIFT_ADJ 실제 행 확인(읽기전용 SELECT).
 * 질문: 8746(당해)·8821(이월)에 YTS공제가 둘 다 들어간 이유 = GIFT_ADJ에 당해 행이 실재하나,
 *       아니면 이월 한 행뿐인데 injectGiftDdc diff 계산이 당해코드도 만드나?
 * 사용법: node docs/gift-adj-inspect.mjs
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
  for (const calcNo of ["Y202500150", "Y202500398"]) {
    const dataYear = Number(calcNo.substring(1, 5))
    console.log(`\n════ ${calcNo} (dataYear=${dataYear}) — PAY_WRK_GIFT_ADJ 전체 행 ════`)
    const rows = await q(`
      SELECT GIFT_CLS, GIFT_YY,
             NVL(GIFT_ABLE_SUB_AMT,0) AS ABLE,
             NVL(GIFT_SUB_AMT,0)      AS SUB
      FROM YTS39.PAY_WRK_GIFT_ADJ
      WHERE CALC_NO = :1
      ORDER BY GIFT_CLS, GIFT_YY`, [calcNo])
    if (!rows.length) { console.log("  (기부 조정행 없음)"); continue }
    console.table(rows.map(r => ({
      GIFT_CLS: r.GIFT_CLS,
      GIFT_YY: r.GIFT_YY,
      "당해/이월": Number(r.GIFT_YY) === dataYear ? "당해" : `이월(-${dataYear - Number(r.GIFT_YY)}년)`,
      대상금액_ABLE: Number(r.ABLE).toLocaleString("ko-KR"),
      YTS공제_SUB: Number(r.SUB).toLocaleString("ko-KR"),
    })))
    // 종교(548-070)만 집계
    const rel = rows.filter(r => r.GIFT_CLS === "548-070")
    if (rel.length) {
      const subSum = rel.reduce((a, r) => a + Number(r.SUB), 0)
      console.log(`  종교(548-070) 행 ${rel.length}개 · YTS공제 합 ${subSum.toLocaleString("ko-KR")}` +
        `  · SUB>0 행: ${rel.filter(r => Number(r.SUB) > 0).map(r => `${r.GIFT_YY}(${Number(r.SUB).toLocaleString("ko-KR")})`).join(", ") || "없음"}`)
    }
  }
  console.log("")
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
