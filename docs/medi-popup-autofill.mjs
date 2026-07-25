/**
 * 의료비 팝업 부양가족별 자동입력 (방법 B, 2단계) — YTS FMLY_DTL 대상자별 의료비를 NTS 팝업 그리드에 채운다.
 *
 * 목적: YTS 부양가족별 원본을 NTS 팝업 대상자별(본인/가족1/가족2) 그리드에 그대로 입력 → 국세청 UI 가
 *   유형별로 집계(본인/그밖의 분류·실손 차감)하는 로직이 YTS(CALC_PROC_MEDI)와 일치하는지 대조.
 *
 * 그리드 id: mf_gridMdxps_cell_{row}_{col}_text  (row 0=본인·1=가족1·…, col 1=일반/2=미숙아/3=난임/4=특례/5=실손)
 *   ★본인(row0)은 특례열(4) 없음 → 본인 MEDI_HDC_MC_AMT 는 col1(일반)에 합산.
 * 버튼: 가족추가 mf_btnAddFmly / 계산하기 mf_trigger31 / 적용하기 mf_btnApply
 *
 * 사용법: node docs/medi-popup-autofill.mjs [calcNo]   (기본 Y202500370 이혜진)
 *   1) 세션 자동수립 → 화면에서 [의료비] 팝업 열고 콘솔 Enter
 *   2) 스크립트가 대상자별 값 자동입력 + 계산하기 + 적용하기
 *   3) 본화면에서 [계산] 누르면 L03 캡처(io.jsonl) → node docs/hometax-capture-io.mjs --parse
 * ⚠ 국세청에 값 입력(모의계산 한정). DB 읽기전용. headed 필수.
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

async function dbFamilyMedi(calcNo) {
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  try {
    const r = await conn.execute(`
      SELECT FMLY_SEQ,
             NVL(SUM(MEDI_AMT),0)         AS AMT,
             NVL(SUM(MEDI_CA_AMT),0)      AS CA,
             NVL(SUM(MEDI_ISA_AMT),0)     AS ISA,
             NVL(SUM(MEDI_HDC_MC_AMT),0)  AS HDC,
             NVL(SUM(MEDI_LOSS_INSU),0)   AS LOSS
      FROM YTS39.PAY_WRK_FMLY_DTL WHERE CALC_NO=:1
      GROUP BY FMLY_SEQ ORDER BY FMLY_SEQ`, [calcNo], { outFormat: oracledb.OUT_FORMAT_OBJECT })
    return r.rows
  } finally { await conn.close() }
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
  await page.evaluate(() => { const els = Array.from(document.querySelectorAll('[id="a_1905120000"]')); const vis = els.filter(e => e.offsetParent !== null); (vis[0] || els[0])?.click() })
  await page.waitForTimeout(9000)
}

// L03 캡처 리스너 (io.jsonl 기록 — hometax-capture-io --parse 재사용)
function attachCapture(ctx) {
  let ready = true, n = 0
  ctx.on("response", async resp => {
    let req; try { req = resp.request() } catch { return }
    if (req.method() !== "POST") return
    const url = req.url()
    if (/permission\.do|token\.do/.test(url)) return
    if (!(url.includes("wqAction.do") || url.includes("Action"))) return
    const postData = req.postData() ?? ""
    let response = ""; try { response = await resp.text() } catch {}
    let status = 0; try { status = resp.status() } catch {}
    const m = url.match(/actionId=([^&]+)/); const actionId = m ? m[1] : "?"
    n++
    fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), n, actionId, url, status, postData, response }) + "\n")
    if (postData.includes("yrsTaxClcDetailDVOList")) console.log(`  [L03 캡처 #${n}] status ${status}`)
  })
}

function popupFrame(ctx) {
  for (const p of ctx.pages()) if (p.url().includes("popup.html") && p.url().includes("UTEYSEJF19")) return p.mainFrame()
  return null
}
async function setCell(frame, row, col, val) {
  if (!val || Number(val) === 0) return
  const sel = `#mf_gridMdxps_cell_${row}_${col}_text`
  const el = await frame.$(sel)
  if (!el) { console.log(`     (셀 없음: ${sel})`); return }
  await el.click(); await el.fill(String(val))
  await frame.evaluate(s => { const e = document.querySelector(s); if (e) { e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); e.blur() } }, sel)
  console.log(`     ${sel} = ${Number(val).toLocaleString("ko-KR")}`)
}

async function fill(ctx, fams) {
  const frame = popupFrame(ctx)
  if (!frame) { console.log("  ✗ 의료비 팝업을 못 찾음 — 팝업을 먼저 열어주세요."); return }
  // 대상자 수만큼 행 확보 (기본 3행: 본인+가족1+가족2). 부족하면 가족추가.
  const needRows = fams.length
  for (let i = 3; i < needRows; i++) { await frame.click("#mf_btnAddFmly").catch(() => {}); await frame.waitForTimeout(400) }
  // 입력: FMLY_SEQ 오름차순 = row 0,1,2…  (row0=본인: 특례열 없음 → HDC 를 col1 합산)
  for (let r = 0; r < fams.length; r++) {
    const f = fams[r]
    console.log(`   [row ${r}] FMLY_SEQ=${f.FMLY_SEQ}`)
    const col1 = Number(f.AMT) + (r === 0 ? Number(f.HDC) : 0)   // 본인은 일반+특례를 col1
    await setCell(frame, r, 1, col1)
    await setCell(frame, r, 2, f.CA)
    await setCell(frame, r, 3, f.ISA)
    if (r !== 0) await setCell(frame, r, 4, f.HDC)               // 가족만 특례열
    await setCell(frame, r, 5, f.LOSS)
  }
  const mainPage = ctx.pages()[0]
  console.log("  → 계산하기...")
  await frame.click("#mf_trigger31").catch(() => {}); await mainPage.waitForTimeout(1500).catch(() => {})
  console.log("  → 적용하기...")
  await frame.click("#mf_btnApply").catch(() => {}); await mainPage.waitForTimeout(1000).catch(() => {})
  console.log("  ✓ 입력·적용 완료. 이제 본화면에서 [계산]을 누르면 L03이 캡처됩니다.")
}

async function main() {
  oracledb.initOracleClient({ libDir: ORACLE_LIB }); oracledb.fetchAsString = [oracledb.CLOB]
  fs.mkdirSync(OUT_DIR, { recursive: true }); fs.writeFileSync(LOG, "")
  const fams = await dbFamilyMedi(CALC_NO)
  console.log(`[DB] ${CALC_NO} 대상자별 의료비 (FMLY_SEQ별):`)
  console.table(fams)
  console.log("[1] 브라우저 기동 (headed)...")
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await ctx.newPage(); page.on("dialog", d => d.accept().catch(() => {}))
  attachCapture(ctx)
  console.log("[2] 세션 수립...")
  await establishSession(page)
  console.log("\n════════════════════════════════════════════")
  console.log("  화면에서 [의료비] 상세 팝업을 여세요. 뜨면 콘솔 Enter → 자동입력.")
  console.log("  입력·적용 후 본화면 [계산] → L03 캡처. 끝나면 Ctrl+C → --parse.")
  console.log("════════════════════════════════════════════\n")
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.on("line", async () => { await fill(ctx, fams).catch(e => console.log("오류:", e.message)) })
  await new Promise(() => {})
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
