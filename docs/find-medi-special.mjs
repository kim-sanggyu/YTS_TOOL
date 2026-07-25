/**
 * 난임시술비(8725)·미숙아선천성이상아(8729) 지출 있는 2025 대상자 찾기.
 * 원천 = PAY_WRK_CALC.CALC_PROC_MEDI(CLOB JSON), 키 "난임시술비"/"미숙아등이상아".
 * 사용법: node docs/find-medi-special.mjs   ⚠ 읽기전용 SELECT.
 */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"

const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const DB_USER = "YTS39", DB_PASS = "Yts391234!"

async function main() {
  oracledb.initOracleClient({ libDir: ORACLE_LIB })
  oracledb.fetchAsString = [oracledb.CLOB]
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  const r = await conn.execute(`
    SELECT c.CALC_NO, SUBSTR(f.NM,1,4) AS NM, c.CALC_PROC_MEDI, NVL(c.RT_MEDI_AMT,0) AS RT_MEDI, c.EXHAUSTED_POINT
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO=c.CALC_NO AND f.FMLY_SEQ=1
    JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO=c.CALC_NO
    WHERE m.YY='2025' AND c.CALC_PROC_MEDI IS NOT NULL`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })
  await conn.close()

  const nanim = [], misuk = []
  for (const x of r.rows) {
    let j; try { j = JSON.parse(x.CALC_PROC_MEDI) } catch { continue }
    const n = Number(j["난임시술비"] ?? 0), s = Number(j["미숙아등이상아"] ?? 0)
    if (n > 0) nanim.push({ CALC_NO: x.CALC_NO, NM: x.NM, 난임지출: n, RT_MEDI: Number(x.RT_MEDI), 소진: x.EXHAUSTED_POINT })
    if (s > 0) misuk.push({ CALC_NO: x.CALC_NO, NM: x.NM, 미숙아지출: s, RT_MEDI: Number(x.RT_MEDI), 소진: x.EXHAUSTED_POINT })
  }
  console.log(`의료비 CLOB 있는 2025: ${r.rows.length}명`)
  console.log(`\n★ 난임시술비(8725) 있는: ${nanim.length}명`)
  console.table(nanim.slice(0, 20))
  console.log(`\n★ 미숙아·선천성이상아(8729) 있는: ${misuk.length}명`)
  console.table(misuk.slice(0, 20))
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
