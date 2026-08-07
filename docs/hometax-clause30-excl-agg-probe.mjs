/**
 * 조특법30조제외 집계코드(8620 소계·8615 성과보상소계·8613 외국인미러) 계약 프로브
 *
 * 질문: 우리 도구는 조특30제외를 **개별 코드 useAmt만** 전송한다(8620/8615/8613 IN 안 보냄).
 *   국세청이 그래도 8620(개별 감면세액 합)·8615(성과보상 소계)를 OUT으로 회신하는가?
 *   → 회신하면 복합유형 1:1·N:1(개별 self + 집계) 배선 가능.
 *
 * 방법(합성): io.jsonl 조특30제외 full 계산을 ground truth 로,
 *   V0 원문(개별+8620/8615/8613 IN 다 채움)         ← 대조군(캡처응답 재현)
 *   V1 집계/미러 IN 제거(개별 useAmt+ddcTrgtAmt만)   ← 8620/8615 OUT 유지되나?
 *   V2 우리 엔진 body(개별 useAmt만, 집계·미러 없음)  ← 우리 실제 전송 재현
 *
 * 사용법:  node docs/hometax-clause30-excl-agg-probe.mjs
 * ⚠ 읽기 전용(NTS 조회만). eversafe → headed 필수. 라이브 3발.
 */

import pw from "../node_modules/playwright/index.js"
import fs from "node:fs"

const { chromium } = pw
const OUT_FILE = "data/capture/clause30-excl-agg-probe-result.txt"
const _lines = []
const log = (...a) => { const s = a.join(" "); process.stdout.write(s + "\n"); _lines.push(s) }
function flush() { try { fs.mkdirSync("data/capture", { recursive: true }); fs.writeFileSync(OUT_FILE, _lines.join("\n")) } catch {} }

const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const DROPDOWN_2026 = "a_1905130000"
const L03_URL_2026  = "https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEDA001L01&screenId=UTEYSEJ0E001&popupYn=false&realScreenId=UTEYSEJ0E001"
const CAPTURE_FILE  = "data/capture/io.jsonl"
const DETAIL_EXTRA  = { ereClCd: "01", yrsSrvcClCd: "01", statusValue: "R", ddcRtnId: "" }

const strip = s => { if (!s) return "{}"; const i = s.indexOf("<nts"); return i >= 0 ? s.slice(0, i) : s }
const clone = o => JSON.parse(JSON.stringify(o))
const fmt = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"))

// 개별 조특30제외 코드 / 집계·미러 코드
const INDIV = ["8602", "8612", "8609", "8610", "8611", "8614", "8616", "8617"]
const AGG   = ["8613", "8615", "8620"]
const SHOW  = [...INDIV, ...AGG, "8924"]

// io.jsonl 에서 8620 useAmt>0 인 L01 계산(=조특30제외 full) 을 ground truth 로.
function loadGroundTruth() {
  const recs = fs.readFileSync(CAPTURE_FILE, "utf8").trim().split(/\r?\n/).map(l => JSON.parse(l))
  const calcs = recs.filter(r => (r.actionId || "").includes("L01") && r.postData)
    .map(r => ({ r, body: JSON.parse(strip(r.postData)), resp: JSON.parse(strip(r.response || "{}")) }))
  const hit = calcs.filter(c => {
    const r = (c.body.yrsTaxClcDetailDVOList || []).find(x => String(x.amtClusCd) === "8620")
    const o = (c.resp.yrsTaxClcDetailDVOList || []).find(x => String(x.amtClusCd) === "8620")
    return r && Number(r.useAmt) > 0 && o && Number(o.ddcAmt) > 0   // 소진 아닌 정상(8620 OUT>0) 케이스
  })[0]
  if (!hit) throw new Error("io.jsonl 에 8620 OUT>0 정상 계산 없음 — 조특30제외 여러개 입력한 (소진 아닌) 캡처 필요.")
  return { body: hit.body, resp: hit.resp, n: hit.r.n }
}

const toMap = raw => { const m = {}; try { for (const it of (JSON.parse(strip(raw)).yrsTaxClcDetailDVOList || [])) m[String(it.amtClusCd)] = Number(it.ddcAmt ?? 0) } catch {} return m }

