/**
 * 홈택스 모의계산 2026 — "신규 래퍼필드 필수여부" 프로브 (③단계)
 *
 * 질문: 2026 L03 계약은 2025 대비 최상위 `ieNm`·`v_calChk` 신설 + detail 행별
 *   `ereClCd/yrsSrvcClCd/statusValue/ddcRtnId/attrYr` 추가가 관찰됐다(2026-07-29 캡처).
 *   우리 엔진(buildCompareBody)은 detail 행별필드는 detailRowExtra 로 넣지만 최상위
 *   ieNm/v_calChk 는 안 보낸다. → 이 필드들이 **없어도 국세청이 정확히 계산하는가?**
 *
 * 방법(합성, DB 불필요): 실측 캡처 #6(full-catalog 203행, data/capture/io-2026-*.jsonl)을
 *   ground truth 로, **코드별 입력값은 고정**하고 **래퍼 필드만** 바꿔 발사→응답 OUT 지문 대조.
 *     V0 원문 그대로               ← 대조군(캡처 응답 재현해야 세션·엔드포인트·replay 정상)
 *     V1 최상위 ieNm+v_calChk 제거   ← 신설 최상위필드 필수여부
 *     V2 detail 행별필드 제거        ← ereClCd/yrsSrvcClCd/statusValue/ddcRtnId/attrYr 필수여부
 *     V3 우리 엔진 body 모양         ← 군더더기 top·ieNm/v_calChk 없음·우리 bscList + detail=base6+detailRowExtra
 *   V3==V0 이면 ②배선이 결과동치(안전). V1/V2 가 V0와 다르면 그 필드가 load-bearing.
 *
 * 사용법:  node docs/hometax-2026-fields-probe.mjs
 * ⚠ 읽기 전용(NTS 조회만, 저장 없음). eversafe → headed 필수. 라이브 4발.
 */

import pw from "../node_modules/playwright/index.js"
import fs from "node:fs"

const { chromium } = pw

const OUT_FILE = "data/capture/2026-fields-probe-result.txt"
const _lines = []
const log = (...a) => { const s = a.join(" "); process.stdout.write(s + "\n"); _lines.push(s) }
function flush() { try { fs.mkdirSync("data/capture", { recursive: true }); fs.writeFileSync(OUT_FILE, _lines.join("\n")) } catch {} }

const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
// 2026 프로파일(PROFILE_2026 실측값)
const DROPDOWN_2026 = "a_1905130000"
const L03_URL_2026  = "https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEDA001L01&screenId=UTEYSEJ0E001&popupYn=false&realScreenId=UTEYSEJ0E001"
const CAPTURE_FILE  = "data/capture/io-2026-catalog-20260729.jsonl"
const DETAIL_EXTRA  = { ereClCd: "01", yrsSrvcClCd: "01", statusValue: "R", ddcRtnId: "" }

// WebSquare 는 postData 끝에 `<nts...>토큰` 을 붙인다 — JSON 부분만 추출(서버는 순수 JSON fetch 로 정상, 2025 배치 실증)
const strip = s => { if (!s) return "{}"; const i = s.indexOf("<nts"); return i >= 0 ? s.slice(0, i) : s }

function loadGroundTruth() {
  const recs = fs.readFileSync(CAPTURE_FILE, "utf8").trim().split(/\r?\n/).map(l => JSON.parse(l))
  const calcs = recs.filter(r => r.actionId === "ATEYSEDA001L01")
  // full-catalog = detail 행 최다(모든 코드 입력)
  const c = calcs.reduce((a, b) => {
    const na = (JSON.parse(strip(a.postData)).yrsTaxClcDetailDVOList || []).length
    const nb = (JSON.parse(strip(b.postData)).yrsTaxClcDetailDVOList || []).length
    return nb > na ? b : a
  })
  return { body: JSON.parse(strip(c.postData)), resp: JSON.parse(strip(c.response)), n: c.n }
}

const toMap = raw => { const m = {}; try { for (const it of (JSON.parse(strip(raw)).yrsTaxClcDetailDVOList || [])) m[String(it.amtClusCd)] = Number(it.ddcAmt ?? 0) } catch {} return m }
const clone = o => JSON.parse(JSON.stringify(o))

