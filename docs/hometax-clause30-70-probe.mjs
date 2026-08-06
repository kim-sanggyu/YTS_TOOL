/**
 * 조특법30조 70%(중소기업취업 감면) — "실입력 코드 8607 vs 8603" 계약 lock 프로브
 *
 * 배경(2026-08-07 라이브 캡처 #9, 70% 단독):
 *   국세청 화면은 70% 감면대상급여를 **8607 useAmt** 로 보낸다(8603 아님). 8603 은 OUT 에코만.
 *   그런데 우리 엔진(buildCompareBody)은 70% 를 **8603** 으로, 게다가 어제(25e0030) useAmt 외에
 *   ddcTrgtAmt+ddcLmtAmt=-1 까지 붙여 보낸다 → 국세청 감면 0(어제 실증).
 *
 * 질문: 우리 엔진 body 모양으로
 *   V1(현행: 코드 8603 + useAmt+ddcTrgtAmt+ddcLmtAmt=-1) → 정말 0 인가?
 *   V2(제안: 코드 8607 + useAmt 만)                        → 64,983 살아나는가?
 *
 * 방법(합성): 방금 캡처한 70% 단독 payload(8607 useAmt=1,111,111)를 ground truth 로,
 *   세액감면 detail 만 바꿔 발사→응답 OUT(8603/8607/8608/8924세액감면계/8999결정) 대조.
 *     V0 화면 원문(8607 useAmt, 화면 wrapper)  ← 대조군(캡처응답 재현해야 세션·replay 정상)
 *     V1 우리 엔진 wrapper + 코드 8603(현행 3필드)
 *     V2 우리 엔진 wrapper + 코드 8607(useAmt 만)
 *
 * 사용법:  node docs/hometax-clause30-70-probe.mjs
 * ⚠ 읽기 전용(NTS 조회만, 저장 없음). eversafe → headed 필수. 라이브 3발.
 */

import pw from "../node_modules/playwright/index.js"
import fs from "node:fs"

const { chromium } = pw

const OUT_FILE = "data/capture/clause30-70-probe-result.txt"
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

// io.jsonl 에서 "8607 useAmt 있고 8603 IN 없는" L01 계산(=70% 단독) 을 ground truth 로.
function loadGroundTruth() {
  const recs = fs.readFileSync(CAPTURE_FILE, "utf8").trim().split(/\r?\n/).map(l => JSON.parse(l))
  const calcs = recs.filter(r => (r.actionId || "").includes("L01") && r.postData)
    .map(r => ({ r, body: JSON.parse(strip(r.postData)), resp: JSON.parse(strip(r.response || "{}")) }))
  // 8607 useAmt>0 인 계산 중 마지막(가장 깨끗한 단독 케이스)
  const hit = calcs.filter(c => {
    const rows = c.body.yrsTaxClcDetailDVOList || []
    const r607 = rows.find(x => String(x.amtClusCd) === "8607")
    return r607 && Number(r607.useAmt) > 0
  }).pop()
  if (!hit) throw new Error("io.jsonl 에 8607 useAmt 계산이 없음 — 70% 단독 캡처를 먼저 하세요.")
  return { body: hit.body, resp: hit.resp, n: hit.r.n }
}

const toMap = raw => { const m = {}; try { for (const it of (JSON.parse(strip(raw)).yrsTaxClcDetailDVOList || [])) m[String(it.amtClusCd)] = Number(it.ddcAmt ?? 0) } catch {} return m }

// base(화면 payload) → 우리 엔진 buildCompareBody 모양으로 재구성(입력값 유지)
function variantOurEngine(base) {
  const totPay = String(base.yrsTaxClcDetailDVOList.find(r => r.amtClusCd === "8900")?.useAmt ?? "0")
  const detail = base.yrsTaxClcDetailDVOList.map(r => ({
    amtClusCd: r.amtClusCd, useAmt: r.useAmt, ddcLmtAmt: r.ddcLmtAmt,
    incDdcNfpCnt: r.incDdcNfpCnt, ddcTrgtAmt: r.ddcTrgtAmt, ddcAmt: r.ddcAmt,
    ...DETAIL_EXTRA,
  }))
  return {
    crdcDdcAmt: "0", smltClcClCd: "2026", v_saveChk: "Y", v_conbChk: "", yrsSrvcClCd: "",
    pbtAddDdcAmt: "0", pbtDdcAmt: "0", addDdcrtDdcAmt: "0", ddcPsbAmt: "0",
    tdmrAddDdcAmt: "0", lstDdcAmt: "0", tdmrDdcAmt: "0", bppAddDdcAmt: "0",
    gnrlDdcAmt: "0", ddcExclAmt: "0", totaSnwAmt: totPay, ddcLmtAmt: "0",
    yrsTaxClcBscList: [{ ppmTxamt: "0", attrYr: "2026", ddcRtnId: "", erinAmt: "0", totaSnwAmt: totPay, statusValue: "R" }],
    yrsTaxClcDetailDVOList: detail,
  }
}

