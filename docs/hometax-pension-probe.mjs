/**
 * 홈택스 모의계산 — 연금계좌 세액공제 send→receive 계약 프로브
 *
 * 목적: 연금계좌 비교화면 전에 실측 확정.
 *   ① 보낼 값  : RSIGN_PEN_*_AMT(납입액) 을 8701/8702/8703(+ISA 8708) 에 → NTS가 한도·12% 자체계산?
 *   ② 받는 값  : NTS가 연금계좌 세액공제 총합을 어느 코드(추정 8706)로 반환?
 *   ③ 대조     : NTS 8706  vs  YTS Σ(RT_RSIGN_PEN_TECH/RET/PF + RT_ISA_PEN) (세액공제액, =정답)
 *
 * 연금계좌는 CLOB 없이 컬럼 직접 존재 → 납입액 그대로 전송.
 *
 * 사용법:
 *   node docs/hometax-pension-probe.mjs           → 연금계좌 대상자 자동 3명(X2026)
 *   node docs/hometax-pension-probe.mjs X2026 5
 *   node docs/hometax-pension-probe.mjs X202600108
 *
 * ⚠ 읽기 전용(DB SELECT + NTS 조회). 저장 없음.
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
const PEN_RESULT_CODE = "8706"   // NTS 연금계좌 세액공제 총합(추정) — 프로브로 확정

// 납입액 컬럼 → NTS 코드 (+ 세액공제 결과컬럼)
const PEN_CATS = [
  { paid: "TECH", rt: "RT_TECH", label: "과학기술인", code: "8701" },
  { paid: "RET",  rt: "RT_RET",  label: "IRP퇴직급여", code: "8702" },
  { paid: "PF",   rt: "RT_PF",   label: "연금저축",   code: "8703" },
  { paid: "ISA",  rt: "RT_ISA",  label: "ISA만기납입", code: "8708" },
]

const arg1 = process.argv[2]
const arg2 = process.argv[3]
const specificCalcNo = arg1 && /^X\d{9,}$/.test(arg1) ? arg1 : null
const prefix = arg1 && !specificCalcNo ? arg1 : "X2026"
const limit  = Number(arg2) || 3

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
      SELECT c.CALC_NO,
        NVL(c.RSIGN_PEN_TECH_AMT,0)+NVL(c.RSIGN_PEN_RET_AMT,0)+NVL(c.RSIGN_PEN_PF_AMT,0)+NVL(c.ISA_PEN_AMT,0) AS PEN_SUM
      FROM YTS39.PAY_WRK_CALC c
      WHERE c.CALC_NO LIKE '${prefix}%'
        AND NVL(c.RSIGN_PEN_TECH_AMT,0)+NVL(c.RSIGN_PEN_RET_AMT,0)+NVL(c.RSIGN_PEN_PF_AMT,0)+NVL(c.ISA_PEN_AMT,0) > 0
      ORDER BY PEN_SUM DESC
    ) WHERE ROWNUM <= :1
  `, [limit])
  return rows.map(r => r.CALC_NO)
}

async function fetchYts(calcNo) {
  const rows = await dbQuery(`
    SELECT c.CALC_NO,
      c.TOT_PAY_AMT, c.PAYM_INCM_TAX,
      c.BASC_SUB_MATE_AMT, c.BASC_SUB_FAMILY_CNT,
      c.ADD_SUB_OAT_CNT, c.ADD_SUB_HDC_PERS_CNT, c.ADD_SUB_LADY_AMT, c.ADD_SUB_SNGL_PRNT_AMT,
      c.NP_INSU_AMT, c.SPCL_IF_HLTH_INSU_AMT, c.SPCL_IF_EMP_INSU_AMT,
      NVL(c.RSIGN_PEN_TECH_AMT,0) AS TECH, NVL(c.RSIGN_PEN_RET_AMT,0) AS RET,
      NVL(c.RSIGN_PEN_PF_AMT,0) AS PF, NVL(c.ISA_PEN_AMT,0) AS ISA,
      NVL(c.RT_RSIGN_PEN_TECH_AMT,0) AS RT_TECH, NVL(c.RT_RSIGN_PEN_RET_AMT,0) AS RT_RET,
      NVL(c.RT_RSIGN_PEN_PF_AMT,0) AS RT_PF, NVL(c.RT_ISA_PEN_AMT,0) AS RT_ISA
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
  "8701","8702","8703","8705","8706","8707","8708",
  "8901","8902","8903","8923","8990","8992","8998","8999",
]
function baseDetail() {
  return ALL_CODES.map(code => ({
    amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0",
  }))
}
function buildBody(d, withPen) {
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

  // ISA(8708)는 YTS ISA_PEN_AMT=공제대상(전환액×10%)이라 NTS 전환액으로 복원(×10) 후 전송.
  if (withPen) for (const cat of PEN_CATS) {
    const raw = Number(d[cat.paid] ?? 0)
    set(cat.code, "useAmt", cat.paid === "ISA" ? raw * 10 : raw)
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

function printPen(calcNo, d) {
  const ytsAns = Number(d.RT_TECH) + Number(d.RT_RET) + Number(d.RT_PF) + Number(d.RT_ISA)
  console.log(`\n══════════════════════════════════════════════════════`)
  console.log(`▶ ${calcNo}  총급여 ${fmt(d.TOT_PAY_AMT)}`)
  console.log(`──────────────────────────────────────────────────────`)
  console.log("  [YTS 연금계좌]           납입액          세액공제(RT)   → 코드")
  for (const cat of PEN_CATS) {
    console.log(`    ${cat.label.padEnd(12)} ${fmt(d[cat.paid]).padStart(13)}  ${fmt(d[cat.rt]).padStart(13)}   ${cat.code}`)
  }
  console.log(`    ★ YTS 세액공제 합계(정답) = ${fmt(ytsAns)}`)
  return ytsAns
}

function printShot(base, shot, ytsAns) {
  const codes = Array.from(new Set([...Object.keys(base), ...Object.keys(shot)])).sort()
  console.log(`\n  [+연금(납입액) 전송] NTS 응답 diff (변동 코드만)`)
  for (const code of codes) {
    const b = base[code] ?? 0, w = shot[code] ?? 0
    if (b !== w) console.log(`    ${code}   ${fmt(b).padStart(13)} → ${fmt(w).padStart(13)}  (Δ ${fmt(w - b)})`)
  }
  const nts = shot[PEN_RESULT_CODE] ?? null
  const match = nts != null && Number(nts) === Number(ytsAns)
  console.log(`    → NTS 연금계좌(${PEN_RESULT_CODE}) = ${fmt(nts)}  vs YTS ${fmt(ytsAns)}  ${match ? "✅ 일치" : "❌"}`)
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
  if (!targets.length) { console.error("대상 없음 (연금계좌 납입 건 미발견)"); process.exit(1) }
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
    const ytsAns = printPen(calcNo, d)
    const baseRaw = await postL03(page, buildBody(d, false)); await page.waitForTimeout(400)
    const penRaw  = await postL03(page, buildBody(d, true));  await page.waitForTimeout(400)
    console.log(`    (응답 base=${resultCode(baseRaw)} / 연금=${resultCode(penRaw)})`)
    printShot(toMap(baseRaw), toMap(penRaw), ytsAns)
  }

  await browser.close()
  console.log("\n완료.")
}

main().catch(e => { console.error("오류:", e.message); process.exit(1) })
