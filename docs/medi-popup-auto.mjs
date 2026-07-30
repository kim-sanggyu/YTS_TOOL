/**
 * 의료비 부양가족별 반자동 검증 (방법 B) — 총급여·그리드·계산·적용·대조는 자동, 팝업 열기·본화면 계산만 사람.
 *
 * 사람이 하는 것: ①실행 ②의료비 팝업 열기 ③콘솔 Enter ④본화면 [계산] 클릭.
 * 자동: 총급여 입력 / (Enter 후) 부양가족별 그리드 입력·팝업 계산하기·적용하기 / (본화면 계산 후) L03 캡처·YTS 대조.
 *
 * 그리드 id: #mf_gridMdxps_cell_{r}_{c}_text (c 1일반/2미숙아/3난임/4특례/5실손, r0=본인 특례열없음)
 * 총급여 #mf_txppWframe_iframe_sub_02_inputTotaSnwAmt / 팝업 계산 #mf_trigger31 적용 #mf_btnApply
 *
 * 사용법: node docs/medi-popup-auto.mjs [calcNo]   (기본 Y202500370)
 *   calcNo 앞 4자리 연도로 모의계산 버전 자동 선택 (Y2025..→2025, X2026..→2026).
 * ⚠ 국세청 모의계산 입력. DB 읽기전용. headed 필수.
 * ※ 팝업/그리드 셀렉터(UTEYSEJF19·#mf_gridMdxps_cell..)는 2025 화면 기준 — 2026 팝업이 다르면 조정 필요.
 */
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import oracledb from "../node_modules/oracledb/lib/oracledb.js"
import pw from "../node_modules/playwright/index.js"
const { chromium } = pw

const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const DB_USER = "YTS39", DB_PASS = "Yts391234!"
const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const OUT_DIR = "data/capture", LOG = path.join(OUT_DIR, "io.jsonl")
const CALC_NO = process.argv[2] || "Y202500370"
// calcNo 앞 4자리 숫자 = 귀속연도(Y202500370→2025, X202600518→2026) → 해당 연도 모의계산으로 진입.
// 연도 드롭다운 element id는 mapping/ntsProfile.ts 의 PROFILE_20xx.dropdownId 와 동일.
const YEAR = /^[A-Za-z](\d{4})/.exec(CALC_NO)?.[1] ?? "2025"
const DROPDOWN_ID = { "2025": "a_1905120000", "2026": "a_1905130000" }[YEAR]
if (!DROPDOWN_ID) { console.error(`✗ 지원하지 않는 귀속연도: ${YEAR} (2025/2026만 지원)`); process.exit(1) }
const SEL_PAY = "#mf_txppWframe_iframe_sub_02_inputTotaSnwAmt"
const fmt = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"))

let TARGET = null   // 대조용 (리스너가 참조)

