/**
 * 홈택스 모의계산 — 보장성보험료(8710)·장애인전용 보장성보험료(8711) send→receive 계약 프로브
 *
 * 목적: 매핑 8710(추정·send:true)/8711(추정·send:false)을 실측 확정.
 *   ① 보낼 값 : 공제대상금액(SPCL_IF_*, 이미 100만 capped) 을 useAmt 로 → NTS 가 12%/15% 적용해 일치하나?
 *              (보험료는 지출총액 원본컬럼이 없음. 한도 100만=총급여 무관 정액이라 공제대상 전송이 유력)
 *   ② 받는 값 : 8710/8711 각자 self OUT(ddcAmt) 인가, 아니면 별도 소계코드인가 → 변동코드 전부 덤프
 *
 * 검증 기준(YTS 정답):
 *   NTS 8710 ddcAmt == RT_IF_GRT_INSU_AMT      (보장성, 12%)
 *   NTS 8711 ddcAmt == RT_IF_HDC_PERS_INSU_AMT (장애인전용, 15%)
 *
 * 방법: 사람마다 4발 발사 후 응답 ntsMap diff.
 *   A) baseline(보험료 미포함)
 *   B) +8710 only  (공제대상 SPCL_IF_GRT_INSU_AMT)
 *   C) +8711 only  (공제대상 SPCL_IF_HDC_PERS_INSU_AMT)
 *   D) +둘다        (독립 OUT·상호 간섭 없나 확인)
 *
 * 사용법:
 *   node docs/hometax-insurance-probe.mjs          → 장애인전용 3명 + 보장성 고액 2명(자동)
 *   node docs/hometax-insurance-probe.mjs X202600154
 *
 * ⚠ 읽기 전용(DB SELECT + NTS 조회). 저장 없음. eversafe 때문에 headed 필수(실제 Chrome 창).
 */

import oracledb from "../node_modules/oracledb/lib/oracledb.js"
import pw       from "../node_modules/playwright/index.js"

const { chromium } = pw

const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const DB_USER    = "YTS39"
const DB_PASS    = "Yts391234!"
const START_URL  = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const L03_URL    = "https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEAA001L03&screenId=UTEYSEJF01&popupYn=false&realScreenId="
const ATTR_YR    = "2025"

const arg1 = process.argv[2]
const specificCalcNo = arg1 && /^X\d{9,}$/.test(arg1) ? arg1 : null

async function dbQuery(sql, params = []) {
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  try {
    const r = await conn.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT })
    return r.rows ?? []
  } finally { await conn.close() }
}

async function pickTargets() {
  if (specificCalcNo) return [specificCalcNo]
  // 장애인전용 발생자(8710·8711 동시검증) 먼저, 그다음 보장성 고액자.
  const hdc = await dbQuery(`SELECT CALC_NO FROM (
    SELECT CALC_NO FROM YTS39.PAY_WRK_CALC
    WHERE CALC_NO LIKE 'X2026%' AND NVL(RT_IF_HDC_PERS_INSU_AMT,0)>0
    ORDER BY RT_IF_HDC_PERS_INSU_AMT DESC) WHERE ROWNUM<=5`)
  const grt = await dbQuery(`SELECT CALC_NO FROM (
    SELECT CALC_NO FROM YTS39.PAY_WRK_CALC
    WHERE CALC_NO LIKE 'X2026%' AND NVL(RT_IF_GRT_INSU_AMT,0)>0 AND NVL(RT_IF_HDC_PERS_INSU_AMT,0)=0
    ORDER BY RT_IF_GRT_INSU_AMT DESC) WHERE ROWNUM<=2`)
  return [...hdc.map(r => r.CALC_NO), ...grt.map(r => r.CALC_NO)]
}

async function fetchYts(calcNo) {
  const rows = await dbQuery(`
    SELECT c.CALC_NO,
      c.TOT_PAY_AMT, c.PAYM_INCM_TAX, c.PROD_TAX_AMT, c.RES_INCM_TAX, c.SUB_INCM_TAX,
      c.BASC_SUB_MATE_AMT, c.BASC_SUB_FAMILY_CNT,
      c.ADD_SUB_OAT_CNT, c.ADD_SUB_HDC_PERS_CNT, c.ADD_SUB_LADY_AMT, c.ADD_SUB_SNGL_PRNT_AMT,
      c.NP_INSU_AMT, c.SPCL_IF_HLTH_INSU_AMT, c.SPCL_IF_EMP_INSU_AMT,
      NVL(c.SPCL_IF_GRT_INSU_AMT, 0)      AS OBJ_GRT,
      NVL(c.RT_IF_GRT_INSU_AMT, 0)        AS RT_GRT,
      NVL(c.SPCL_IF_HDC_PERS_INSU_AMT, 0) AS OBJ_HDC,
      NVL(c.RT_IF_HDC_PERS_INSU_AMT, 0)   AS RT_HDC,
      c.EXHAUSTED_POINT
    FROM YTS39.PAY_WRK_CALC c
    WHERE c.CALC_NO = :1
  `, [calcNo])
  if (!rows.length) throw new Error(`CALC_NO 없음: ${calcNo}`)
  return rows[0]
}

