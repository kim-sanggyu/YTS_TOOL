/**
 * 의료비 세액공제 상세 팝업 DOM 탐색 — 부양가족별 자동입력(방법 B)을 위한 1단계 셀렉터 파악.
 *
 * 동작: 세션 수립 후 대기. 사람이 [의료비] 팝업을 열고 Enter 치면, 열린 모든 페이지/프레임의
 *   input·select·버튼을 id/name/value/주변텍스트와 함께 덤프 → 그리드 셀렉터 규칙을 파악한다.
 *   여러 번 Enter 로 재덤프 가능(가족입력 추가 후 변화 관찰).
 *
 * 사용법: node docs/medi-popup-explore.mjs   ⚠ 읽기전용(입력 안 함, DOM 관찰만). headed 필수.
 */
import readline from "node:readline"
import pw from "../node_modules/playwright/index.js"
const { chromium } = pw
const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"

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

// 한 프레임의 입력요소 덤프
async function dumpFrame(f, tag) {
  try {
    const info = await f.evaluate(() => {
      const near = el => {
        // 가까운 라벨/헤더 텍스트 추정
        let t = ""
        const cell = el.closest("td")
        if (cell) {
          const tr = cell.closest("tr"), tbl = cell.closest("table")
          const idx = cell.cellIndex
          const head = tbl?.querySelector("thead tr")?.children?.[idx]?.textContent?.trim() || tbl?.querySelector("tr")?.children?.[idx]?.textContent?.trim() || ""
          const rowHead = tr?.children?.[0]?.textContent?.trim() || ""
          t = `${rowHead}|${head}`
        }
        return t
      }
      const inputs = Array.from(document.querySelectorAll('input[type="text"],input:not([type]),input[type="tel"]')).map(el => ({
        id: el.id || "", name: el.name || "", val: el.value || "", near: near(el),
        vis: !!(el.offsetWidth || el.offsetHeight),
      })).filter(x => x.vis)
      const btns = Array.from(document.querySelectorAll("button,a,input[type=button],span[onclick],div[onclick],[class*=w2trigger],[class*=btn],img")).map(el => ({ id: el.id || "", txt: (el.textContent || el.value || el.title || el.alt || "").trim(), vis: !!(el.offsetWidth || el.offsetHeight) })).filter(b => b.id && b.vis && b.txt && b.txt.length < 30 && /의료비|계산하기|^계산$|명세|상세|세액공제|입력하기|자료입력/.test(b.txt)).slice(0, 40)
      return { url: location.href, nInput: inputs.length, inputs: inputs.slice(0, 60), btns: btns.slice(0, 20) }
    })
    if (info.nInput === 0 && info.btns.length === 0) return
    console.log(`\n── [${tag}] ${info.url}`)
    console.log(`   input(text) ${info.nInput}개:`)
    for (const i of info.inputs) console.log(`     id=${i.id}  name=${i.name}  val=${i.val}  near=${i.near}`)
    if (info.btns.length) console.log(`   버튼: ${info.btns.map(b => `${b.txt}(${b.id})`).join(", ")}`)
  } catch {}
}

async function dumpAll(ctx) {
  console.log("\n════════ DOM 덤프 ════════")
  const pages = ctx.pages()
  for (let pi = 0; pi < pages.length; pi++) {
    const p = pages[pi]
    const frames = p.frames()
    for (let fi = 0; fi < frames.length; fi++) await dumpFrame(frames[fi], `page${pi}/frame${fi}`)
  }
  console.log("════════ 끝 ════════\n")
}

async function main() {
  console.log("[1] 브라우저 기동 (headed)...")
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await ctx.newPage(); page.on("dialog", d => d.accept().catch(() => {}))
  console.log("[2] 세션 수립...")
  await establishSession(page)
  console.log("\n════════════════════════════════════════════")
  console.log("  준비 완료. 화면에서 [의료비] 상세 팝업을 열어주세요(값 입력 불필요).")
  console.log("  팝업이 뜨면 이 콘솔에서 Enter → 팝업 DOM(input/버튼) 덤프.")
  console.log("  가족입력추가 후 다시 Enter 로 재덤프 가능. 끝나면 Ctrl+C.")
  console.log("════════════════════════════════════════════\n")
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.on("line", async () => { await dumpAll(ctx); console.log("(다시 Enter=재덤프 / Ctrl+C=종료)") })
  await new Promise(() => {})
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
