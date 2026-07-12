/**
 * 홈택스 모의계산 — 신용카드 send→receive 계약 프로브
 *
 * 목적: 신용카드 비교화면을 만들기 전에 두 가지를 실측 확정한다.
 *   ① 보낼 값  : YTS39 PAY_WRK_CALC.CALC_PROC_CARD(JSON)의 가~아·소계·최종공제금액 구조
 *   ② 받는 값  : 그 값을 L03에 넣었을 때 NTS가 "어느 amtClusCd 로 카드공제액을 돌려주는지"
 *
 * 방법: 카드 미포함(baseline) / 카드 포함 두 번 L03 발사 후 응답 ntsMap 을 diff.
 *   → 값이 바뀐 코드가 곧 카드 계산체인. NTS 카드소계(8430 추정) vs YTS 최종공제금액 대조.
 *
 * 사용법:
 *   node docs/hometax-card-probe.mjs                → 카드공제 대상자 자동 3명
 *   node docs/hometax-card-probe.mjs X202600123     → 특정 CALC_NO
 *   node docs/hometax-card-probe.mjs X20260001 3    → 특정 접두 + 건수
 *
 * ⚠ 이 스크립트는 읽기 전용(DB SELECT + NTS 계산 조회)이며 아무 것도 저장하지 않는다.
 */

import oracledb from "../node_modules/oracledb/lib/oracledb.js"
import pw       from "../node_modules/playwright/index.js"

const { chromium } = pw

// ── 설정 ────────────────────────────────────────────────────────────────────
const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const DB_USER    = "YTS39"
const DB_PASS    = "Yts391234!"
const START_URL  = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const L03_URL    = "https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEAA001L03&screenId=UTEYSEJF01&popupYn=false&realScreenId="
const ATTR_YR    = "2025"

// ── ★ 실측 대상 가설: CALC_PROC_CARD 항목(가~아) → NTS amtClusCd ───────────────
//   프로브 결과를 보며 이 표만 고쳐가며 계약을 확정한다.
//   가·나·다 = 일반사용계(신용/직불선불/현금영수증)
//   라·마·바 = 문화체육계(도서·공연 신용/직불/현금)   ← 8461~8463 추정
//   사·아     = 전통시장 / 대중교통                     ← 8435 / (대중교통 코드 미상)
const CARD_MAP = [
  { key: "가", label: "신용카드(일반)",       code: "8431" },
  { key: "나", label: "직불·선불카드(일반)",  code: "8432" },
  { key: "다", label: "현금영수증(일반)",     code: "8433" },
  { key: "라", label: "도서공연-신용",        code: "8461" },
  { key: "마", label: "도서공연-직불",        code: "8462" },
  { key: "바", label: "도서공연-현금",        code: "8463" },
  { key: "사", label: "전통시장",             code: "8435" },
  { key: "아", label: "대중교통(코드 미상)",  code: "8434" }, // ← 실측으로 확정 필요
]

// ── 인자 ─────────────────────────────────────────────────────────────────────
const arg1 = process.argv[2]
const arg2 = process.argv[3]
const specificCalcNo = arg1 && /^X\d{9,}$/.test(arg1) ? arg1 : null
const prefix = arg1 && !specificCalcNo ? arg1 : null
const limit  = Number(arg2) || 3

// ── Oracle 헬퍼 ─────────────────────────────────────────────────────────────
async function dbQuery(sql, params = []) {
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  try {
    const r = await conn.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT })
    return r.rows ?? []
  } finally { await conn.close() }
}

// ── 대상 CALC_NO 결정 ────────────────────────────────────────────────────────
async function pickTargets() {
  if (specificCalcNo) return [specificCalcNo]
  const where = prefix ? `c.CALC_NO LIKE '${prefix}%' AND ` : ""
  const rows = await dbQuery(`
    SELECT CALC_NO FROM (
      SELECT c.CALC_NO
      FROM YTS39.PAY_WRK_CALC c
      WHERE ${where} c.CALC_PROC_CARD IS NOT NULL
        AND NVL(c.OTO_CARD_ETC, 0) > 0
      ORDER BY NVL(c.OTO_CARD_ETC, 0) DESC
    ) WHERE ROWNUM <= :1
  `, [limit])
  return rows.map(r => r.CALC_NO)
}

