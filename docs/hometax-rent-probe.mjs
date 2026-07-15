/**
 * 홈택스 모의계산 — 월세액(8750) send→receive 계약 프로브
 *
 * 목적: 월세 비교화면 전에 실측 확정.
 *   ① 보낼 값  : 국세청 8750 에 무엇을 넣어야 NTS 공제액이 YTS 와 맞나
 *                B) SP_HOUSE_RENT_AMT (월세[공제대상금액] = 한도적용後, PAY_WRK_CALC)
 *                C) MAIN_HOUSE_RENT   (월세 지급총액 = 원본입력, PAY_WRK_MAIN)
 *   ② 받는 값  : NTS 가 월세 세액공제를 어느 amtClusCd 로 돌려주나 (추정 8750 자체 ddcAmt)
 *
 * 배경(카드·의료비 교훈): NTS 가 한도·공제율을 "자체 계산"하면 원본을 보내야 함(→ C 유력).
 *   월세 공제 = min(지급액, 한도) × 공제율(총급여 기준 15~17%). NTS 는 총급여(8900)를 보고 자체판단.
 *   SP_HOUSE_RENT_AMT 를 보내면 NTS 가 이미 한도적용된 값에 공제율만 재적용 → 결과 갈릴 수 있음.
 *
 * 방법: 사람마다 3발 발사 후 응답 ntsMap diff.
 *   A) baseline(월세 미포함)
 *   B) +월세[공제대상금액]  → 8750 useAmt = SP_HOUSE_RENT_AMT
 *   C) +월세[지급총액]      → 8750 useAmt = MAIN_HOUSE_RENT
 *   각 결과의 변동코드를 전부 출력 → 실제 결과코드 발견 + YTS RT_HOUSE_RENT_AMT(정답)와 대조.
 *
 * 사용법:
 *   node docs/hometax-rent-probe.mjs            → 월세공제 대상자 자동 3명(X2026)
 *   node docs/hometax-rent-probe.mjs X2026 5    → 접두 + 건수
 *   node docs/hometax-rent-probe.mjs X202600123 → 특정 CALC_NO
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
const RENT_RESULT_CODE = "8750"   // NTS 월세 세액공제 결과코드(추정) — 변동코드 전체출력으로 확정

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

async function pickTargets() {
  if (specificCalcNo) return [specificCalcNo]
  const rows = await dbQuery(`
    SELECT CALC_NO FROM (
      SELECT c.CALC_NO
      FROM YTS39.PAY_WRK_CALC c
      WHERE c.CALC_NO LIKE '${prefix}%'
        AND NVL(c.RT_HOUSE_RENT_AMT, 0) > 0
      ORDER BY NVL(c.RT_HOUSE_RENT_AMT, 0) DESC
    ) WHERE ROWNUM <= :1
  `, [limit])
  return rows.map(r => r.CALC_NO)
}

async function fetchYts(calcNo) {
  const rows = await dbQuery(`
    SELECT c.CALC_NO,
      c.TOT_PAY_AMT, c.PAYM_INCM_TAX, c.PROD_TAX_AMT, c.RES_INCM_TAX, c.SUB_INCM_TAX,
      c.BASC_SUB_MATE_AMT, c.BASC_SUB_FAMILY_CNT,
      c.ADD_SUB_OAT_CNT, c.ADD_SUB_HDC_PERS_CNT, c.ADD_SUB_LADY_AMT, c.ADD_SUB_SNGL_PRNT_AMT,
      c.NP_INSU_AMT, c.SPCL_IF_HLTH_INSU_AMT, c.SPCL_IF_EMP_INSU_AMT,
      NVL(c.SP_HOUSE_RENT_AMT, 0) AS SP_HOUSE_RENT_AMT,
      NVL(c.RT_HOUSE_RENT_AMT, 0) AS RT_HOUSE_RENT_AMT,
      NVL(m.HOUSE_RENT, 0)        AS MAIN_HOUSE_RENT,
      m.HOUSE_HLDR_YN
    FROM YTS39.PAY_WRK_CALC c
    INNER JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
    WHERE c.CALC_NO = :1
  `, [calcNo])
  if (!rows.length) throw new Error(`CALC_NO 없음: ${calcNo}`)
  return rows[0]
}

// ── L03 body ─────────────────────────────────────────────────────────────────
const ALL_CODES = [
  "8900","8991",
  "8001","8002","8003","8101","8102","8103","8104",
  "8201","8301","8305",
  "8750",
  "8901","8902","8903","8923","8990","8992","8998","8999",
]

function baseDetail() {
  return ALL_CODES.map(code => ({
    amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0",
  }))
}

// strategy: "none" | "obj"(공제대상 SP) | "main"(지급총액 MAIN)
function buildBody(d, strategy) {
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
  set("8001", "incDdcNfpCnt", 1)
  if (Number(d.BASC_SUB_MATE_AMT) > 0)   set("8002", "incDdcNfpCnt", 1)
  if (Number(d.BASC_SUB_FAMILY_CNT) > 0) set("8003", "incDdcNfpCnt", d.BASC_SUB_FAMILY_CNT)
  set("8101", "incDdcNfpCnt", d.ADD_SUB_OAT_CNT)
  set("8102", "incDdcNfpCnt", d.ADD_SUB_HDC_PERS_CNT)
  if (Number(d.ADD_SUB_LADY_AMT)      > 0) set("8103", "incDdcNfpCnt", 1)
  if (Number(d.ADD_SUB_SNGL_PRNT_AMT) > 0) set("8104", "incDdcNfpCnt", 1)
  set("8201", "useAmt", d.NP_INSU_AMT)
  set("8301", "useAmt", d.SPCL_IF_HLTH_INSU_AMT)
  set("8305", "useAmt", d.SPCL_IF_EMP_INSU_AMT)

  if (strategy === "obj")       set("8750", "useAmt", d.SP_HOUSE_RENT_AMT)
  else if (strategy === "main") set("8750", "useAmt", d.MAIN_HOUSE_RENT)

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
function printRent(calcNo, d) {
  console.log(`\n══════════════════════════════════════════════════════`)
  console.log(`▶ ${calcNo}  총급여 ${fmt(d.TOT_PAY_AMT)}  세대주 ${d.HOUSE_HLDR_YN ?? "?"}`)
  console.log(`──────────────────────────────────────────────────────`)
  console.log(`  [YTS 월세]`)
  console.log(`    B) SP_HOUSE_RENT_AMT (공제대상,한도후) = ${fmt(d.SP_HOUSE_RENT_AMT)}`)
  console.log(`    C) MAIN_HOUSE_RENT   (지급총액,원본)   = ${fmt(d.MAIN_HOUSE_RENT)}`)
  console.log(`    ★ RT_HOUSE_RENT_AMT(정답,세액공제액)   = ${fmt(d.RT_HOUSE_RENT_AMT)}`)
}

function printShot(tag, base, shot, ytsAns) {
  const codes = Array.from(new Set([...Object.keys(base), ...Object.keys(shot)])).sort()
  console.log(`\n  [${tag}] NTS 응답 diff (변동 코드만)`)
  for (const code of codes) {
    const b = base[code] ?? 0, w = shot[code] ?? 0
    if (b !== w) console.log(`    ${code}   ${fmt(b).padStart(14)} → ${fmt(w).padStart(14)}  (Δ ${fmt(w - b)})`)
  }
  const ntsRent = shot[RENT_RESULT_CODE] ?? null
  const match = ntsRent != null && ytsAns != null && Number(ntsRent) === Number(ytsAns)
  console.log(`    → NTS 월세(${RENT_RESULT_CODE}) = ${fmt(ntsRent)}  vs YTS ${fmt(ytsAns)}  ${match ? "✅ 일치" : "❌"}`)
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
  if (!targets.length) { console.error("대상 없음 (월세공제 발생 건 미발견)"); process.exit(1) }
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
    printRent(calcNo, d)
    const ytsAns = Number(d.RT_HOUSE_RENT_AMT ?? 0)

    const baseRaw = await postL03(page, buildBody(d, "none")); await page.waitForTimeout(400)
    const objRaw  = await postL03(page, buildBody(d, "obj"));  await page.waitForTimeout(400)
    const mainRaw = await postL03(page, buildBody(d, "main")); await page.waitForTimeout(400)
    console.log(`    (응답 base=${resultCode(baseRaw)} / 공제대상=${resultCode(objRaw)} / 지급총액=${resultCode(mainRaw)})`)

    const base = toMap(baseRaw)
    printShot("B: 공제대상금액 전송(SP)", base, toMap(objRaw),  ytsAns)
    printShot("C: 지급총액 전송(MAIN)",   base, toMap(mainRaw), ytsAns)
  }

  await browser.close()
  console.log("\n완료.")
}

main().catch(e => { console.error("오류:", e.message); process.exit(1) })
