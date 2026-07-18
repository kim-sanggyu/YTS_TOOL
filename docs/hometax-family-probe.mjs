/**
 * 홈택스 모의계산 — 인적공제(본인·배우자·부양가족·추가공제) send→receive 실측 프로브
 *
 * 목적: 인적공제 블록 중 아직 status:추정 인 코드를 확정으로 올리기 위한 실측.
 *   확정 대상: 8001 본인 / 8002 배우자 / 8101 경로우대 / 8102 장애인 / 8103 부녀자 / 8104 한부모
 *   (부양가족 유형별 8004~8009 는 이미 확정 — 여기선 합계 대조로 곁들여 검증)
 *
 * 핵심 미확인점: 국세청 L03 이 인적공제(소득공제)를 **코드별 ddcAmt 로 회신하는가**
 *   (세액공제 8761/8763 은 코드별로 옴이 확인됐으나, 소득공제는 근로소득금액/과세표준에
 *    녹아 코드별로 안 올 수도 있음). → baseline↔full 전체 diff 로 "어디에 뜨는지" 먼저 드러낸다.
 *
 * 방법: 사람마다 2발 발사 후 대조.
 *   S0) baseline : 총급여 + 기납부만 (인적공제 전무)
 *   S1) full     : + 인적공제 전부(그 사람이 가진 것만)
 *   ① S1 vs S0 전체 diff (변동 코드 전부) → 인적공제 금액이 어느 코드로 회신되는지 발견
 *   ② 코드별 대조표: 각 코드 NTS ddcAmt ↔ YTS 기대 컬럼 (일치 여부)
 *   ③ 합계 대조: Σ(NTS 인적공제 코드) ↔ YTS Σ(본인+배우자+부양가족+추가공제) + 과세표준(8903) 변화
 *
 * 사용법:
 *   node docs/hometax-family-probe.mjs            → 추가공제 보유자 자동 3명(X2026, 유형 다양)
 *   node docs/hometax-family-probe.mjs X2026 5    → 접두 + 건수
 *   node docs/hometax-family-probe.mjs X202600123 → 특정 CALC_NO
 *
 * ⚠ 읽기 전용(DB SELECT + NTS 조회). 저장 없음. eversafe 때문에 headed 필수(실제 Chrome 창).
 */

import oracledb from "../node_modules/oracledb/lib/oracledb.js"
import pw       from "../node_modules/playwright/index.js"

const { chromium } = pw

// ── 설정 ────────────────────────────────────────────────────────────────────
const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const DB_USER    = "YTS39"
const DB_PASS    = "Yts391234!"
const START_URL  = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const L03_URL    = "https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEAA001L03&screenId=UTEYSEJF01&popupYn=false&realScreenId="
const ATTR_YR    = "2025"

// ── 인자 ─────────────────────────────────────────────────────────────────────
const arg1 = process.argv[2]
const arg2 = process.argv[3]
const specificCalcNo = arg1 && /^X\d{9,}$/.test(arg1) ? arg1 : null
const prefix = arg1 && !specificCalcNo ? arg1 : "X2026"
const limit  = Number(arg2) || 3

// ── Oracle ───────────────────────────────────────────────────────────────────
async function dbQuery(sql, params = []) {
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  try {
    const r = await conn.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT })
    return r.rows ?? []
  } finally { await conn.close() }
}

// 추가공제(경로/장애/부녀/한부모)를 가장 다양하게 가진 사람 우선 → 코드 커버리지 최대화
async function pickTargets() {
  if (specificCalcNo) return [specificCalcNo]
  const rows = await dbQuery(`
    SELECT CALC_NO FROM (
      SELECT c.CALC_NO,
        SIGN(NVL(c.ADD_SUB_OAT_CNT,0)) + SIGN(NVL(c.ADD_SUB_HDC_PERS_CNT,0))
          + SIGN(NVL(c.ADD_SUB_LADY_AMT,0)) + SIGN(NVL(c.ADD_SUB_SNGL_PRNT_AMT,0)) AS ADD_KINDS
      FROM YTS39.PAY_WRK_CALC c
      WHERE c.CALC_NO LIKE '${prefix}%'
        AND ( NVL(c.ADD_SUB_OAT_CNT,0) > 0 OR NVL(c.ADD_SUB_HDC_PERS_CNT,0) > 0
           OR NVL(c.ADD_SUB_LADY_AMT,0) > 0 OR NVL(c.ADD_SUB_SNGL_PRNT_AMT,0) > 0 )
      ORDER BY ADD_KINDS DESC, NVL(c.BASC_SUB_FAMILY_CNT,0) DESC
    ) WHERE ROWNUM <= :1
  `, [limit])
  return rows.map(r => r.CALC_NO)
}

