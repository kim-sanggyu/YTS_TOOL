// B1 구현 검증 v2: 견고한 네비게이션(wait-for-element + 재시도) + 기부금 팝업 구동 + 본계산 + 공제 파싱.
import pw from "file:///D:/YTS_TOOL/node_modules/playwright/index.js"
const { chromium } = pw
import fs from "node:fs"
import path from "node:path"
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))
const save = (n, d) => fs.writeFileSync(path.join(OUT, n), typeof d === "string" ? d : JSON.stringify(d, null, 2))
const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const wait = (p, ms) => p.waitForTimeout(ms)
const DONATIONS = [
  { label: "정치자금기부금", amount: 100000 },
  { label: "고향사랑기부금(일반)", amount: 200000 },
  { label: "특례기부금", amount: 1000000 },
]
const TOTAL_PAY = 60000000

async function clickByExactText(page, text, preferRight = false) {
  for (const f of page.frames()) { try {
    const ok = await f.evaluate(({ t, pr }) => { let els = Array.from(document.querySelectorAll("a,button,input,li,span,div")).filter((e) => (e.offsetWidth || e.offsetHeight) && (e.textContent || e.value || "").trim() === t); if (pr) els = els.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left); if (els[0]) { (els[0].closest("a,button") || els[0]).click(); return true } return false }, { t: text, pr: preferRight })
    if (ok) return true } catch {} }
  return false
}
// 프레임 순회: 정규식 매칭 버튼 존재?
async function hasButton(page, reSrc) {
  for (const f of page.frames()) { try {
    const found = await f.evaluate((src) => { const re = new RegExp(src); return !!Array.from(document.querySelectorAll("a,button,input")).find((e) => (e.offsetWidth || e.offsetHeight) && re.test(((e.textContent || e.value || "") + " " + (e.getAttribute("title") || "")).trim())) }, reSrc)
    if (found) return true } catch {} }
  return false
}
async function waitForButton(page, reSrc, timeoutMs) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) { if (await hasButton(page, reSrc)) return true; await wait(page, 1000) }
  return false
}
// 정규식 버튼 el.click (프레임 순회)
async function clickButton(page, reSrc) {
  for (const f of page.frames()) { try {
    const ok = await f.evaluate((src) => { const re = new RegExp(src); const el = Array.from(document.querySelectorAll("a,button,input")).find((e) => (e.offsetWidth || e.offsetHeight) && re.test(((e.textContent || e.value || "") + " " + (e.getAttribute("title") || "")).trim())); if (el) { (el.closest("a,button") || el).click(); return true } return false }, reSrc)
    if (ok) return true } catch {} }
  return false
}
const clickYearLink = (page) => page.evaluate(() => { const els = Array.from(document.querySelectorAll('[id="a_1905120000"]')); const v = els.filter((e) => e.offsetParent !== null); (v[0] || els[0])?.click(); return !!(v[0] || els[0]) })

async function robustNav(page) {
  await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {})
  await wait(page, 7000)
  await clickByExactText(page, "모의계산", true)
  // 연말정산 자동계산하기 뜰 때까지
  const t0 = Date.now()
  while (Date.now() - t0 < 20000) { if (await hasButton(page, "연말정산 자동계산하기")) break; await wait(page, 1000) }
  // 자동계산하기 + 연도링크 → 계산기 로드까지 재시도
  for (let attempt = 0; attempt < 4; attempt++) {
    try { await page.getByText("연말정산 자동계산하기", { exact: true }).first().click({ timeout: 6000 }) } catch {}
    await wait(page, 2000)
    await clickYearLink(page).catch(() => {})
    if (await waitForButton(page, "총급여.*수정|기납부.*수정", 15000)) return true
    console.log(`  계산기 로드 재시도 ${attempt + 1}`)
  }
  return await hasButton(page, "총급여.*수정|기납부.*수정")
}
// 팝업 열기 재시도
async function openPopup(page, pages, reSrc, detectRe, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const before = pages.length
    await clickButton(page, reSrc)
    await wait(page, 3500)
    const pop = pages.find((p) => detectRe.test(p.url())) || (pages.length > before ? pages[pages.length - 1] : null)
    if (pop) return pop
    console.log(`  팝업(${reSrc}) 열기 재시도 ${i + 1}`)
    await wait(page, 1500)
  }
  return null
}