// ── YTS39 데이터 조회 ────────────────────────────────────────────────────────
async function fetchYts(calcNo) {
  const rows = await dbQuery(`
    SELECT c.CALC_NO,
      c.TOT_PAY_AMT, c.PAYM_INCM_TAX, c.PROD_TAX_AMT, c.RES_INCM_TAX, c.SUB_INCM_TAX,
      c.BASC_SUB_MATE_AMT, c.BASC_SUB_FAMILY_CNT,
      c.ADD_SUB_OAT_CNT, c.ADD_SUB_HDC_PERS_CNT, c.ADD_SUB_LADY_AMT, c.ADD_SUB_SNGL_PRNT_AMT,
      c.NP_INSU_AMT, c.SPCL_IF_HLTH_INSU_AMT, c.SPCL_IF_EMP_INSU_AMT,
      NVL(c.OTO_CARD_ETC, 0) AS OTO_CARD_ETC,
      c.CALC_PROC_CARD
    FROM YTS39.PAY_WRK_CALC c
    WHERE c.CALC_NO = :1
  `, [calcNo])
  if (!rows.length) throw new Error(`CALC_NO 없음: ${calcNo}`)
  return rows[0]
}

// ── L03 body 구성 ────────────────────────────────────────────────────────────
const ALL_CODES = [
  "8900","8991",
  "8001","8002","8003","8101","8102","8103","8104",
  "8201","8301","8305",
  "8430","8431","8432","8433","8434","8435","8438","8440","8442","8461","8462","8463",
  "8710","8761","8763",
  // 결과/집계 코드도 요청목록에 포함해 응답에서 확실히 echo 받도록
  "8901","8902","8903","8923","8990","8992","8998","8999",
]

function baseDetail() {
  return ALL_CODES.map(code => ({
    amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0",
  }))
}

function buildBody(d, { withCard }) {
  const totPay  = Number(d.TOT_PAY_AMT)
  const prepaid = Number(d.PAYM_INCM_TAX)
  const detail  = baseDetail()

  const set = (code, field, val) => {
    if (!val || Number(val) === 0) return
    const item = detail.find(it => it.amtClusCd === code)
    if (item) item[field] = String(val)
  }

  // 공통 baseline (과세표준이 현실적으로 잡히도록 확정 항목 주입)
  set("8900", "useAmt", totPay)
  set("8991", "useAmt", prepaid)
  set("8001", "incDdcNfpCnt", 1)
  if (Number(d.BASC_SUB_MATE_AMT) > 0)   set("8002", "incDdcNfpCnt", 1)
  if (Number(d.BASC_SUB_FAMILY_CNT) > 0) set("8003", "incDdcNfpCnt", d.BASC_SUB_FAMILY_CNT)
  set("8101", "incDdcNfpCnt", d.ADD_SUB_OAT_CNT)
  set("8102", "incDdcNfpCnt", d.ADD_SUB_HDC_PERS_CNT)
  if (Number(d.ADD_SUB_LADY_AMT)      > 0) set("8103", "incDdcNfpCnt", 1)
  if (Number(d.ADD_SUB_SNGL_PRNT_AMT) > 0) set("8104", "incDdcNfpCnt", 1)
  set("8201", "useAmt", d.NP_INSU_AMT)
  set("8301", "useAmt", d.SPCL_IF_HLTH_INSU_AMT)
  set("8305", "useAmt", d.SPCL_IF_EMP_INSU_AMT)

  // 카드 주입 (CARD_MAP 가설대로 가~아 → 코드)
  if (withCard) {
    const card = parseCard(d.CALC_PROC_CARD)
    if (card) {
      for (const m of CARD_MAP) {
        const v = Number(card[m.key] ?? 0)
        if (v > 0) set(m.code, "useAmt", v)
      }
    }
  }

  return {
    crdcDdcAmt: "0", smltClcClCd: ATTR_YR, v_saveChk: "Y", v_conbChk: "", yrsSrvcClCd: "",
    pbtAddDdcAmt: "0", pbtDdcAmt: "0", addDdcrtDdcAmt: "0", ddcPsbAmt: "0",
    tdmrAddDdcAmt: "0", lstDdcAmt: "0", tdmrDdcAmt: "0", bppAddDdcAmt: "0",
    gnrlDdcAmt: "0", ddcExclAmt: "0",
    totaSnwAmt: String(totPay), ddcLmtAmt: "0",
    yrsTaxClcBscList: [{
      ppmTxamt: String(prepaid), attrYr: ATTR_YR, ddcRtnId: "",
      erinAmt: "0", totaSnwAmt: String(totPay), statusValue: "R",
    }],
    yrsTaxClcDetailDVOList: detail,
  }
}

// ── 파싱 헬퍼 ────────────────────────────────────────────────────────────────
function parseCard(json) {
  if (!json || json === "null") return null
  try { return JSON.parse(json) } catch { return null }
}
function toMap(raw) {
  const m = {}
  try {
    const list = JSON.parse(raw).yrsTaxClcDetailDVOList ?? []
    for (const it of list) m[String(it.amtClusCd)] = Number(it.ddcAmt ?? 0)
  } catch {}
  return m
}
function resultCode(raw) { try { return JSON.parse(raw).resultMsg?.result ?? "?" } catch { return "PARSE_ERR" } }