const ALL_CODES = [
  "8900","8991",
  "8001","8002","8003","8101","8102","8103","8104",
  "8201","8301","8305",
  "8710","8711",
  "8901","8902","8903","8923","8990","8992","8998","8999",
]

function baseDetail() {
  return ALL_CODES.map(code => ({
    amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0",
  }))
}

// strategy: "none" | "grt" | "hdc" | "both"
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

  if (strategy === "grt" || strategy === "both") set("8710", "useAmt", d.OBJ_GRT)
  if (strategy === "hdc" || strategy === "both") set("8711", "useAmt", d.OBJ_HDC)

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

function printHead(calcNo, d) {
  console.log(`\n══════════════════════════════════════════════════════`)
  console.log(`▶ ${calcNo}  총급여 ${fmt(d.TOT_PAY_AMT)}  소진 ${d.EXHAUSTED_POINT ?? "?"}`)
  console.log(`  [YTS 정답] 보장성   공제대상 ${fmt(d.OBJ_GRT)} → 세액공제 ${fmt(d.RT_GRT)}`)
  console.log(`             장애인전용 공제대상 ${fmt(d.OBJ_HDC)} → 세액공제 ${fmt(d.RT_HDC)}`)
  console.log(`──────────────────────────────────────────────────────`)
}

function printShot(tag, base, shot) {
  const codes = Array.from(new Set([...Object.keys(base), ...Object.keys(shot)])).sort()
  const changed = codes.filter(c => (base[c] ?? 0) !== (shot[c] ?? 0))
  console.log(`  [${tag}] 변동 OUT 코드: ${changed.length ? "" : "(없음)"}`)
  for (const code of changed) {
    console.log(`     ${code}  ${fmt(base[code] ?? 0).padStart(12)} → ${fmt(shot[code] ?? 0).padStart(12)}  (Δ ${fmt((shot[code] ?? 0) - (base[code] ?? 0))})`)
  }
}

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

async function main() {
  console.log("[1] Oracle 연결...")
  oracledb.initOracleClient({ libDir: ORACLE_LIB })
  oracledb.fetchAsString = [oracledb.CLOB]

  const targets = await pickTargets()
  if (!targets.length) { console.error("대상 없음"); process.exit(1) }
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
    printHead(calcNo, d)

    const baseRaw = await postL03(page, buildBody(d, "none")); await page.waitForTimeout(400)
    const grtRaw  = await postL03(page, buildBody(d, "grt"));  await page.waitForTimeout(400)
    const hdcRaw  = await postL03(page, buildBody(d, "hdc"));  await page.waitForTimeout(400)
    const bothRaw = await postL03(page, buildBody(d, "both")); await page.waitForTimeout(400)
    console.log(`    (응답 base=${resultCode(baseRaw)} grt=${resultCode(grtRaw)} hdc=${resultCode(hdcRaw)} both=${resultCode(bothRaw)})`)

    const base = toMap(baseRaw), grt = toMap(grtRaw), hdc = toMap(hdcRaw), both = toMap(bothRaw)
    printShot("B: +8710 보장성(공제대상)", base, grt)
    printShot("C: +8711 장애인전용(공제대상)", base, hdc)
    printShot("D: +둘다", base, both)

    const okGrt = (grt["8710"] ?? 0) === Number(d.RT_GRT)
    const okHdc = (hdc["8711"] ?? 0) === Number(d.RT_HDC)
    console.log(`    ⇒ 8710 = ${fmt(grt["8710"])} vs YTS ${fmt(d.RT_GRT)}  ${okGrt ? "✅" : "❌"}` +
                `   /  8711 = ${fmt(hdc["8711"])} vs YTS ${fmt(d.RT_HDC)}  ${Number(d.RT_HDC) ? (okHdc ? "✅" : "❌") : "(대상아님)"}`)
  }

  await browser.close()
  console.log("\n완료.")
}

main().catch(e => { console.error("오류:", e.message); process.exit(1) })
