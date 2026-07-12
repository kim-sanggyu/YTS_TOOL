/**
 * 홈택스 모의계산 — 의료비 send→receive 계약 프로브
 *
 * 목적: 의료비 비교화면 전에 실측 확정.
 *   ① 보낼 값  : PAY_WRK_CALC.CALC_PROC_MEDI(JSON) — 대상자별 지출금액 vs 공제대상금액 中 무엇을 보내야 NTS와 맞나
 *   ② 받는 값  : NTS 가 의료비 세액공제를 어느 amtClusCd(추정 8726)로 돌려주나
 *
 * 방법: 사람마다 3발 발사 후 응답 ntsMap diff.
 *   A) baseline(의료비 미포함)
 *   B) +의료비[지출금액]      → 8720/8721/8725/8729 에 지출액 주입
 *   C) +의료비[공제대상금액]  → 동 코드에 *_공제대상 주입
 *   각 결과의 NTS 8726 을 YTS 의료비_공제금액(정답)과 대조 → 맞는 전략 판별.
 *
 * 사용법:
 *   node docs/hometax-medi-probe.mjs            → 의료비공제 대상자 자동 3명(X2026)
 *   node docs/hometax-medi-probe.mjs X2026 5    → 접두 + 건수
 *   node docs/hometax-medi-probe.mjs X202600123 → 특정 CALC_NO
 *
 * ⚠ 읽기 전용(DB SELECT + NTS 조회). 저장 없음.
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
const MEDI_RESULT_CODE = "8726"   // NTS 의료비 세액공제 결과코드(추정) — 프로브로 확정

// ── 의료비 카테고리: CALC_PROC_MEDI JSON 키 → NTS amtClusCd ────────────────────
//   지출키 / 공제대상키 두 후보를 함께 보유(전략 B·C 비교용)
const MEDI_CATS = [
  { spend: "본인등배려자",   obj: "본인등배려자_공제대상",   label: "본인·65세·장애인",   code: "8720" },
  { spend: "그밖의부양가족", obj: "그밖의부양가족_공제대상", label: "그 밖의 공제대상자", code: "8721" },
  { spend: "난임시술비",     obj: "난임시술비_공제대상",     label: "난임시술비",         code: "8725" },
  { spend: "미숙아등이상아", obj: "미숙아등이상아_공제대상", label: "미숙아·선천성이상아", code: "8729" },
]

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
        AND c.CALC_PROC_MEDI IS NOT NULL
        AND NVL(c.RT_MEDI_AMT, 0) > 0
      ORDER BY NVL(c.RT_MEDI_AMT, 0) DESC
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
      NVL(c.SPCL_MEDI_AMT, 0) AS SPCL_MEDI_AMT, NVL(c.RT_MEDI_AMT, 0) AS RT_MEDI_AMT,
      c.CALC_PROC_MEDI
    FROM YTS39.PAY_WRK_CALC c
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
  "8720","8721","8725","8726","8729",
  "8901","8902","8903","8923","8990","8992","8998","8999",
]

function baseDetail() {
  return ALL_CODES.map(code => ({
    amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0",
  }))
}

// strategy: "none" | "spend"(지출) | "obj"(공제대상)
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

  if (strategy !== "none") {
    const m = parseMedi(d.CALC_PROC_MEDI)
    if (m) {
      for (const cat of MEDI_CATS) {
        const v = Number(m[strategy === "spend" ? cat.spend : cat.obj] ?? 0)
        if (v > 0) set(cat.code, "useAmt", v)
      }
    }
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

function parseMedi(json) {
  if (!json || json === "null") return null
  try { return JSON.parse(json) } catch { return null }
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
function printMedi(calcNo, d) {
  const m = parseMedi(d.CALC_PROC_MEDI)
  console.log(`\n══════════════════════════════════════════════════════`)
  console.log(`▶ ${calcNo}  총급여 ${fmt(d.TOT_PAY_AMT)}  RT_MEDI_AMT ${fmt(d.RT_MEDI_AMT)}  SPCL_MEDI_AMT ${fmt(d.SPCL_MEDI_AMT)}`)
  console.log(`──────────────────────────────────────────────────────`)
  if (!m) { console.log("  CALC_PROC_MEDI 없음/파싱실패"); return null }
  console.log("  [YTS 대상자별]                    지출금액        공제대상        → 코드")
  for (const cat of MEDI_CATS) {
    console.log(`    ${cat.label.padEnd(16)} ${fmt(m[cat.spend]).padStart(14)}  ${fmt(m[cat.obj]).padStart(14)}   ${cat.code}`)
  }
  console.log(`    최저사용액(3%) ${fmt(m.의료비최저사용액)} · 지출총액 ${fmt(m.의료비지출금액)} · 공제대상총액 ${fmt(m.의료비_공제대상금액)}`)
  console.log(`    ★ 의료비_공제금액(정답) = ${fmt(m.의료비_공제금액)}   (RT_MEDI_AMT=${fmt(d.RT_MEDI_AMT)})`)
  return m
}

function printShot(tag, base, shot, ytsAns) {
  const codes = Array.from(new Set([...Object.keys(base), ...Object.keys(shot)])).sort()
  console.log(`\n  [${tag}] NTS 응답 diff (변동 코드만)`)
  for (const code of codes) {
    const b = base[code] ?? 0, w = shot[code] ?? 0
    if (b !== w) console.log(`    ${code}   ${fmt(b).padStart(14)} → ${fmt(w).padStart(14)}  (Δ ${fmt(w - b)})`)
  }
  const ntsMedi = shot[MEDI_RESULT_CODE] ?? null
  const match = ntsMedi != null && ytsAns != null && Number(ntsMedi) === Number(ytsAns)
  console.log(`    → NTS 의료비(${MEDI_RESULT_CODE}) = ${fmt(ntsMedi)}  vs YTS ${fmt(ytsAns)}  ${match ? "✅ 일치" : "❌"}`)
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
  if (!targets.length) { console.error("대상 없음 (의료비공제 발생 건 미발견)"); process.exit(1) }
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
    const m = printMedi(calcNo, d)
    const ytsAns = m ? Number(m.의료비_공제금액 ?? 0) : Number(d.RT_MEDI_AMT ?? 0)

    const baseRaw  = await postL03(page, buildBody(d, "none"));  await page.waitForTimeout(400)
    const spendRaw = await postL03(page, buildBody(d, "spend")); await page.waitForTimeout(400)
    const objRaw   = await postL03(page, buildBody(d, "obj"));   await page.waitForTimeout(400)
    console.log(`    (응답 base=${resultCode(baseRaw)} / 지출=${resultCode(spendRaw)} / 공제대상=${resultCode(objRaw)})`)

    const base = toMap(baseRaw)
    printShot("B: 지출금액 전송",     base, toMap(spendRaw), ytsAns)
    printShot("C: 공제대상금액 전송", base, toMap(objRaw),   ytsAns)
  }

  await browser.close()
  console.log("\n완료.")
}

main().catch(e => { console.error("오류:", e.message); process.exit(1) })
