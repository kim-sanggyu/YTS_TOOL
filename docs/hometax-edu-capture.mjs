/**
 * 홈택스 모의계산 — 교육비 화면 payload 캡처
 *
 * 목적: 국세청 화면에서 사용자가 교육비를 자녀별로 입력할 때 L03(및 기타 wqAction) 로
 *   나가는 요청 payload 를 그대로 캡처 → 구분(본인/취학전/초중고/대학/장애인)·명세가
 *   집계칸(8730~34)으로 담기나, 자녀별 명세 배열로 담기나 확인.
 *
 * 동작: 브라우저를 띄워 '연말정산 자동계산' 화면까지 진입시킨 뒤 창을 열어둔 채로 대기.
 *   그동안 모든 wqAction.do 요청 postData 를 data/edu-capture/requests.jsonl 에 기록.
 *   교육비 관련(8730~34 or ddcTrgtAmt 포함) 요청은 별도 콘솔 표시.
 *
 * 사용법: node docs/hometax-edu-capture.mjs
 *   → 브라우저 뜨면 교육비 입력란에 자녀별로 값 넣고 계산. 끝나면 이 스크립트 종료(Ctrl+C).
 *
 * ⚠ 읽기전용(캡처만). 저장물은 data/(gitignore). eversafe → headed.
 */

import pw from "../node_modules/playwright/index.js"
import fs from "node:fs"
import path from "node:path"

const { chromium } = pw
const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"

const OUT_DIR = "data/edu-capture"
fs.mkdirSync(OUT_DIR, { recursive: true })
const LOG = path.join(OUT_DIR, "requests.jsonl")
fs.writeFileSync(LOG, "")   // 새 세션마다 초기화

function pretty(pd) {
  try { return JSON.stringify(JSON.parse(pd), null, 2) } catch { return pd }
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
  ctx.on("request", req => {
    const url = req.url()
    if (!url.includes("wqAction.do")) return
    const pd = req.postData()
    if (!pd) return
    n++
    const m = url.match(/actionId=([^&]+)/)
    const actionId = m ? m[1] : "?"
    const hasEdu = /"amtClusCd"\s*:\s*"873[0-4]"/.test(pd) || /ddcTrgtAmt/.test(pd) || /교육/.test(pd)
    fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), actionId, url, hasEdu, postData: pd }) + "\n")
    console.log(`  [req #${n}] ${actionId}${hasEdu ? "  ★교육비관련" : ""}`)
  })

  console.log("[2] 모의계산 자동계산 화면 진입...")
  await establishSession(page)
  console.log("\n════════════════════════════════════════════════════")
  console.log("  준비 완료. 이제 브라우저에서 [교육비] 입력란에 자녀별로 값을 넣고")
  console.log("  계산해 주세요. 모든 요청이 " + LOG + " 에 기록됩니다.")
  console.log("  (예: 자녀A 초중고 200만, 자녀B 대학 800만 등)")
  console.log("  끝나면 이 창에서 Ctrl+C.")
  console.log("════════════════════════════════════════════════════\n")

  await page.waitForTimeout(30 * 60 * 1000)   // 30분 대기
  await browser.close()
}

main().catch(e => { console.error("오류:", e.message); process.exit(1) })
