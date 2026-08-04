/**
 * 홈택스 모의계산 2026 — 근로소득세액공제(8700) "IN 거동" 프로브
 *
 * 질문: 8700(근로소득세액공제)은 우리가 payload 에 안 보내도(ALL_CODES 미포함) 국세청이
 *   산출세액(8990)에서 자체계산해 회신하는 순수 OUT 코드다. 그런데 **8700 을 IN 으로 담아 보내면**
 *   국세청이 (a) 그 값을 존중(에코)하는가, (b) 무시하고 자체계산으로 덮는가?
 *     → 답이 ③표에서 8700 을 어떻게 배선할지(send:false OUT-only vs 아예 전송금지)를 가른다.
 *
 * 방법(합성·자기완결, 캡처파일/DB 불필요): 총급여만 담은 최소 body 를 base 로,
 *   detail 에 8700 을 서로 다른 필드로 주입한 변형을 발사 → 응답 OUT(8700/8990/8999) 대조.
 *     V0 원문(8700 미포함)        ← 대조군. 국세청 자체계산값 X 확보
 *     V1 8700 useAmt=777,777      ← 보낸값(사용금액)으로 덮이나?
 *     V2 8700 ddcAmt=777,777      ← 공제액 직접전송(혼인8790식)으로 덮이나?
 *     V3 8700 ddcTrgtAmt=777,777  ← 공제대상금액으로 덮이나?
 *   PROBE=777,777 은 총급여 5천만 근로세액공제 실값(≤66만)과 뚜렷이 달라 에코/자체계산 구분이 명확.
 *
 * 판정:
 *   · V1~V3 의 응답 8700·8999 가 V0 와 **같음** → 국세청이 IN 무시·자체계산(예측 확정).
 *       ⇒ ③표: 8700 은 send:false OUT-only self 대조(국세청 자체계산 ddcAmt ↔ YTS RT_WIA). 에코 사각 아님.
 *   · 응답 8700 이 **보낸 777,777 로 바뀜**(또는 8999 급변) → 국세청이 IN 존중(에코).
 *       ⇒ 절대 보내면 안 됨(우리 값 도로 받는 사각). ③표 IN 칸은 비운다.
 *
 * 사용법:  node docs/hometax-wia-8700-probe.mjs
 * ⚠ 읽기 전용(NTS 조회만, DB·저장 없음). eversafe → headed 필수. 라이브 4발.
 *   방법 문서: docs/nts-contract-capture-method.md
 */

import pw from "../node_modules/playwright/index.js"
import fs from "node:fs"

const { chromium } = pw

const OUT_FILE = "data/capture/wia-8700-probe-result.txt"
const _lines = []
const log = (...a) => { const s = a.join(" "); process.stdout.write(s + "\n"); _lines.push(s) }
function flush() { try { fs.mkdirSync("data/capture", { recursive: true }); fs.writeFileSync(OUT_FILE, _lines.join("\n")) } catch {} }

// 2026 프로파일(PROFILE_2026 실측값 — fields-probe 와 동일)
const START_URL     = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const DROPDOWN_2026 = "a_1905130000"
const L03_URL_2026  = "https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEDA001L01&screenId=UTEYSEJ0E001&popupYn=false&realScreenId=UTEYSEJ0E001"
const DETAIL_EXTRA  = { ereClCd: "01", yrsSrvcClCd: "01", statusValue: "R", ddcRtnId: "" }

const TOT_PAY = 50_000_000   // 총급여(8900) — 산출세액>0 이라야 8700 자체계산이 발생
const PROBE   = 777_777      // 8700 주입 표식값(실값 ≤66만과 구분)

// buildCompareBody(runHometaxCalc.ts) ALL_CODES 사본 — 우리 앱이 실제 보내는 코드셋(8700 미포함)
const ALL_CODES = [
  "8900",
  "8001","8002","8003","8101","8102","8103","8104",
  "8201","8205","8208","8211","8215",
  "8301","8305","8311","8312",
  "8321","8322","8323","8324","8325","8326","8327","8328","8329",
  "8401","8402","8403","8404","8406","8407",
  "8410","8415","8416","8417","8418","8419","8420","8421","8422","8423",
  "8430","8431","8432","8433","8434","8435","8438","8440","8442","8464","8465","8466","8467",
  "8450","8451","8452","8453","8461","8462","8463","8501",
  "8601","8602","8603","8606","8608","8609","8610","8611","8612","8614","8616","8617","8916",
  "8701","8702","8703","8705","8706","8707","8708",
  "8710","8711",
  "8720","8721","8725","8726","8729",
  "8730","8731","8732","8733","8734","8735",
  "8740","8741","8743","8744","8746","8747",
  "8750","8751","8752","8753","8754","8906",
  "8760","8761","8763","8764","8765","8766","8783","8784","8790",
  "8811","8812","8813","8814","8815",
  "8821","8822","8823","8824","8825",
  "8831","8832","8833","8834","8835",
]

