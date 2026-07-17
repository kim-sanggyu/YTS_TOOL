/**
 * 홈택스 모의계산 — 범용 화면 payload 캡처
 *
 * 목적: 국세청 화면에서 특정 공제항목을 입력할 때 L03(및 기타 wqAction)로 나가는 요청
 *   payload 를 캡처 → 그 항목이 어느 amtClusCd 칸으로 어떤 필드에 전달되는지 확인.
 *   (대상자 없는 항목의 코드 매핑 검증 등에 사용)
 *
 * 동작: 브라우저를 띄워 '연말정산 자동계산' 화면까지 진입시킨 뒤 창을 열어둔 채로 대기.
 *   모든 wqAction.do 요청 postData 를 data/capture/requests.jsonl 에 기록.
 *   요청마다 값(≠0)이 담긴 세액/소득공제 코드를 콘솔에 표시.
 *
 * 사용법: node docs/hometax-capture.mjs
 *   → 브라우저 뜨면 확인할 항목 입력란에 값 넣고 계산. 끝나면 Ctrl+C.
 *
 * 분석: node docs/hometax-capture.mjs --parse   → 캡처된 요청의 값 있는 코드 덤프
 *
 * ⚠ 읽기전용(캡처만). 저장물은 data/(gitignore). eversafe → headed.
 */

import fs from "node:fs"
import path from "node:path"

const OUT_DIR = "data/capture"
const LOG = path.join(OUT_DIR, "requests.jsonl")

// ── 분석 모드 ──
if (process.argv.includes("--parse")) {
  const fmt = n => Number(n ?? 0).toLocaleString("ko-KR")
  const VALFIELDS = ["useAmt", "ddcTrgtAmt", "ddcLmtAmt", "incDdcNfpCnt", "ddcAmt"]
  const lines = fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean)
  const recs = lines.map(l => JSON.parse(l))
  console.log(`캡처 요청 ${recs.length}건 중 값 담긴 것만\n`)
  recs.forEach((r, i) => {
    const cut = r.postData.indexOf("<nts")
    let b; try { b = JSON.parse(cut >= 0 ? r.postData.slice(0, cut) : r.postData) } catch { return }
    const list = b.yrsTaxClcDetailDVOList || []
    const valued = list.filter(it => VALFIELDS.some(f => it[f] && it[f] !== "0" && it[f] !== "-1"))
    if (!valued.length) return
    console.log(`== [${i + 1}] ${r.actionId} ==`)
    for (const it of valued) {
      const nz = VALFIELDS.filter(f => it[f] && it[f] !== "0" && it[f] !== "-1").map(f => `${f}=${fmt(it[f])}`)
      console.log(`   ${it.amtClusCd}  ${nz.join("  ")}`)
    }
    console.log("")
  })
  process.exit(0)
}

// ── 캡처 모드 ──
const pw = (await import("../node_modules/playwright/index.js")).default
const { chromium } = pw
const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(LOG, "")

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
  ctx.on("request", req => {
    const url = req.url()
    if (!url.includes("wqAction.do")) return
    const pd = req.postData()
    if (!pd) return
    n++
    const m = url.match(/actionId=([^&]+)/)
    const actionId = m ? m[1] : "?"
    fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), actionId, url, postData: pd }) + "\n")
    // 값 담긴 코드 미리보기
    let codes = ""
    try {
      const cut = pd.indexOf("<nts")
      const b = JSON.parse(cut >= 0 ? pd.slice(0, cut) : pd)
      const list = b.yrsTaxClcDetailDVOList || []
      codes = list.filter(it => ["useAmt", "ddcTrgtAmt", "ddcAmt"].some(f => it[f] && it[f] !== "0"))
        .map(it => it.amtClusCd).join(",")
    } catch {}
    console.log(`  [req #${n}] ${actionId}${codes ? "  값:" + codes : ""}`)
  })

  console.log("[2] 모의계산 자동계산 화면 진입...")
  await establishSession(page)
  console.log("\n════════════════════════════════════════════════════")
  console.log("  준비 완료. 확인할 항목(외국납부세액·납세조합공제·주택차입금이자상환)")
  console.log("  입력란에 값을 넣고 계산해 주세요. 요청이 " + LOG + " 에 기록됩니다.")
  console.log("  끝나면 Ctrl+C → node docs/hometax-capture.mjs --parse 로 분석.")
  console.log("════════════════════════════════════════════════════\n")

  await page.waitForTimeout(30 * 60 * 1000)
  await browser.close()
}

main().catch(e => { console.error("오류:", e.message); process.exit(1) })
