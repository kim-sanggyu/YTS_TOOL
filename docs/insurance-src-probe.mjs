/**
 * 보장성보험료 원천 비교 — PAY_WRK_FMLY_DTL 원본 지출합(GRT_INSU/HDC_PERS_INSU)
 *   vs PAY_WRK_CALC.SPCL_IF_*(한도후 100만 capped) vs RT_IF_*(엔진 공제액).
 * 목적: 원본전송 전환 검토 — 100만 초과자(cap 걸린 사람)=국세청 cap 실측 대상 찾기.
 * 사용법: node docs/insurance-src-probe.mjs   ⚠ 읽기전용 SELECT.
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
  const rows = await q(`
    SELECT c.CALC_NO, SUBSTR(f.NM,1,4) AS NM,
           (SELECT NVL(SUM(GRT_INSU),0)     FROM YTS39.PAY_WRK_FMLY_DTL d WHERE d.CALC_NO=c.CALC_NO) AS SRC_GRT,
           NVL(c.SPCL_IF_GRT_INSU_AMT,0)      AS SPCL_GRT,
           NVL(c.RT_IF_GRT_INSU_AMT,0)        AS RT_GRT,
           (SELECT NVL(SUM(HDC_PERS_INSU),0) FROM YTS39.PAY_WRK_FMLY_DTL d WHERE d.CALC_NO=c.CALC_NO) AS SRC_HDC,
           NVL(c.SPCL_IF_HDC_PERS_INSU_AMT,0) AS SPCL_HDC,
           NVL(c.RT_IF_HDC_PERS_INSU_AMT,0)   AS RT_HDC
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO=c.CALC_NO AND f.FMLY_SEQ=1
    JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO=c.CALC_NO
    WHERE m.YY='2025'
      AND (NVL(c.SPCL_IF_GRT_INSU_AMT,0) > 0 OR NVL(c.SPCL_IF_HDC_PERS_INSU_AMT,0) > 0)
  `)
  // 원본>capped(=cap 걸림) 표시
  const marked = rows.map(r => ({
    ...r,
    GRT_capped: Number(r.SRC_GRT) > Number(r.SPCL_GRT) ? "★cap" : "",
    HDC_capped: Number(r.SRC_HDC) > Number(r.SPCL_HDC) ? "★cap" : "",
  }))
  const capGrt = marked.filter(r => r.GRT_capped)
  const capHdc = marked.filter(r => r.HDC_capped)
  console.log(`보장성보험료 대상 2025: ${rows.length}명`)
  console.log(`  8710(일반) 100만 cap 걸린(원본>capped): ${capGrt.length}명`)
  console.log(`  8711(장애인) 100만 cap 걸린: ${capHdc.length}명\n`)
  console.log("── 8710 cap 걸린 상위(원본 내림차순) ──")
  console.table(capGrt.sort((a,b)=>b.SRC_GRT-a.SRC_GRT).slice(0,8)
    .map(r=>({CALC_NO:r.CALC_NO,NM:r.NM,원본_SRC_GRT:r.SRC_GRT,capped_SPCL:r.SPCL_GRT,공제_RT:r.RT_GRT})))
  console.log("── 8711 cap 걸린 상위 ──")
  console.table(capHdc.sort((a,b)=>b.SRC_HDC-a.SRC_HDC).slice(0,8)
    .map(r=>({CALC_NO:r.CALC_NO,NM:r.NM,원본_SRC_HDC:r.SRC_HDC,capped_SPCL:r.SPCL_HDC,공제_RT:r.RT_HDC})))
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