// WebSquare postData 끝의 <nts...>토큰 제거 — JSON 부분만
const strip = s => { if (!s) return "{}"; const i = s.indexOf("<nts"); return i >= 0 ? s.slice(0, i) : s }
const toMap = raw => { const m = {}; try { for (const it of (JSON.parse(strip(raw)).yrsTaxClcDetailDVOList || [])) m[String(it.amtClusCd)] = Number(it.ddcAmt ?? 0) } catch {} return m }
const fmt = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"))

// codes(전부 0 초기화) + 8900 총급여 주입 + extra8700(코드행 추가·필드 주입) → 우리 엔진 body 모양
function makeBody(codes, extra8700) {
  const detail = codes.map(code => ({
    amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0",
    ...DETAIL_EXTRA,
  }))
  const set8900 = detail.find(it => it.amtClusCd === "8900")
  if (set8900) set8900.useAmt = String(TOT_PAY)
  if (extra8700) {
    detail.push({
      amtClusCd: "8700", useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0",
      ...DETAIL_EXTRA, ...extra8700,
    })
  }
  const totPay = String(TOT_PAY)
  return {
    crdcDdcAmt: "0", smltClcClCd: "2026", v_saveChk: "Y", v_conbChk: "", yrsSrvcClCd: "",
    pbtAddDdcAmt: "0", pbtDdcAmt: "0", addDdcrtDdcAmt: "0", ddcPsbAmt: "0",
    tdmrAddDdcAmt: "0", lstDdcAmt: "0", tdmrDdcAmt: "0", bppAddDdcAmt: "0",
    gnrlDdcAmt: "0", ddcExclAmt: "0", totaSnwAmt: totPay, ddcLmtAmt: "0",
    yrsTaxClcBscList: [{ ppmTxamt: "0", attrYr: "2026", ddcRtnId: "", erinAmt: "0", totaSnwAmt: totPay, statusValue: "R" }],
    yrsTaxClcDetailDVOList: detail,
  }
}

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
  log(`[1] 세션 기동(headed) — 총급여 ${fmt(TOT_PAY)}, 8700 주입 표식 ${fmt(PROBE)}`)
  const browser = await chromium.launch({ headless: false })
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
  page.on("dialog", d => d.accept().catch(() => {}))
  await establishSession(page)
  log("    세션 완료\n")

  const variants = [
    ["V0 원문(8700 미포함)",       makeBody(ALL_CODES, null)],
    ["V1 8700 useAmt=777,777",     makeBody(ALL_CODES, { useAmt: String(PROBE) })],
    ["V2 8700 ddcAmt=777,777",     makeBody(ALL_CODES, { ddcAmt: String(PROBE) })],
    ["V3 8700 ddcTrgtAmt=777,777", makeBody(ALL_CODES, { ddcTrgtAmt: String(PROBE) })],
  ]

  let v0map = null
  for (const [name, body] of variants) {
    const raw = await postL03(page, body)
    await page.waitForTimeout(600)
    const m = toMap(raw)
    if (!v0map) v0map = m
    const err = (() => { try { const p = JSON.parse(strip(raw)); return p.error || p.resultMsg?.result || "" } catch { return raw.slice(0, 80) } })()
    const dV0 = diffMaps(v0map, m)
    log(`  [${name}]`)
    log(`     8990산출=${fmt(m["8990"])}  8700근로세액공제=${fmt(m["8700"])}  8999결정=${fmt(m["8999"])}  (응답코드수=${Object.keys(m).length})`)
    log(`     vs V0 diff(${dV0.length}): ${dV0.slice(0, 12).join("  ")}${dV0.length > 12 ? " …" : ""}`)
    if (err) log(`     ⚠ 응답이상: ${err}`)
    log("")
  }

  log("판정 가이드:")
  log("  · V1~V3 의 8700·8999 가 V0와 diff 0 → 국세청이 8700 IN 무시·자체계산 → send:false OUT-only 배선(에코 사각 아님).")
  log(`  · 어느 변형의 8700 이 ${fmt(PROBE)} 로 바뀜(또는 8999 급변) → 국세청이 그 필드로 IN 존중(에코) → 전송금지·③표 IN 비움.`)
  log(`\n(결과 파일: ${OUT_FILE})`)
  flush()
  await browser.close()
}
main().catch(e => { log("오류: " + e.message); flush(); process.exit(1) })