async function db(sql, p = []) {
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  try { return (await conn.execute(sql, p, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? [] }
  finally { await conn.close() }
}
async function fetchTarget(calcNo) {
  const [c] = await db(`SELECT NVL(TOT_PAY_AMT,0) AS TOT_PAY, NVL(RT_MEDI_AMT,0) AS RT_MEDI, CALC_PROC_MEDI FROM YTS39.PAY_WRK_CALC WHERE CALC_NO=:1`, [calcNo])
  const fams = await db(`SELECT FMLY_SEQ, NVL(SUM(MEDI_AMT),0) AS AMT, NVL(SUM(MEDI_CA_AMT),0) AS CA, NVL(SUM(MEDI_ISA_AMT),0) AS ISA, NVL(SUM(MEDI_HDC_MC_AMT),0) AS HDC, NVL(SUM(MEDI_LOSS_INSU),0) AS LOSS FROM YTS39.PAY_WRK_FMLY_DTL WHERE CALC_NO=:1 GROUP BY FMLY_SEQ ORDER BY FMLY_SEQ`, [calcNo])
  let agg = {}; try { agg = JSON.parse(c.CALC_PROC_MEDI) } catch {}
  return { calcNo, totPay: Number(c.TOT_PAY), rtMedi: Number(c.RT_MEDI), agg, fams }
}

async function clickText(page, text, preferRight = false) {
  for (const f of page.frames()) {
    try {
      const ok = await f.evaluate(({ t, pr }) => {
        let els = Array.from(document.querySelectorAll("a,button,input,li,span,div")).filter(e => (e.offsetWidth || e.offsetHeight) && (e.textContent || e.value || "").trim() === t)
        if (pr) els = els.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)
        if (els[0]) { els[0].click(); return true }; return false
      }, { t: text, pr: preferRight })
      if (ok) return
    } catch {}
  }
}
async function establishSession(page) {
  await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(7000); await clickText(page, "모의계산", true); await page.waitForTimeout(6000)
  try { await page.getByText("연말정산 자동계산하기", { exact: true }).first().click({ timeout: 8000 }) } catch {}
  await page.waitForTimeout(2000)
  await page.evaluate((id) => { const els = Array.from(document.querySelectorAll(`[id="${id}"]`)); const vis = els.filter(e => e.offsetParent !== null); (vis[0] || els[0])?.click() }, DROPDOWN_ID)
  await page.waitForTimeout(9000)
}

async function findFrame(ctx, sel) {
  for (const p of ctx.pages()) for (const f of p.frames()) { try { if (await f.$(sel)) return f } catch {} }
  return null
}
function popupFrame(ctx) {
  for (const p of ctx.pages()) if (p.url().includes("popup.html") && p.url().includes("UTEYSEJF19")) return p.mainFrame()
  return null
}
// 본화면 input: JS value 세팅(websquare 물리입력 거부 우회)
async function jsSetVal(frame, sel, val) {
  return frame.evaluate(({ s, v }) => {
    const e = document.querySelector(s); if (!e) return false
    e.removeAttribute("readonly"); e.disabled = false; e.focus && e.focus(); e.value = v
    e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); e.blur && e.blur()
    return true
  }, { s: sel, v: String(val) })
}
// 팝업 그리드 셀: elementHandle click+fill (사람이 연 팝업에서 검증된 방식)
async function setCell(frame, row, col, val) {
  if (!val || Number(val) === 0) return
  const sel = `#mf_gridMdxps_cell_${row}_${col}_text`
  const el = await frame.$(sel); if (!el) { console.log(`     (셀 없음: ${sel})`); return }
  await el.click(); await el.fill(String(val))
  await frame.evaluate(s => { const e = document.querySelector(s); if (e) { e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); e.blur() } }, sel)
  console.log(`     ${sel} = ${Number(val).toLocaleString("ko-KR")}`)
}

// Enter 후: 그리드 자동입력 + 팝업 계산하기 + 적용하기
async function fillPopup(ctx) {
  const pf = popupFrame(ctx)
  if (!pf) { console.log("  ✗ 의료비 팝업을 못 찾음 — 팝업을 먼저 열고 Enter 하세요."); return }
  const fams = TARGET.fams
  for (let i = 3; i < fams.length; i++) { await pf.click("#mf_btnAddFmly").catch(() => {}); await pf.page().waitForTimeout(400).catch(() => {}) }
  for (let r = 0; r < fams.length; r++) {
    const f = fams[r]
    console.log(`   [row ${r}] FMLY_SEQ=${f.FMLY_SEQ}`)
    await setCell(pf, r, 1, Number(f.AMT) + (r === 0 ? Number(f.HDC) : 0))   // 본인은 일반+특례를 col1
    await setCell(pf, r, 2, f.CA)
    await setCell(pf, r, 3, f.ISA)
    if (r !== 0) await setCell(pf, r, 4, f.HDC)
    await setCell(pf, r, 5, f.LOSS)
  }
  const mainPage = ctx.pages()[0]
  console.log("  → 계산하기..."); await pf.click("#mf_trigger31").catch(() => {}); await mainPage.waitForTimeout(1200).catch(() => {})
  console.log("  → 적용하기..."); await pf.click("#mf_btnApply").catch(() => {}); await mainPage.waitForTimeout(1200).catch(() => {})
  console.log("  ✓ 입력·적용 완료. 이제 본화면에서 [계산]을 누르세요 → 자동 대조됩니다.")
}