async function main() {
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } })
  const page = await ctx.newPage()
  page.on("dialog", (d) => d.accept().catch(() => {}))
  const l03 = []
  const attach = (p) => p.on("response", async (r) => { if (r.url().includes("ATEYSEAA001L03")) { try { l03.push(await r.text()) } catch {} } })
  attach(page)
  const pages = [page]
  ctx.on("page", (p) => { pages.push(p); p.on("dialog", (d) => d.accept().catch(() => {})); attach(p) })

  const log = { steps: [] }
  const ready = await robustNav(page)
  log.navReady = ready
  console.log("계산기 준비:", ready)
  if (!ready) { console.log("❌ 계산기 로드 실패"); save("pocb1-log.json", log); fs.writeFileSync(path.join(OUT, "POCB1-DONE.flag"), "no-calc"); await new Promise(() => {}); return }

  // 1) 총급여
  const payPopup = await openPopup(page, pages, "총급여.*수정|기납부.*수정", /UTEYSEJF03|taxPlnPopup/)
  if (payPopup) {
    await payPopup.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {})
    await wait(payPopup, 1500)
    const payId = await payPopup.evaluate(() => { const e = Array.from(document.querySelectorAll("input")).find((x) => (x.offsetWidth || x.offsetHeight) && /총급여|급여/.test(x.getAttribute("title") || "") && !x.disabled && !x.readOnly); return e ? e.id : null })
    if (payId) { await payPopup.locator(`[id="${payId}"]`).fill(String(TOTAL_PAY)); await payPopup.locator(`[id="${payId}"]`).press("Tab").catch(() => {}); await wait(payPopup, 500) }
    await clickByExactText(payPopup, "계산하기"); await wait(payPopup, 2000)
    await clickByExactText(payPopup, "적용하기"); await wait(page, 3000)
    await payPopup.close().catch(() => {})
    log.steps.push("총급여 " + TOTAL_PAY)
    console.log("총급여 세팅 완료.")
  } else { log.steps.push("총급여팝업 실패") }

  // 2) 기부금 팝업
  const dPopup = await openPopup(page, pages, "기부금.*수정", /UTEYSEJF08/)
  log.donationPopupOpened = !!dPopup
  if (!dPopup) { console.log("❌ 기부금 팝업 안 열림"); save("pocb1-log.json", log); fs.writeFileSync(path.join(OUT, "POCB1-DONE.flag"), "no-donation-popup"); await new Promise(() => {}); return }
  await dPopup.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {})
  await wait(dPopup, 2500)
  log.donationOpener = await dPopup.evaluate(() => !!window.opener).catch(() => null)
  console.log("기부금 팝업 열림. opener:", log.donationOpener)

  // 3) 자료추가 + 코드/금액
  for (let i = 0; i < DONATIONS.length; i++) { await clickByExactText(dPopup, "자료추가"); await wait(dPopup, 1200) }
  for (let i = 0; i < DONATIONS.length; i++) {
    const d = DONATIONS[i]
    try {
      await dPopup.selectOption(`[id="mf_gridConb_cell_${i}_1_select_input_0"]`, { label: d.label }).catch(async () => { await dPopup.selectOption(`[id="mf_gridConb_cell_${i}_1_select_input_0"]`, d.label).catch(() => {}) })
      await wait(dPopup, 500)
      await dPopup.locator(`[id="mf_gridConb_cell_${i}_3_text"]`).click().catch(() => {})
      await dPopup.locator(`[id="mf_gridConb_cell_${i}_3_text"]`).fill(String(d.amount))
      await dPopup.keyboard.press("Tab").catch(() => {})
      await wait(dPopup, 600)
      log.steps.push(`행${i}: ${d.label}=${d.amount}`)
    } catch (e) { log.steps.push(`행${i} 오류`) }
  }
  await dPopup.screenshot({ path: path.join(OUT, "pocb1-donation-popup.png") }).catch(() => {})
  log.applied = await clickByExactText(dPopup, "적용하기")
  await wait(page, 3500)
  console.log("기부금 적용:", log.applied)

  // 4) 본계산
  await page.bringToFront().catch(() => {})
  for (const f of page.frames()) { try { if (await f.$('#mf_txppWframe_btnClcExct').catch(() => null)) { await f.click('#mf_txppWframe_btnClcExct').catch(() => {}); break } } catch {} }
  await wait(page, 6000)
  await page.screenshot({ path: path.join(OUT, "pocb1-main-after.png"), fullPage: true }).catch(() => {})

  // 5) 파싱
  const codes = ["8740", "8741", "8743", "8744", "8745", "8746", "8747", "8783", "8784", "8455", "8457", "8458"]
  const parsed = { l03Count: l03.length, rows: [] }
  if (l03.length) { const list = JSON.parse(l03[l03.length - 1]).yrsTaxClcDetailDVOList || []; for (const c of codes) { const it = list.find((x) => String(x.amtClusCd) === c); if (it && (Number(it.useAmt) || Number(it.ddcAmt))) parsed.rows.push({ code: c, useAmt: it.useAmt, ddcAmt: it.ddcAmt }) } const p = list.find((x) => String(x.amtClusCd) === "8900"); parsed.totalPay = p ? p.useAmt : null }
  save("pocb1-parsed.json", parsed); save("pocb1-log.json", log)
  console.log("\n=== 기부금 공제 파싱 ===")
  parsed.rows.forEach((r) => console.log(`  ${r.code}: 입력 ${r.useAmt} → 공제 ${r.ddcAmt}`))
  console.log("총급여:", parsed.totalPay, "L03:", parsed.l03Count)
  console.log(parsed.rows.some((r) => Number(r.ddcAmt) > 0) ? "\n✅ 기부금 공제 산출됨 → B1 성공" : "\n❌ 공제 0 → 그리드 금액 전달 실패")
  fs.writeFileSync(path.join(OUT, "POCB1-DONE.flag"), new Date().toISOString())
  await new Promise(() => {})
}
main().catch((e) => { console.error("FAILED:", e); fs.writeFileSync(path.join(OUT, "POCB1-DONE.flag"), "ERR " + e); process.exit(1) })
