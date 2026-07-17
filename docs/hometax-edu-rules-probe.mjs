/**
 * 홈택스 모의계산 — 교육비 국세청 계산규칙 리버스 엔지니어링 (통제 실험)
 *
 * 목적: YTS 데이터와 무관하게, 하드코딩 골격(총급여 1억·기납부 500만·본인공제만)에
 *   교육비 코드(8730~8734)만 통제값으로 넣어 국세청 L03 응답을 관찰 → "뭘 보내고 뭘 돌려받나" 규칙표.
 *
 * 실험:
 *   1 필드판별 : 8732에 300만을 useAmt / ddcTrgtAmt / incDdcNfpCnt 각각 → 어느 필드가 먹히나
 *   2 초중고한도: 8732 ddcTrgtAmt = 100/300/500만 → 300만/인 자르나? ×15%?
 *   3 대학한도  : 8733 ddcTrgtAmt = 500/900/1500만 → 900만/인 자르나?
 *   4 본인무한도: 8730 ddcTrgtAmt = 2000만 → 무한도 ×15%?
 *   5 소계합산  : 8730~8734 각 100만 → 8735=750만? 개별 ddcAmt 각 15만?
 *
 * 각 발사마다 8730~8735 + 8998/8999(결정·차감) ddcAmt 관찰.
 * ⚠ 읽기전용(국세청 조회만, DB·저장 없음). eversafe → headed 필수.
 *
 * 사용법: node docs/hometax-edu-rules-probe.mjs
 */

import pw from "../node_modules/playwright/index.js"
const { chromium } = pw

const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const L03_URL   = "https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEAA001L03&screenId=UTEYSEJF01&popupYn=false&realScreenId="
const ATTR_YR   = "2025"

// ── 하드코딩 골격 (YTS 무관) ──
const TOT_PAY = 100_000_000   // 총급여 1억
const PREPAID = 5_000_000     // 기납부 500만

const CODES = [
  "8900","8991","8001",
  "8730","8731","8732","8733","8734","8735",
  "8751","8752","8753","8754",
  "8922","8923","8990","8992","8998","8999",
]
function baseDetail() {
  return CODES.map(code => ({
    amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0",
  }))
}
// sets = [[code, field, val], ...]
function buildBody(sets) {
  const detail = baseDetail()
  const set = (code, field, val) => {
    const it = detail.find(x => x.amtClusCd === code)
    if (it) it[field] = String(val)
  }
  set("8900", "useAmt", TOT_PAY)
  set("8991", "useAmt", PREPAID)
  set("8001", "incDdcNfpCnt", 1)
  for (const [c, f, v] of sets) set(c, f, v)
  return {
    crdcDdcAmt: "0", smltClcClCd: ATTR_YR, v_saveChk: "Y", v_conbChk: "", yrsSrvcClCd: "",
    pbtAddDdcAmt: "0", pbtDdcAmt: "0", addDdcrtDdcAmt: "0", ddcPsbAmt: "0",
    tdmrAddDdcAmt: "0", lstDdcAmt: "0", tdmrDdcAmt: "0", bppAddDdcAmt: "0",
    gnrlDdcAmt: "0", ddcExclAmt: "0",
    totaSnwAmt: String(TOT_PAY), ddcLmtAmt: "0",
    yrsTaxClcBscList: [{
      ppmTxamt: String(PREPAID), attrYr: ATTR_YR, ddcRtnId: "",
      erinAmt: "0", totaSnwAmt: String(TOT_PAY), statusValue: "R",
    }],
    yrsTaxClcDetailDVOList: detail,
  }
}
function toMap(raw) {
  const m = {}
  try { for (const it of (JSON.parse(raw).yrsTaxClcDetailDVOList ?? [])) m[String(it.amtClusCd)] = Number(it.ddcAmt ?? 0) } catch {}
  return m
}
function resultCode(raw) { try { return JSON.parse(raw).resultMsg?.result ?? "?" } catch { return "ERR" } }
const fmt = n => Number(n ?? 0).toLocaleString("ko-KR")

