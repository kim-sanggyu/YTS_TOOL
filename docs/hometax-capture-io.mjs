/**
 * 홈택스 모의계산 — NTS 계약 라이브 캡처 (요청 IN + 응답 OUT 페어, 수동 조작용)
 *
 * ▶ 이것이 "NTS request/response 분석"의 표준 도구다. 매 세션 새 방법 만들지 말고 이걸 재사용한다.
 *   방법 문서: docs/nts-contract-capture-method.md
 *
 * 목적: 사람이 국세청 화면/팝업에서 항목을 직접 입력·계산할 때 브라우저가 보내는
 *   실제 L03 payload(IN)와 응답(OUT)을 "있는 그대로" 캡처 → 어떤 값이 어느 필드/코드로 들어가고
 *   어느 코드로 회신되는지(=NTS 계약)를 추측 0으로 확정한다. (합성 프로브보다 국세청 쪽은 이게 확실)
 *
 * 동작:
 *   1) headed 브라우저로 '연말정산 자동계산' 화면까지 자동 진입
 *   2) 진입 완료(ready) 후부터만 계산 요청을 #1,#2,… 로 번호매김 — 세션 노이즈(permission/token/포털)는
 *      로그·번호에서 제외해 "적용하기 = #N" 이 그대로 맞아떨어지게 한다.
 *   3) 계산(L03) 요청마다 IN(값 있는 코드) 미리보기 콘솔 출력 + data/capture/io.jsonl 기록
 *
 * ▶ 권장 워크플로 = "증분(diff)": 항목을 하나씩 넣고 계산 → 또 넣고 계산.
 *   연속된 두 계산의 차이가 그 항목의 IN/OUT 을 핀포인트한다(--parse 가 자동 diff).
 *
 * 사용법:
 *   node docs/hometax-capture-io.mjs           → 캡처. 팝업 입력 후 [적용하기]/[계산]. 끝나면 Ctrl+C.
 *   node docs/hometax-capture-io.mjs --parse    → 계산별 IN/OUT 표 + 직전 대비 증분 diff 자동 출력
 *
 * ⚠ 읽기전용(캡처만, DB 접근 없음). 저장물은 data/(gitignore). eversafe → headed 필수.
 */

import fs from "node:fs"
import path from "node:path"

const OUT_DIR = "data/capture"
const LOG = path.join(OUT_DIR, "io.jsonl")

const fmt = n => (n == null || n === "" ? "—" : Number(n).toLocaleString("ko-KR"))
const IN_FIELDS = ["incDdcNfpCnt", "useAmt", "ddcTrgtAmt", "ddcLmtAmt", "ddcAmt"]
// 실제 입력으로 볼 필드. ddcLmtAmt 단독은 UI 기본 한도 에코라 제외(노이즈).
// ddcAmt 는 포함 — 혼인공제(8790)처럼 ddcAmt 직접전송 패턴이 실재.
const IN_QUALIFY = ["incDdcNfpCnt", "useAmt", "ddcTrgtAmt", "ddcAmt"]

// postData(JSON, 뒤에 <nts...> 서명이 붙을 수 있음) → 파싱
function parseBody(pd) {
  try { const cut = pd.indexOf("<nts"); return JSON.parse(cut >= 0 ? pd.slice(0, cut) : pd) } catch { return null }
}
// 계산요청(L03)인가 = detail 배열을 가진 payload
function detailList(pd) {
  const b = parseBody(pd)
  const list = b?.yrsTaxClcDetailDVOList
  return Array.isArray(list) ? list : null
}
// IN 맵: code → {값 있는 입력필드}  (실입력 QUALIFY 필드가 하나라도 있어야 포함, ddcLmtAmt 단독은 제외)
function inMap(list) {
  const m = {}
  for (const it of list) {
    if (!IN_QUALIFY.some(f => it[f] && it[f] !== "0" && it[f] !== "-1")) continue
    const nz = {}
    for (const f of IN_FIELDS) if (it[f] && it[f] !== "0" && it[f] !== "-1") nz[f] = it[f]
    m[String(it.amtClusCd)] = nz
  }
  return m
}
// OUT 맵: code → ddcAmt(≠0)
function outMap(list) {
  const m = {}
  for (const it of list) if (it.ddcAmt && it.ddcAmt !== "0") m[String(it.amtClusCd)] = it.ddcAmt
  return m
}
const inStr = fields => IN_FIELDS.filter(f => fields[f] != null).map(f => `${f}=${fmt(fields[f])}`).join("  ")