async function fetchYts(calcNo) {
  const rows = await dbQuery(`
    SELECT c.CALC_NO,
      c.TOT_PAY_AMT, c.PAYM_INCM_TAX, c.PROD_TAX_AMT, c.RES_INCM_TAX, c.SUB_INCM_TAX,
      NVL(c.BASC_SUB_SELF_AMT, 0)      AS BASC_SUB_SELF_AMT,
      NVL(c.BASC_SUB_MATE_AMT, 0)      AS BASC_SUB_MATE_AMT,
      NVL(c.BASC_SUB_FAMILY_CNT, 0)    AS BASC_SUB_FAMILY_CNT,
      NVL(c.BASC_SUB_FAMILY_AMT, 0)    AS BASC_SUB_FAMILY_AMT,
      NVL(c.ADD_SUB_OAT_CNT, 0)        AS ADD_SUB_OAT_CNT,
      NVL(c.ADD_SUB_OAT_AMT, 0)        AS ADD_SUB_OAT_AMT,
      NVL(c.ADD_SUB_HDC_PERS_CNT, 0)   AS ADD_SUB_HDC_PERS_CNT,
      NVL(c.ADD_SUB_HDC_PERS_AMT, 0)   AS ADD_SUB_HDC_PERS_AMT,
      NVL(c.ADD_SUB_LADY_AMT, 0)       AS ADD_SUB_LADY_AMT,
      NVL(c.ADD_SUB_SNGL_PRNT_AMT, 0)  AS ADD_SUB_SNGL_PRNT_AMT
    FROM YTS39.PAY_WRK_CALC c
    WHERE c.CALC_NO = :1
  `, [calcNo])
  if (!rows.length) throw new Error(`CALC_NO 없음: ${calcNo}`)
  return rows[0]
}

// 부양가족 유형별(8004~09) 집계 — runCompareForCalcNo.injectFamilyVals 복제 (BAS_SUB_YN='Y')
async function fetchFamily(calcNo) {
  const rows = await dbQuery(`
    SELECT
      SUM(CASE WHEN FMLY_RELN IN ('550-020','550-030') THEN 1 ELSE 0 END) AS FAM_8004,
      SUM(CASE WHEN FMLY_RELN = '550-050' THEN 1 ELSE 0 END) AS FAM_8005,
      SUM(CASE WHEN FMLY_RELN = '550-055' THEN 1 ELSE 0 END) AS FAM_8006,
      SUM(CASE WHEN FMLY_RELN = '550-060' THEN 1 ELSE 0 END) AS FAM_8007,
      SUM(CASE WHEN FMLY_RELN = '550-070' THEN 1 ELSE 0 END) AS FAM_8008,
      SUM(CASE WHEN FMLY_RELN = '550-080' THEN 1 ELSE 0 END) AS FAM_8009
    FROM YTS39.PAY_WRK_FMLY
    WHERE CALC_NO = :1 AND BAS_SUB_YN = 'Y'
  `, [calcNo])
  return rows[0] ?? {}
}

// ── 대조 대상 코드 정의 (code, 라벨, YTS 기대 컬럼) ─────────────────────────────
const FAMILY_CODES = ["8004", "8005", "8006", "8007", "8008", "8009"]
const CHECKS = [
  { code: "8001", label: "본인",       ytsCol: "BASC_SUB_SELF_AMT" },
  { code: "8002", label: "배우자",     ytsCol: "BASC_SUB_MATE_AMT" },
  { code: "8101", label: "경로우대",   ytsCol: "ADD_SUB_OAT_AMT" },
  { code: "8102", label: "장애인",     ytsCol: "ADD_SUB_HDC_PERS_AMT" },
  { code: "8103", label: "부녀자",     ytsCol: "ADD_SUB_LADY_AMT" },
  { code: "8104", label: "한부모",     ytsCol: "ADD_SUB_SNGL_PRNT_AMT" },
]

// ── L03 body ─────────────────────────────────────────────────────────────────
const ALL_CODES = [
  "8900","8991",
  "8001","8002","8004","8005","8006","8007","8008","8009","8101","8102","8103","8104",
  "8901","8902","8903","8923","8990","8992","8998","8999",
]

function baseDetail() {
  return ALL_CODES.map(code => ({
    amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0",
  }))
}

