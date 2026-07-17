/**
 * 홈택스 모의계산 — 교육비(8730~8734) send→receive 계약 프로브
 *
 * 배경: 매핑 8730~8734 전부 status:추정·send:false. YTS는 SPCL_EDU_AMT(한도후 통합) 단일컬럼이라
 *   "구분분할 불가"로 막혀 있었으나, PAY_WRK_MAIN 에 구분별 원본 지출이 있음을 발견:
 *     EDU_SELF_AMT(본인)→8730 / EDU_ENT_PREV_AMT(취학전)→8731 / EDU_INFC_AMT(초중고)→8732
 *     EDU_UNV_STUD_AMT(대학생)→8733 / EDU_HDC_PERS_AMT(장애인)→8734
 *   RT_EDU_AMT = SPCL_EDU_AMT(한도후) × 15%. 구분합==공제대상 162명 / 불일치 29명(대학 900만/인 등 한도).
 *
 * 확인할 것:
 *   ① 결과 코드: 교육비 세액공제가 어느 amtClusCd 로 회신되나(8730~34 self? 별도 소계?)
 *   ② 구분별(원본) 전송 시 국세청이 인당한도를 어떻게 적용하나 → 합산액 한칸 넣기가 성립하나
 *   ③ 필드: useAmt vs ddcTrgtAmt (매핑 현재 ddcTrgtAmt 추정)
 *   ④ 단일버킷(SPCL_EDU_AMT→8730)으로도 총액이 재현되나
 *
 * 방법: 사람마다 5발. 변동 OUT 코드 전부 덤프 + RT_EDU_AMT 와 일치하는 코드 강조.
 *   base / 구분별-useAmt / 구분별-ddcTrgt / 단일-useAmt(SPCL→8730) / 단일-ddcTrgt
 *
 * 사용법: node docs/hometax-education-probe.mjs   (다양 케이스 자동 5명)
 *         node docs/hometax-education-probe.mjs X202600351
 * ⚠ 읽기전용. eversafe → headed 필수.
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

// EDU 구분 → NTS 코드
const EDU_MAP = [
  ["EDU_SELF", "8730"],  // 본인(무한도)
  ["EDU_PREV", "8731"],  // 취학전아동(300만/인)
  ["EDU_INFC", "8732"],  // 초중고(300만/인)
  ["EDU_UNV",  "8733"],  // 대학생(900만/인)
  ["EDU_HDC",  "8734"],  // 장애인(무한도)
]

async function dbQuery(sql, params = []) {
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  try {
    const r = await conn.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT })
    return r.rows ?? []
  } finally { await conn.close() }
}

async function pickTargets() {
  if (specificCalcNo) return [specificCalcNo]
  // 다양 케이스: 본인단독 / 초중고+장애 / 대학한도 / 대학큰한도 / 취학전 등
  return ["X202600318", "X202600351", "X202600112", "X202600160", "X202600146"]
}

async function fetchYts(calcNo) {
  const rows = await dbQuery(`
    SELECT c.CALC_NO,
      c.TOT_PAY_AMT, c.PAYM_INCM_TAX,
      c.BASC_SUB_MATE_AMT, c.BASC_SUB_FAMILY_CNT,
      c.ADD_SUB_OAT_CNT, c.ADD_SUB_HDC_PERS_CNT, c.ADD_SUB_LADY_AMT, c.ADD_SUB_SNGL_PRNT_AMT,
      c.NP_INSU_AMT, c.SPCL_IF_HLTH_INSU_AMT, c.SPCL_IF_EMP_INSU_AMT,
      NVL(c.SPCL_EDU_AMT,0) AS OBJ, NVL(c.RT_EDU_AMT,0) AS RT,
      NVL(m.EDU_SELF_AMT,0) AS EDU_SELF, NVL(m.EDU_ENT_PREV_AMT,0) AS EDU_PREV,
      NVL(m.EDU_INFC_AMT,0) AS EDU_INFC, NVL(m.EDU_UNV_STUD_AMT,0) AS EDU_UNV,
      NVL(m.EDU_HDC_PERS_AMT,0) AS EDU_HDC,
      c.EXHAUSTED_POINT
    FROM YTS39.PAY_WRK_CALC c JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO=c.CALC_NO
    WHERE c.CALC_NO = :1
  `, [calcNo])
  if (!rows.length) throw new Error(`CALC_NO 없음: ${calcNo}`)
  return rows[0]
}

const ALL_CODES = [
  "8900","8991",
  "8001","8002","8003","8101","8102","8103","8104",
  "8201","8301","8305",
  "8730","8731","8732","8733","8734",
  "8901","8902","8903","8923","8990","8992","8998","8999",
]

function baseDetail() {
  return ALL_CODES.map(code => ({
    amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0",
  }))
}

// strategy: none | edu_use | edu_trgt | single_use | single_trgt
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

  const field = strategy.endsWith("trgt") ? "ddcTrgtAmt" : "useAmt"
  if (strategy.startsWith("edu")) {
    set("8730", field, d.EDU_SELF)
    set("8731", field, d.EDU_PREV)
    set("8732", field, d.EDU_INFC)
    set("8733", field, d.EDU_UNV)
    set("8734", field, d.EDU_HDC)
  } else if (strategy.startsWith("single")) {
    set("8730", field, d.OBJ)   // 한도후 공제대상 전액을 본인(무한도)에
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

function printHead(calcNo, d) {
  console.log(`\n══════════════════════════════════════════════════════`)
  console.log(`▶ ${calcNo}  총급여 ${fmt(d.TOT_PAY_AMT)}  소진 ${d.EXHAUSTED_POINT ?? "?"}`)
  console.log(`  [구분별 원본지출] 본인 ${fmt(d.EDU_SELF)} · 취학전 ${fmt(d.EDU_PREV)} · 초중고 ${fmt(d.EDU_INFC)} · 대학 ${fmt(d.EDU_UNV)} · 장애 ${fmt(d.EDU_HDC)}`)
  console.log(`  [YTS] 공제대상(한도후) ${fmt(d.OBJ)} → ★세액공제 RT_EDU_AMT ${fmt(d.RT)} (=15%)`)
  console.log(`──────────────────────────────────────────────────────`)
}

function printShot(tag, base, shot, rtEdu) {
  const codes = Array.from(new Set([...Object.keys(base), ...Object.keys(shot)])).sort()
  const changed = codes.filter(c => (base[c] ?? 0) !== (shot[c] ?? 0))
  const parts = changed.map(c => `${c}:${fmt(shot[c] ?? 0)}`).join("  ")
  // RT_EDU_AMT 와 같은 변동코드 찾기
  const hit = changed.filter(c => (shot[c] ?? 0) === Number(rtEdu) && Number(rtEdu) > 0)
  console.log(`  [${tag}]  변동: ${parts || "(없음)"}`)
  console.log(`        → RT_EDU_AMT(${fmt(rtEdu)}) 와 일치하는 코드: ${hit.length ? hit.join(",") : "❌ 없음"}`)
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
    const rt = Number(d.RT)

    const baseRaw = await postL03(page, buildBody(d, "none"));        await page.waitForTimeout(400)
    const euRaw   = await postL03(page, buildBody(d, "edu_use"));     await page.waitForTimeout(400)
    const etRaw   = await postL03(page, buildBody(d, "edu_trgt"));    await page.waitForTimeout(400)
    const suRaw   = await postL03(page, buildBody(d, "single_use"));  await page.waitForTimeout(400)
    const stRaw   = await postL03(page, buildBody(d, "single_trgt")); await page.waitForTimeout(400)
    console.log(`    (응답 ${["base","eu","et","su","st"].map((k,i)=>k+"="+resultCode([baseRaw,euRaw,etRaw,suRaw,stRaw][i])).join(" ")})`)

    const base = toMap(baseRaw)
    printShot("A 구분별·useAmt",   base, toMap(euRaw), rt)
    printShot("B 구분별·ddcTrgt",  base, toMap(etRaw), rt)
    printShot("C 단일→8730·useAmt", base, toMap(suRaw), rt)
    printShot("D 단일→8730·ddcTrgt",base, toMap(stRaw), rt)
  }

  await browser.close()
  console.log("\n완료.")
}

main().catch(e => { console.error("오류:", e.message); process.exit(1) })