// 특정 코드 행을 찾아 필드 세팅(없으면 base6+extra 로 추가). 나머지 필드는 "0".
function setRow(body, code, fields) {
  let row = body.yrsTaxClcDetailDVOList.find(r => String(r.amtClusCd) === code)
  if (!row) {
    row = { amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0", ...DETAIL_EXTRA }
    body.yrsTaxClcDetailDVOList.push(row)
  }
  // 세액감면 필드 초기화 후 지정값
  row.useAmt = "0"; row.ddcTrgtAmt = "0"; row.ddcLmtAmt = "0"; row.ddcAmt = "0"
  for (const [k, v] of Object.entries(fields)) row[k] = String(v)
}
// 특정 코드 행의 입력필드 0으로(=미전송 효과)
function clearRow(body, code) {
  const row = body.yrsTaxClcDetailDVOList.find(r => String(r.amtClusCd) === code)
  if (row) { row.useAmt = "0"; row.ddcTrgtAmt = "0"; row.ddcLmtAmt = "0"; row.ddcAmt = "0" }
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

const AMT = 1111111   // 70% 감면대상급여(캡처값)
const SHOW = ["8603", "8607", "8608", "8924", "8999"]

function buildVariants(base) {
  // V1: 우리 엔진 wrapper + 코드 8603(현행: useAmt+ddcTrgtAmt+ddcLmtAmt=-1), 8607 미전송
  const v1 = variantOurEngine(base)
  clearRow(v1, "8607")
  setRow(v1, "8603", { useAmt: AMT, ddcTrgtAmt: AMT, ddcLmtAmt: -1 })
  // V2: 우리 엔진 wrapper + 코드 8607(useAmt 만), 8603 미전송
  const v2 = variantOurEngine(base)
  clearRow(v2, "8603")
  setRow(v2, "8607", { useAmt: AMT })
  return [
    ["V0 화면 원문(8607 useAmt, 화면 wrapper)", clone(base)],
    ["V1 우리엔진 + 코드8603(현행 3필드)", v1],
    ["V2 우리엔진 + 코드8607(useAmt만)", v2],
  ]
}

async function main() {
  log("[1] ground truth 로드 (io.jsonl 70% 단독 8607)...")
  const { body: base, resp: capResp, n } = loadGroundTruth()
  const capMap = toMap(JSON.stringify(capResp))
  log(`    캡처 #${n}  detail=${base.yrsTaxClcDetailDVOList.length}행  캡처응답 8607=${fmt(capMap["8607"])} 8603=${fmt(capMap["8603"])} 8924세액감면계=${fmt(capMap["8924"])} 8999결정=${fmt(capMap["8999"])}`)

  log("[2] 국세청 2026 세션 기동(headed)...")
  const browser = await chromium.launch({ headless: false })
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
  page.on("dialog", d => d.accept().catch(() => {}))
  await establishSession(page)
  log("    세션 완료\n")

  const variants = buildVariants(base)
  for (const [name, body] of variants) {
    const raw = await postL03(page, body)
    await page.waitForTimeout(500)
    const m = toMap(raw)
    const err = (() => { try { const p = JSON.parse(strip(raw)); return p.error || "" } catch { return raw.slice(0, 80) } })()
    log(`  [${name}]`)
    log(`     ${SHOW.map(c => `${c}=${fmt(m[c])}`).join("  ")}`)
    if (err) log(`     ⚠ 응답이상: ${err}`)
    log("")
  }

  log("판정 가이드:")
  log("  · V0 이 캡처응답(8607=64,983·8924=64,983) 재현 → 세션·replay 정상(대조군).")
  log("  · V1(코드8603) 8607/8924=0 → 우리 현행이 70% 감면을 못 살림(어제 버그 실증).")
  log("  · V2(코드8607) 8607=64,983·8924=64,983 → 8603→8607 로 고치면 70% 감면 살아남(FIX 확정).")
  log(`\n(결과 파일: ${OUT_FILE})`)
  flush()
  await browser.close()
}
main().catch(e => { log("오류: " + e.message); flush(); process.exit(1) })