// V1: 최상위 ieNm·v_calChk 제거
function variantNoTop(base) { const b = clone(base); delete b.ieNm; delete b.v_calChk; return b }
// V2: detail 행별 신규필드 제거(2025 형태로)
function variantNoDetailExtra(base) {
  const b = clone(base)
  b.yrsTaxClcDetailDVOList = b.yrsTaxClcDetailDVOList.map(r => ({
    amtClusCd: r.amtClusCd, useAmt: r.useAmt, ddcLmtAmt: r.ddcLmtAmt,
    incDdcNfpCnt: r.incDdcNfpCnt, ddcTrgtAmt: r.ddcTrgtAmt, ddcAmt: r.ddcAmt,
  }))
  return b
}
// V3: 우리 엔진(buildCompareBody)이 실제로 보내는 body 모양 재구성(입력값은 캡처와 동일 고정)
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

const fmt = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"))
function diffMaps(ref, got) {
  const codes = new Set([...Object.keys(ref), ...Object.keys(got)])
  const diffs = []
  for (const c of codes) { const a = ref[c] ?? 0, b = got[c] ?? 0; if (a !== b) diffs.push(`${c}:${fmt(a)}→${fmt(b)}`) }
  return diffs
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
  log("[1] ground truth 로드...")
  const { body: base, resp: capResp, n } = loadGroundTruth()
  const capMap = toMap(JSON.stringify(capResp))
  log(`    캡처 #${n}  detail=${base.yrsTaxClcDetailDVOList.length}행  캡처 8990산출=${fmt(capMap["8990"])} 8700근로세액=${fmt(capMap["8700"])} 8999결정=${fmt(capMap["8999"])}`)

  log("[2] 국세청 2026 세션 기동(headed)...")
  const browser = await chromium.launch({ headless: false })
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
  page.on("dialog", d => d.accept().catch(() => {}))
  await establishSession(page)
  log("    세션 완료\n")

  const variants = [
    ["V0 원문 그대로", base],
    ["V1 최상위 ieNm+v_calChk 제거", variantNoTop(base)],
    ["V2 detail 행별필드 제거", variantNoDetailExtra(base)],
    ["V3 우리 엔진 body 모양", variantOurEngine(base)],
  ]

  let v0map = null
  for (const [name, body] of variants) {
    const raw = await postL03(page, body)
    await page.waitForTimeout(500)
    const m = toMap(raw)
    if (!v0map) v0map = m
    const err = (() => { try { const p = JSON.parse(strip(raw)); return p.error || p.resultMsg?.result || "" } catch { return raw.slice(0, 80) } })()
    const dCap = diffMaps(capMap, m)
    const dV0  = diffMaps(v0map, m)
    log(`  [${name}]`)
    log(`     8990산출=${fmt(m["8990"])} 8700근로세액=${fmt(m["8700"])} 8999결정=${fmt(m["8999"])}  (응답코드수=${Object.keys(m).length})`)
    log(`     vs 캡처응답 diff(${dCap.length}): ${dCap.slice(0, 12).join("  ")}${dCap.length > 12 ? " …" : ""}`)
    log(`     vs V0    diff(${dV0.length}): ${dV0.slice(0, 12).join("  ")}${dV0.length > 12 ? " …" : ""}`)
    if (err) log(`     ⚠ 응답이상: ${err}`)
    log("")
  }

  log("판정 가이드:")
  log("  · V0 이 캡처응답과 diff 0 → 세션·엔드포인트·replay 정상(대조군 성립).")
  log("  · V1/V2/V3 이 V0와 diff 0 → 그 래퍼필드는 결과에 무관(제거/우리모양 안전).")
  log("  · V3 diff 0 → ②배선(엔진 body)이 국세청 계산과 결과동치 = 2026 정확 검증.")
  log("  · 어느 변형이 산출/결정 급변·응답이상 → 그 필드가 load-bearing → 엔진에 반영 필요.")
  log(`\n(결과 파일: ${OUT_FILE})`)
  flush()
  await browser.close()
}
main().catch(e => { log("오류: " + e.message); flush(); process.exit(1) })
