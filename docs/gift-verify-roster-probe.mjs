/**
 * 기부금 ③표 검증용 — 유형별 대상자 로스터 + 중복행 감사. 읽기 전용.
 * ① 중복 감사: (CALC_NO, GIFT_CLS, GIFT_YY) COUNT>1 → injectGiftDdc/Vals 의 =할당 전제 위반 지점.
 * ② 유형별 대상자: 7유형 각각 GIFT_SUB_AMT>0 대상자 수 + 샘플(이월 보유 우선).
 * 사용: node docs/gift-verify-roster-probe.mjs [코호트prefix, 기본 Y2025]
 */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"
const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
oracledb.initOracleClient({ libDir: ORACLE_LIB })

async function q(sql, p = []) {
  const c = await oracledb.getConnection({ user: "YTS39", password: "Yts391234!", connectString: DB_CONNECT })
  try { return (await c.execute(sql, p, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? [] }
  finally { await c.close() }
}
const f = n => n == null ? "—" : Number(n).toLocaleString("ko-KR")
const PREFIX = (process.argv[2] || "Y2025") + "%"
const TYPES = {
  "548-020": "정치자금(8740)", "548-100": "고향일반(8783)", "548-110": "고향특별(8784)",
  "548-010": "특례(8743+이월8811~15)", "548-080": "우리사주(8744)",
  "548-060": "종교외(8747+이월8831~35)", "548-070": "종교(8746+이월8821~25)",
}

// ① 중복 감사
console.log(`\n════ ① 중복 (CALC_NO,GIFT_CLS,GIFT_YY) 감사  [${PREFIX}] ════`)
const dup = await q(`
  SELECT CALC_NO, GIFT_CLS, GIFT_YY, COUNT(*) CNT
  FROM YTS39.PAY_WRK_GIFT_ADJ
  WHERE CALC_NO LIKE :1
  GROUP BY CALC_NO, GIFT_CLS, GIFT_YY HAVING COUNT(*) > 1
  ORDER BY CNT DESC`, [PREFIX])
if (!dup.length) console.log("  중복 없음 — =할당 전제 OK ✓")
else { console.log(`  ⚠ 중복 ${dup.length}건 (뒤 행이 앞을 덮어 과소 위험):`); dup.slice(0, 20).forEach(r => console.log(`    ${r.CALC_NO} ${r.GIFT_CLS} YY=${r.GIFT_YY} ×${r.CNT}`)) }

// ② 유형별 대상자 + 샘플
console.log(`\n════ ② 유형별 대상자 (GIFT_SUB_AMT>0)  [${PREFIX}] ════`)
for (const [cls, label] of Object.entries(TYPES)) {
  const cnt = (await q(`SELECT COUNT(DISTINCT CALC_NO) N FROM YTS39.PAY_WRK_GIFT_ADJ WHERE CALC_NO LIKE :1 AND GIFT_CLS=:2 AND NVL(GIFT_SUB_AMT,0)>0`, [PREFIX, cls]))[0]?.N ?? 0
  // 이월 보유(같은 CLS에 GIFT_YY 2개+) 우선 샘플, 없으면 아무나
  const samp = await q(`
    SELECT CALC_NO, COUNT(DISTINCT GIFT_YY) YYN, MIN(GIFT_YY) MINYY, MAX(GIFT_YY) MAXYY, SUM(GIFT_SUB_AMT) SUB
    FROM YTS39.PAY_WRK_GIFT_ADJ WHERE CALC_NO LIKE :1 AND GIFT_CLS=:2 AND NVL(GIFT_SUB_AMT,0)>0
    GROUP BY CALC_NO ORDER BY COUNT(DISTINCT GIFT_YY) DESC, SUM(GIFT_SUB_AMT) DESC`, [PREFIX, cls])
  const top = samp.slice(0, 3).map(s => `${s.CALC_NO}(YY ${s.MINYY}~${s.MAXYY}${s.YYN>1?`,이월${s.YYN-1}`:""},공제${f(s.SUB)})`).join("  ")
  console.log(`  [${label}] ${cnt}명  ${top || "—"}`)
}
process.exit(0)