function zeroRows(body, codes) {
  for (const r of body.yrsTaxClcDetailDVOList) {
    if (codes.includes(String(r.amtClusCd))) { r.useAmt = "0"; r.ddcTrgtAmt = "0"; r.ddcLmtAmt = "0"; r.ddcAmt = "0" }
  }
}
// V2: 우리 엔진 body 모양(개별 useAmt만 유지, ddcTrgtAmt/ddcAmt 제거, 집계·미러 0)
function variantOurEngine(base) {
  const totPay = String(base.yrsTaxClcDetailDVOList.find(r => r.amtClusCd === "8900")?.useAmt ?? "0")
  const detail = base.yrsTaxClcDetailDVOList.map(r => {
    const c = String(r.amtClusCd)
    const keepUse = INDIV.includes(c)   // 개별만 useAmt 유지, 나머지(집계·미러 포함)는 원 useAmt 유지 아님
    return {
      amtClusCd: c,
      useAmt: keepUse ? r.useAmt : (AGG.includes(c) ? "0" : r.useAmt),
      ddcLmtAmt: "0", incDdcNfpCnt: r.incDdcNfpCnt ?? "0", ddcTrgtAmt: "0", ddcAmt: "0",
      ...DETAIL_EXTRA,
    }
  })
  return {
    crdcDdcAmt: "0", smltClcClCd: "2026", v_saveChk: "Y", v_conbChk: "", yrsSrvcClCd: "",
    pbtAddDdcAmt: "0", pbtDdcAmt: "0", addDdcrtDdcAmt: "0", ddcPsbAmt: "0",
    tdmrAddDdcAmt: "0", lstDdcAmt: "0", tdmrDdcAmt: "0", bppAddDdcAmt: "0",
    gnrlDdcAmt: "0", ddcExclAmt: "0", totaSnwAmt: totPay, ddcLmtAmt: "0",
    yrsTaxClcBscList: [{ ppmTxamt: "0", attrYr: "2026", ddcRtnId: "", erinAmt: "0", totaSnwAmt: totPay, statusValue: "R" }],
    yrsTaxClcDetailDVOList: detail,
  }
}

async function clickText(page, text, preferRight = false) {
  for (const f of page.frames()) {
    try {
      const ok = await f.evaluate(({ t, pr }) => {
        let els = Array.from(document.querySelectorAll("a,button,input,li,span,div")).filter(e => (e.offsetWidth || e.offsetHeight) && (e.textContent || e.value || "").trim() === t)
        if (pr) els = els.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)
        if (els[0]) { els[0].click(); return true } return false
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
  await page.evaluate((id) => {
    const els = Array.from(document.querySelectorAll(`[id="${id}"]`))
    const vis = els.filter(e => e.offsetParent !== null)
    ;(vis[0] || els[0])?.click()
  }, DROPDOWN_2026)
  await page.waitForTimeout(9000)
}
async function postL03(page, body) {
  return page.evaluate(async ({ url, bodyStr }) => {
    try { const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json;charset=UTF-8" }, body: bodyStr, credentials: "include" }); return await res.text() }
    catch (e) { return JSON.stringify({ error: e.message }) }
  }, { url: L03_URL_2026, bodyStr: JSON.stringify(body) })
}

async function main() {
  log("[1] ground truth 로드 (io.jsonl 조특30제외 full)...")
  const { body: base, resp: capResp, n } = loadGroundTruth()
  const capMap = toMap(JSON.stringify(capResp))
  log(`    캡처 #${n}  8620소계=${fmt(capMap["8620"])} 8615성과보상=${fmt(capMap["8615"])} 8924세액감면계=${fmt(capMap["8924"])}`)

  const v1 = clone(base); zeroRows(v1, AGG)                        // 집계·미러 IN 제거, 개별 IN 유지
  const v2 = variantOurEngine(base)                               // 우리 엔진 body(개별 useAmt만)

  log("[2] 국세청 2026 세션 기동(headed)...")
  const browser = await chromium.launch({ headless: false })
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
  page.on("dialog", d => d.accept().catch(() => {}))
  await establishSession(page)
  log("    세션 완료\n")

  const variants = [
    ["V0 원문(개별+집계 IN 다 채움)", clone(base)],
    ["V1 집계/미러 IN 제거(개별 IN 유지)", v1],
    ["V2 우리 엔진 body(개별 useAmt만)", v2],
  ]
  for (const [name, body] of variants) {
    const raw = await postL03(page, body)
    await page.waitForTimeout(500)
    const m = toMap(raw)
    log(`  [${name}]`)
    log(`     개별: ${INDIV.map(c => `${c}=${fmt(m[c])}`).join(" ")}`)
    log(`     집계: ${AGG.map(c => `${c}=${fmt(m[c])}`).join(" ")}  8924=${fmt(m["8924"])}`)
    log("")
  }
  log("판정: V1/V2 에서 8620/8615 OUT 이 개별 합과 같게 나오면 → 개별만 보내도 국세청이 집계 회신(N:1 성립).")
  log("      8620/8615 가 0 이면 → 집계코드는 화면이 IN 채워야 나오는 것(우리 도구가 별도 전송 필요).")
  log(`\n(결과: ${OUT_FILE})`)
  flush()
  await browser.close()
}
main().catch(e => { log("오류: " + e.message); flush(); process.exit(1) })
