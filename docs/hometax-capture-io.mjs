/**
 * 홈택스 모의계산 — 요청(POST)+응답 페어 라이브 캡처 (수동 조작용)
 *
 * 목적: 사람이 국세청 화면/팝업에서 항목(예: 인적공제)을 직접 입력·적용할 때
 *   브라우저가 서버로 보내는 실제 POST body 와 그 응답을 "있는 그대로" 캡처한다.
 *   합성 body 를 쏘는 프로브와 달리, UI 가 만드는 진짜 페이로드 구조를 확인할 수 있다.
 *   (인적공제처럼 별도 팝업/action 으로 나가고 F12 로는 팝업이 닫혀 못 잡는 경우에 유용)
 *
 * 동작:
 *   1) headed 브라우저로 '연말정산 자동계산' 화면까지 자동 진입
 *   2) 이후 대기 — 사람이 팝업 열고 값 입력 후 [적용하기]/[계산] 클릭
 *   3) 그동안 컨텍스트의 모든 POST(.do) 요청을 postData + 응답 body 로 페어링해
 *      data/capture/io.jsonl 에 전부 기록 (새 팝업 창·iframe 포함)
 *   4) 콘솔에 캡처 순번/actionId 마커 표시 → 어느 게 '적용하기'인지 짚기 쉽게
 *
 * 사용법:
 *   node docs/hometax-capture-io.mjs
 *     → 브라우저 뜨면 인적공제 팝업 열고 입력 → 적용하기. 끝나면 Ctrl+C.
 *   node docs/hometax-capture-io.mjs --parse
 *     → 기록된 POST 를 순번·actionId·postData 요약으로 덤프 (원본은 io.jsonl)
 *
 * ⚠ 읽기전용(캡처만, DB 접근 없음). 저장물은 data/(gitignore). eversafe → headed 필수.
 */

import fs from "node:fs"
import path from "node:path"

const OUT_DIR = "data/capture"
const LOG = path.join(OUT_DIR, "io.jsonl")

// ── 분석 모드 (--parse) ──────────────────────────────────────────────────────
if (process.argv.includes("--parse")) {
  const lines = fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean)
  const recs = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  console.log(`캡처 POST ${recs.length}건\n`)
  recs.forEach((r, i) => {
    console.log(`══ [#${i + 1}] ${r.actionId}  (status ${r.status})`)
    console.log(`   URL: ${r.url}`)
    console.log(`   ── 요청 postData ──`)
    console.log("   " + (r.postData ?? "(없음)").replace(/\n/g, "\n   "))
    console.log(`   ── 응답 (앞 2000자) ──`)
    console.log("   " + String(r.response ?? "").slice(0, 2000).replace(/\n/g, "\n   "))
    console.log("")
  })
  process.exit(0)
}

// ── 캡처 모드 ────────────────────────────────────────────────────────────────
const pw = (await import("../node_modules/playwright/index.js")).default
const { chromium } = pw
const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(LOG, "")

// 캡처 대상: hometax 도메인으로 나가는 POST 중 action(.do) 요청
function isTarget(req) {
  if (req.method() !== "POST") return false
  const url = req.url()
  if (!/hometax\.go\.kr|teys\.hometax/.test(url)) return false
  return /\.do(\?|$)/.test(url) || url.includes("Action")
}
function actionOf(url) {
  const m = url.match(/actionId=([^&]+)/)
  return m ? m[1] : (url.split("/").pop() || "?").split("?")[0]
}
// 인적공제 팝업 payload 는 L03 와 구조가 다를 수 있어, 값 있는 흔적을 폭넓게 미리보기
function previewCodes(pd) {
  try {
    const cut = pd.indexOf("<nts")
    const b = JSON.parse(cut >= 0 ? pd.slice(0, cut) : pd)
    const list = b.yrsTaxClcDetailDVOList || b.list || []
    if (Array.isArray(list) && list.length) {
      return list
        .filter(it => ["useAmt", "incDdcNfpCnt", "ddcTrgtAmt", "ddcAmt"].some(f => it[f] && it[f] !== "0" && it[f] !== "-1"))
        .map(it => it.amtClusCd).filter(Boolean).join(",")
    }
  } catch {}
  return ""
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

async function main() {
  console.log("[1] 브라우저 기동... (headed)")
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await ctx.newPage()
  page.on("dialog", d => d.accept().catch(() => {}))

  let n = 0
  // 응답 단위로 후킹 → 요청(postData)과 응답 body 를 한 레코드로 페어링. 팝업 새창·iframe 모두 컨텍스트 레벨에서 잡힘.
  ctx.on("response", async resp => {
    let req
    try { req = resp.request() } catch { return }
    if (!isTarget(req)) return
    const url = req.url()
    const postData = req.postData() ?? ""
    let response = ""
    try { response = await resp.text() } catch { /* body 소비 불가·바이너리 → 빈값 */ }
    n++
    const actionId = actionOf(url)
    let status = 0
    try { status = resp.status() } catch {}
    fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), n, actionId, url, status, postData, response }) + "\n")
    const codes = previewCodes(postData)
    console.log(`  [POST #${n}] ${actionId}  (status ${status})${codes ? "  값:" + codes : ""}`)
  })

  console.log("[2] 모의계산 자동계산 화면 진입...")
  await establishSession(page)
  console.log("\n════════════════════════════════════════════════════")
  console.log("  준비 완료. 이제 화면에서 [인적공제] 팝업을 열고")
  console.log("  본인/배우자/부양가족·경로우대/장애인/부녀자/한부모 값을 입력한 뒤")
  console.log("  [적용하기] → (필요시 [계산]) 를 눌러 주세요.")
  console.log("  요청+응답이 " + LOG + " 에 페어로 기록됩니다.")
  console.log("  ※ 어느 POST 가 '적용하기' 직후였는지 순번(#N)을 알려주시면 분석이 빨라집니다.")
  console.log("  끝나면 Ctrl+C.  (분석: node docs/hometax-capture-io.mjs --parse)")
  console.log("════════════════════════════════════════════════════\n")

  await page.waitForTimeout(60 * 60 * 1000)
  await browser.close()
}

main().catch(e => { console.error("오류:", e.message); process.exit(1) })