// ── 분석 모드 (--parse): 계산별 IN/OUT 표 + 직전 계산 대비 증분 diff ─────────────
if (process.argv.includes("--parse")) {
  const recs = fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean)
    .map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const calcs = recs.map(r => ({ r, list: detailList(r.postData || ""), resp: parseBody(r.response || "") }))
    .filter(x => x.list)
  console.log(`계산(L03) ${calcs.length}건\n`)

  let prevIn = null, prevOut = null, k = 0
  for (const { r, list, resp } of calcs) {
    k++
    const IN = inMap(list)
    const respList = Array.isArray(resp?.yrsTaxClcDetailDVOList) ? resp.yrsTaxClcDetailDVOList : []
    const OUT = outMap(respList)
    console.log(`════ 계산 #${k}  (network n=${r.n ?? "?"}, ${r.actionId})`)
    // 전체 IN/OUT (코드 오름차순 합집합)
    const codes = Array.from(new Set([...Object.keys(IN), ...Object.keys(OUT)])).sort()
    console.log(`  code   │ IN (값 있는 입력필드)                              │ OUT ddcAmt`)
    for (const c of codes) {
      const inTxt = IN[c] ? inStr(IN[c]) : ""
      const outTxt = OUT[c] != null ? fmt(OUT[c]) : ""
      console.log(`  ${c.padEnd(6)} │ ${inTxt.padEnd(48)} │ ${outTxt}`)
    }
    // 증분 diff (직전 계산 대비)
    if (prevIn) {
      const dcodes = Array.from(new Set([...Object.keys(IN), ...Object.keys(prevIn), ...Object.keys(OUT), ...Object.keys(prevOut)])).sort()
      const lines = []
      for (const c of dcodes) {
        const inNow = IN[c] ? inStr(IN[c]) : "", inPrev = prevIn[c] ? inStr(prevIn[c]) : ""
        const outNow = OUT[c] ?? null, outPrev = prevOut[c] ?? null
        const inChg = inNow !== inPrev, outChg = String(outNow) !== String(outPrev)
        if (inChg || outChg) {
          let s = `    ${c}`
          if (inChg)  s += `  IN[${inPrev || "—"} → ${inNow || "—"}]`
          if (outChg) s += `  OUT[${fmt(outPrev)} → ${fmt(outNow)}]`
          lines.push(s)
        }
      }
      if (lines.length) { console.log(`  ── Δ 직전 계산(#${k - 1}) 대비 ──`); lines.forEach(l => console.log(l)) }
    }
    console.log("")
    prevIn = IN; prevOut = OUT
  }
  process.exit(0)
}

// ── 캡처 모드 ────────────────────────────────────────────────────────────────
const pw = (await import("../node_modules/playwright/index.js")).default
const { chromium } = pw
const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(LOG, "")

// 계약 데이터를 실어나르는 요청만 대상: wqAction(.do). 세션 노이즈(permission/token) 제외.
function isTarget(req) {
  if (req.method() !== "POST") return false
  const url = req.url()
  if (/permission\.do|token\.do/.test(url)) return false
  return url.includes("wqAction.do") || url.includes("Action")
}
function actionOf(url) {
  const m = url.match(/actionId=([^&]+)/)
  return m ? m[1] : (url.split("/").pop() || "?").split("?")[0]
}
function previewCodes(pd) {
  const list = detailList(pd)
  if (!list) return ""
  return Object.keys(inMap(list)).join(",")
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

  let ready = false   // 세션 진입 완료 전 트래픽(포털·세션 수립)은 번호·로그에서 제외
  let n = 0
  ctx.on("response", async resp => {
    if (!ready) return
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
    console.log(`  [계산 #${n}] ${actionId}  (status ${status})${codes ? "  값:" + codes : ""}`)
  })

  console.log("[2] 모의계산 자동계산 화면 진입... (세션 노이즈는 무시)")
  await establishSession(page)
  ready = true
  console.log("\n════════════════════════════════════════════════════")
  console.log("  준비 완료. 이제부터의 계산만 #1,#2,… 로 번호매김합니다.")
  console.log("  [권장] 항목을 하나씩 넣고 [적용하기]→[계산], 또 넣고 계산 — 증분으로 하면")
  console.log("         --parse 가 '직전 대비 Δ' 로 각 항목의 IN/OUT 을 핀포인트합니다.")
  console.log("  요청+응답이 " + LOG + " 에 페어로 기록됩니다.")
  console.log("  끝나면 Ctrl+C → node docs/hometax-capture-io.mjs --parse")
  console.log("════════════════════════════════════════════════════\n")

  await page.waitForTimeout(60 * 60 * 1000)
  await browser.close()
}

main().catch(e => { console.error("오류:", e.message); process.exit(1) })