// strategy: "none"(총급여+기납부만) | "full"(인적공제 전부)
function buildBody(d, f, strategy) {
  const totPay  = Number(d.TOT_PAY_AMT)
  const prepaid = Number(d.PAYM_INCM_TAX)
  const detail  = baseDetail()
  const set = (code, field, val) => {
    if (!val || Number(val) === 0) return
    const item = detail.find(it => it.amtClusCd === code)
    if (item) item[field] = String(val)
  }

  set("8900", "useAmt", totPay)
  set("8991", "useAmt", prepaid)

  if (strategy === "full") {
    set("8001", "incDdcNfpCnt", 1)
    if (Number(d.BASC_SUB_MATE_AMT) > 0) set("8002", "incDdcNfpCnt", 1)
    for (const code of FAMILY_CODES) set(code, "incDdcNfpCnt", f[`FAM_${code}`])
    set("8101", "incDdcNfpCnt", d.ADD_SUB_OAT_CNT)
    set("8102", "incDdcNfpCnt", d.ADD_SUB_HDC_PERS_CNT)
    if (Number(d.ADD_SUB_LADY_AMT)      > 0) set("8103", "incDdcNfpCnt", 1)
    if (Number(d.ADD_SUB_SNGL_PRNT_AMT) > 0) set("8104", "incDdcNfpCnt", 1)
  }

  return {
    crdcDdcAmt: "0", smltClcClCd: ATTR_YR, v_saveChk: "Y", v_conbChk: "", yrsSrvcClCd: "",
    pbtAddDdcAmt: "0", pbtDdcAmt: "0", addDdcrtDdcAmt: "0", ddcPsbAmt: "0",
    tdmrAddDdcAmt: "0", lstDdcAmt: "0", tdmrDdcAmt: "0", bppAddDdcAmt: "0",
    gnrlDdcAmt: "0", ddcExclAmt: "0",
    totaSnwAmt: String(totPay), ddcLmtAmt: "0",
    yrsTaxClcBscList: [{
      ppmTxamt: String(prepaid), attrYr: ATTR_YR, ddcRtnId: "",
      erinAmt: "0", totaSnwAmt: String(totPay), statusValue: "R",
    }],
    yrsTaxClcDetailDVOList: detail,
  }
}

function toMap(raw) {
  const m = {}
  try {
    const list = JSON.parse(raw).yrsTaxClcDetailDVOList ?? []
    for (const it of list) m[String(it.amtClusCd)] = Number(it.ddcAmt ?? 0)
  } catch {}
  return m
}
function resultCode(raw) { try { return JSON.parse(raw).resultMsg?.result ?? "?" } catch { return "PARSE_ERR" } }
const fmt = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"))

// ── 출력 ─────────────────────────────────────────────────────────────────────
function printHead(calcNo, d, f) {
  console.log(`\n══════════════════════════════════════════════════════`)
  console.log(`▶ ${calcNo}  총급여 ${fmt(d.TOT_PAY_AMT)}`)
  console.log(`  [YTS 인적공제 금액]`)
  console.log(`    본인 ${fmt(d.BASC_SUB_SELF_AMT)} / 배우자 ${fmt(d.BASC_SUB_MATE_AMT)}`
            + ` / 부양가족 ${fmt(d.BASC_SUB_FAMILY_AMT)}(${fmt(d.BASC_SUB_FAMILY_CNT)}명)`)
  console.log(`    경로우대 ${fmt(d.ADD_SUB_OAT_AMT)}(${fmt(d.ADD_SUB_OAT_CNT)}명)`
            + ` / 장애인 ${fmt(d.ADD_SUB_HDC_PERS_AMT)}(${fmt(d.ADD_SUB_HDC_PERS_CNT)}명)`
            + ` / 부녀자 ${fmt(d.ADD_SUB_LADY_AMT)} / 한부모 ${fmt(d.ADD_SUB_SNGL_PRNT_AMT)}`)
  console.log(`  [FMLY 유형별] 8004~09 = ${FAMILY_CODES.map(c => f[`FAM_${c}`] ?? 0).join("/")}`)
}

function printDiff(base, full) {
  const codes = Array.from(new Set([...Object.keys(base), ...Object.keys(full)])).sort()
  console.log(`  ── full vs baseline 전체 diff (변동 코드) ──`)
  for (const code of codes) {
    const b = base[code] ?? 0, w = full[code] ?? 0
    if (b !== w) console.log(`    ${code}   ${fmt(b).padStart(14)} → ${fmt(w).padStart(14)}  (Δ ${fmt(w - b)})`)
  }
}