// ── 실험 정의 (★"ddcTrgtAmt 보내면 무엇을 돌려받나" — 응답 전체 변동코드 덤프) ──
const EXPERIMENTS = [
  { grp: "기타세액공제 3항목 — 보내면 결과 어디로? (응답 전체 변동)", shots: [
    { label: "외국납부 8751=200만 + 8754국외급여=2000만", sets: [["8751","useAmt",2_000_000],["8754","useAmt",20_000_000]] },
    { label: "외국납부 8751=200만 (8754없이)",           sets: [["8751","useAmt",2_000_000]] },
    { label: "주택차입금 8752=100만",                    sets: [["8752","useAmt",1_000_000]] },
    { label: "납세조합 8753=120만 + ddcLmtAmt=100만",     sets: [["8753","useAmt",1_200_000],["8753","ddcLmtAmt",1_000_000]] },
    { label: "납세조합 8753=120만 (lmt없이)",            sets: [["8753","useAmt",1_200_000]] },
  ]},
]
const DUMP_ALL = true   // 응답 전체 변동코드 덤프 모드

const WATCH = ["8730","8731","8732","8733","8734","8735","8998","8999"]

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
async function postL03(page, body) {
  return page.evaluate(async ({ url, bodyStr }) => {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json;charset=UTF-8" }, body: bodyStr, credentials: "include" })
      return await res.text()
    } catch (e) { return JSON.stringify({ error: e.message }) }
  }, { url: L03_URL, bodyStr: JSON.stringify(body) })
}

async function main() {
  console.log("국세청 세션 수립... (headed 필수)")
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await ctx.newPage()
  page.on("dialog", d => d.accept().catch(() => {}))
  await establishSession(page)
  console.log(`세션 완료 — 골격: 총급여 ${fmt(TOT_PAY)} · 기납부 ${fmt(PREPAID)} · 본인공제\n`)

  // baseline(교육비 0)
  const baseRaw = await postL03(page, buildBody([])); await page.waitForTimeout(400)
  const base = toMap(baseRaw)
  console.log(`baseline 결정세액 8998=${fmt(base["8998"])}  차감 8999=${fmt(base["8999"])}  (응답 ${resultCode(baseRaw)})`)
  console.log(`관찰코드: ${WATCH.join("  ")}\n`)

  for (const exp of EXPERIMENTS) {
    console.log(`── ${exp.grp} ──`)
    for (const shot of exp.shots) {
      const raw = await postL03(page, buildBody(shot.sets)); await page.waitForTimeout(400)
      // 응답 원본에서 관심 코드의 전체 필드(key) 덤프 → 결과가 어느 key로 들어오나 확인
      let full; try { full = JSON.parse(raw) } catch {}
      const list = full?.yrsTaxClcDetailDVOList || []
      const watchCodes = [...new Set([...shot.sets.map(s => s[0]), "8906", "8998", "8999"])]
      console.log(`\n  [보낸값] ${shot.sets.map(([c, f, v]) => `${c}.${f}=${fmt(v)}`).join("  ")}`)
      console.log(`  [응답 — 관심코드 전체 필드]`)
      for (const c of watchCodes) {
        const it = list.find(x => String(x.amtClusCd) === c)
        if (!it) { console.log(`     ${c}: (없음)`); continue }
        const nz = Object.entries(it).filter(([k, v]) => !["amtClusCd", "attrYr", "ddcRtnId", "ereClCd", "yrsSrvcClCd", "statusValue", "ieTin"].includes(k) && v && v !== "0" && v !== "-1")
        console.log(`     ${c}: ${nz.length ? nz.map(([k, v]) => `${k}=${fmt(v)}`).join("  ") : "(전 필드 0)"}`)
      }
    }
    console.log("")
  }

  await browser.close()
  console.log("완료.")
}

main().catch(e => { console.error("오류:", e.message); process.exit(1) })