// L03(8726 포함) IN/OUT 파싱
function lastMediL03() {
  const recs = fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  for (let i = recs.length - 1; i >= 0; i--) {
    const pd = recs[i].postData || ""
    if (!pd.includes("yrsTaxClcDetailDVOList") || !pd.includes('"8726"')) continue
    let body, resp = null
    try { body = JSON.parse(pd.slice(0, pd.indexOf("<nts") >= 0 ? pd.indexOf("<nts") : undefined)) } catch { continue }
    try { const r = recs[i].response || ""; resp = JSON.parse(r.slice(0, r.indexOf("<nts") >= 0 ? r.indexOf("<nts") : undefined)) } catch {}
    const IN = {}, OUT = {}
    for (const it of body.yrsTaxClcDetailDVOList ?? []) IN[String(it.amtClusCd)] = Number(it.useAmt ?? 0)
    for (const it of (resp?.yrsTaxClcDetailDVOList ?? [])) OUT[String(it.amtClusCd)] = Number(it.ddcAmt ?? 0)
    return { IN, OUT }
  }
  return null
}
function printCompare() {
  const io = lastMediL03(); if (!io) return false
  const t = TARGET
  const rows = [
    ["8720 본인등", io.IN["8720"], t.agg["본인등배려자"]],
    ["8721 그밖의", io.IN["8721"], t.agg["그밖의부양가족"]],
    ["8725 난임", io.IN["8725"], t.agg["난임시술비"]],
    ["8729 미숙아", io.IN["8729"], t.agg["미숙아등이상아"]],
    ["8726 소계지출", io.IN["8726"], t.agg["의료비지출금액"]],
  ]
  console.log(`\n  ══ ${t.calcNo} 대조 (총급여 ${fmt(t.totPay)}) ══`)
  console.log("  ── IN (NTS payload ↔ YTS 유형집계) ──")
  for (const [lbl, nts, yts] of rows) console.log(`     ${lbl.padEnd(12)} NTS ${fmt(nts).padStart(12)} ↔ YTS ${fmt(yts).padStart(12)}  ${Number(nts || 0) === Number(yts || 0) ? "✅" : "❌"}`)
  console.log(`  ── OUT 공제 (NTS 8726 ↔ YTS RT_MEDI) ──`)
  console.log(`     8726 공제      NTS ${fmt(io.OUT["8726"]).padStart(12)} ↔ YTS ${fmt(t.rtMedi).padStart(12)}  ${Number(io.OUT["8726"] || 0) === t.rtMedi ? "✅" : "❌"}`)
  return true
}

async function main() {
  oracledb.initOracleClient({ libDir: ORACLE_LIB }); oracledb.fetchAsString = [oracledb.CLOB]
  fs.mkdirSync(OUT_DIR, { recursive: true }); fs.writeFileSync(LOG, "")
  TARGET = await fetchTarget(CALC_NO)
  console.log(`[DB] ${CALC_NO} (${YEAR} 귀속 → ${YEAR} 모의계산) 총급여 ${fmt(TARGET.totPay)}`)
  console.log(`  [YTS 유형집계] 본인등 ${fmt(TARGET.agg["본인등배려자"])} · 그밖의 ${fmt(TARGET.agg["그밖의부양가족"])} · 난임 ${fmt(TARGET.agg["난임시술비"])} · 미숙아 ${fmt(TARGET.agg["미숙아등이상아"])} → 공제 ${fmt(TARGET.rtMedi)}`)
  console.table(TARGET.fams)

  console.log("[1] 브라우저 기동 (headed)...")
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await ctx.newPage(); page.on("dialog", d => d.accept().catch(() => {}))
  // L03 캡처 + 8726 나오면 자동 대조
  ctx.on("response", async resp => {
    let req; try { req = resp.request() } catch { return }
    if (req.method() !== "POST") return
    const url = req.url(); if (/permission\.do|token\.do/.test(url)) return
    if (!(url.includes("wqAction.do") || url.includes("Action"))) return
    const postData = req.postData() ?? ""; let response = ""; try { response = await resp.text() } catch {}
    fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), postData, response }) + "\n")
    if (postData.includes("yrsTaxClcDetailDVOList") && postData.includes('"8726"')) { await new Promise(r => setTimeout(r, 300)); printCompare() }
  })
  console.log("[2] 세션 수립...")
  await establishSession(page)

  console.log("\n════════════════════════════════════════════")
  console.log(`  ① 화면에서 총급여 ${fmt(TARGET.totPay)} 을 입력하고 [적용]하세요.`)
  console.log("     (총급여 자동입력은 websquare 에 반영 안 돼 수동 — 근로소득금액이 산출돼야 의료비 3% 문턱 계산됨)")
  console.log("  ② [의료비] 상세 팝업을 여세요.")
  console.log("  ③ 팝업이 뜨면 이 콘솔에서 Enter → 그리드 자동입력·계산·적용.")
  console.log("  ④ 그다음 본화면 [계산] → 자동으로 YTS 대조 출력.")
  console.log("  (끝나면 Ctrl+C)")
  console.log("════════════════════════════════════════════\n")
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.on("line", async () => { await fillPopup(ctx).catch(e => console.log("오류:", e.message)) })
  await new Promise(() => {})
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