function printChecks(d, f, full) {
  console.log(`  ── 코드별 대조 (NTS ddcAmt ↔ YTS 기대) ──`)
  let allOk = true
  for (const chk of CHECKS) {
    const nts = full[chk.code] ?? 0
    const yts = Number(d[chk.ytsCol] ?? 0)
    if (yts === 0 && nts === 0) continue          // 그 사람에게 없는 항목은 스킵
    const ok = nts === yts
    if (!ok) allOk = false
    console.log(`    ${chk.code} ${chk.label.padEnd(6)} NTS ${fmt(nts).padStart(12)}  vs YTS ${fmt(yts).padStart(12)}  ${ok ? "✅" : "❌"}`)
  }
  // 부양가족 유형별 합계 대조
  const famNts = FAMILY_CODES.reduce((s, c) => s + (full[c] ?? 0), 0)
  const famYts = Number(d.BASC_SUB_FAMILY_AMT ?? 0)
  if (famNts !== 0 || famYts !== 0) {
    const perCode = FAMILY_CODES.map(c => `${c}:${fmt(full[c] ?? 0)}`).join(" ")
    console.log(`    8004~09 부양가족합 NTS ${fmt(famNts).padStart(12)}  vs YTS ${fmt(famYts).padStart(12)}  ${famNts === famYts ? "✅" : "❌"}   [${perCode}]`)
    if (famNts !== famYts) allOk = false
  }
  return allOk
}

// ── NTS 세션 ─────────────────────────────────────────────────────────────────
async function clickText(page, text, preferRight = false) {
  for (const f of page.frames()) {
    try {
      const ok = await f.evaluate(({ t, pr }) => {
        let els = Array.from(document.querySelectorAll("a,button,input,li,span,div"))
          .filter(e => (e.offsetWidth || e.offsetHeight) && (e.textContent || e.value || "").trim() === t)
        if (pr) els = els.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)
        if (els[0]) { els[0].click(); return true }
        return false
      }, { t: text, pr: preferRight })
      if (ok) return
    } catch {}
  }
}
async function establishSession(page) {
  await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(7000)
  await clickText(page, "모의계산", true)
  await page.waitForTimeout(6000)
  try { await page.getByText("연말정산 자동계산하기", { exact: true }).first().click({ timeout: 8000 }) } catch {}
  await page.waitForTimeout(2000)
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[id="a_1905120000"]'))
    const vis = els.filter(e => e.offsetParent !== null)
    ;(vis[0] || els[0])?.click()
  })
  await page.waitForTimeout(9000)
}
async function postL03(page, body) {
  return page.evaluate(async ({ url, bodyStr }) => {
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json;charset=UTF-8" },
        body: bodyStr, credentials: "include",
      })
      return await res.text()
    } catch (e) { return JSON.stringify({ error: e.message }) }
  }, { url: L03_URL, bodyStr: JSON.stringify(body) })
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("[1] Oracle 연결...")
  oracledb.initOracleClient({ libDir: ORACLE_LIB })
  oracledb.fetchAsString = [oracledb.CLOB]

  const targets = await pickTargets()
  if (!targets.length) { console.error("대상 없음 (추가공제 발생 건 미발견)"); process.exit(1) }
  console.log(`    대상 ${targets.length}명: ${targets.join(", ")}`)

  console.log("[2] 국세청 세션 수립... (headed 필수)")
  const browser = await chromium.launch({ headless: false })
  const ctx     = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page    = await ctx.newPage()
  page.on("dialog", d => d.accept().catch(() => {}))
  await establishSession(page)
  console.log("    세션 완료")

  for (const calcNo of targets) {
    const d = await fetchYts(calcNo)
    const f = await fetchFamily(calcNo)
    printHead(calcNo, d, f)

    const baseRaw = await postL03(page, buildBody(d, f, "none")); await page.waitForTimeout(400)
    const fullRaw = await postL03(page, buildBody(d, f, "full")); await page.waitForTimeout(400)
    console.log(`    (응답 base=${resultCode(baseRaw)} / full=${resultCode(fullRaw)})`)

    const base = toMap(baseRaw), full = toMap(fullRaw)
    printDiff(base, full)
    const ok = printChecks(d, f, full)
    // 과세표준 교차검증: 인적공제만큼 8903 이 줄었나
    const tb = base["8903"] ?? 0, tf = full["8903"] ?? 0
    console.log(`    과세표준(8903) ${fmt(tb)} → ${fmt(tf)}  (Δ ${fmt(tf - tb)})`)
    console.log(`    ⇒ 코드별 대조 ${ok ? "✅ 전부 일치 (추정→확정 근거)" : "❌ 불일치 있음 (위 대조표 확인)"}`)
  }

  await browser.close()
  console.log("\n완료.")
}

main().catch(e => { console.error("오류:", e.message); process.exit(1) })