const fmt = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"))

// ── 출력 ─────────────────────────────────────────────────────────────────────
function printCard(calcNo, d) {
  const c = parseCard(d.CALC_PROC_CARD)
  console.log(`\n══════════════════════════════════════════════════════`)
  console.log(`▶ ${calcNo}  총급여 ${fmt(d.TOT_PAY_AMT)}  OTO_CARD_ETC ${fmt(d.OTO_CARD_ETC)}`)
  console.log(`──────────────────────────────────────────────────────`)
  if (!c) { console.log("  CALC_PROC_CARD 없음/파싱실패"); return null }
  console.log("  [YTS 카드 사용액]")
  for (const m of CARD_MAP) console.log(`    ${m.key} ${m.label.padEnd(18)} ${fmt(c[m.key]).padStart(14)}  → ${m.code}`)
  console.log(`    일반사용계 ${fmt(c.일반사용계)} · 문화체육계 ${fmt(c.문화체육계)} · 총사용액 ${fmt(c.총사용액)}`)
  console.log(`  [YTS 카드 공제계산]`)
  console.log(`    최저사용금액(25%) ${fmt(c.최저사용금액)} · 공제제외 ${fmt(c.공제제외금액)} · 공제한도 ${fmt(c.공제한도)}`)
  console.log(`    일반공제 ${fmt(c.일반공제금액)} + 추가공제 ${fmt(c.추가공제금액)}`)
  console.log(`    ★ 최종공제금액(정답) = ${fmt(c.최종공제금액)}`)
  return c
}

function printDiff(base, card, ytsCard) {
  const codes = Array.from(new Set([...Object.keys(base), ...Object.keys(card)])).sort()
  console.log(`\n  [NTS 응답 diff : baseline → +카드]  (변동 코드만)`)
  for (const code of codes) {
    const b = base[code] ?? 0, w = card[code] ?? 0
    if (b !== w) console.log(`    ${code}   ${fmt(b).padStart(14)}  →  ${fmt(w).padStart(14)}   (Δ ${fmt(w - b)})`)
  }
  const ntsCardSub = card["8430"] ?? null
  console.log(`\n  ★ NTS 카드소계(8430) = ${fmt(ntsCardSub)}`)
  if (ytsCard) {
    const y = Number(ytsCard.최종공제금액 ?? 0)
    const match = ntsCardSub != null && Number(ntsCardSub) === y
    console.log(`  ★ YTS 최종공제금액   = ${fmt(y)}   ${match ? "✅ 일치" : "❌ 차이 → 매핑 재검토"}`)
  }
  console.log(`  결정세액 baseline ${fmt(base["8999"])} → +카드 ${fmt(card["8999"])} (Δ ${fmt((card["8999"]??0)-(base["8999"]??0))})`)
}

// ── NTS 세션 ─────────────────────────────────────────────────────────────────
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
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json;charset=UTF-8" },
        body: bodyStr, credentials: "include",
      })
      return await res.text()
    } catch (e) { return JSON.stringify({ error: e.message }) }
  }, { url: L03_URL, bodyStr: JSON.stringify(body) })
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("[1] Oracle 연결...")
  oracledb.initOracleClient({ libDir: ORACLE_LIB })
  oracledb.fetchAsString = [oracledb.CLOB]

  const targets = await pickTargets()
  if (!targets.length) { console.error("대상 CALC_NO 없음 (카드공제 발생 건 미발견)"); process.exit(1) }
  console.log(`    대상 ${targets.length}명: ${targets.join(", ")}`)

  console.log("[2] 국세청 세션 수립... (headed 필수)")
  const browser = await chromium.launch({ headless: false })
  const ctx     = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page    = await ctx.newPage()
  page.on("dialog", d => d.accept().catch(() => {}))
  await establishSession(page)
  console.log("    세션 완료")

  for (const calcNo of targets) {
    const d = await fetchYts(calcNo)
    const ytsCard = printCard(calcNo, d)

    const baseRaw = await postL03(page, buildBody(d, { withCard: false }))
    await page.waitForTimeout(400)
    const cardRaw = await postL03(page, buildBody(d, { withCard: true }))
    await page.waitForTimeout(400)

    console.log(`    (응답코드 base=${resultCode(baseRaw)} / card=${resultCode(cardRaw)})`)
    printDiff(toMap(baseRaw), toMap(cardRaw), ytsCard)
  }

  await browser.close()
  console.log("\n완료.")
}

main().catch(e => { console.error("오류:", e.message); process.exit(1) })
