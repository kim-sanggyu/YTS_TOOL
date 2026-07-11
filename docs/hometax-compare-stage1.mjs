/**
 * 홈택스 모의계산 대조 — Stage 1 (A안: body 직접 구성)
 *
 * 사용법:  node docs/hometax-compare-stage1.mjs <CALC_NO>
 * 예:      node docs/hometax-compare-stage1.mjs X202600001
 *
 * 전략: NTS 세션 수립 후 L03 body를 캡처 없이 직접 구성해 재전송.
 *   yrsTaxClcBscList  : 총급여 + 기납부세액
 *   yrsTaxClcDetailDVOList : 공제 코드 전체 0 초기화 후 YTS39 값 주입
 *
 * Stage 1 커버리지 (확정 코드만):
 *   총급여·기납부, 인적공제(기본·추가), 국민연금, 건강·고용보험, 보장성보험, 자녀
 */

import oracledb from "../node_modules/oracledb/lib/oracledb.js"
import pw       from "../node_modules/playwright/index.js"
import { readFileSync } from "fs"

const { chromium } = pw

// ── 설정 ────────────────────────────────────────────────────────────────────
const CALC_NO    = process.argv[2]
const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const DB_USER    = "YTS39"
const DB_PASS    = "Yts391234!"
const START_URL  = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const L03_URL    = "https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEAA001L03&screenId=UTEYSEJF01&popupYn=false&realScreenId="
const ATTR_YR    = "2025"

if (!CALC_NO) {
  console.error("사용법: node docs/hometax-compare-stage1.mjs <CALC_NO>")
  process.exit(1)
}

// ── Oracle 헬퍼 ─────────────────────────────────────────────────────────────
async function dbQuery(sql, params = []) {
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  try {
    const r = await conn.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT })
    return r.rows ?? []
  } finally { await conn.close() }
}

// ── YTS39 데이터 조회 ────────────────────────────────────────────────────────
async function fetchYtsData(calcNo) {
  const rows = await dbQuery(`
    SELECT c.CALC_NO,
      c.TOT_PAY_AMT, c.PAYM_INCM_TAX, c.PROD_TAX_AMT, c.RES_INCM_TAX, c.SUB_INCM_TAX,
      c.BASC_SUB_MATE_AMT, c.BASC_SUB_FAMILY_CNT,
      c.ADD_SUB_OAT_CNT, c.ADD_SUB_HDC_PERS_CNT, c.ADD_SUB_LADY_AMT, c.ADD_SUB_SNGL_PRNT_AMT,
      c.NP_INSU_AMT, c.SPCL_IF_HLTH_INSU_AMT, c.SPCL_IF_EMP_INSU_AMT,
      c.SPCL_IF_GRT_INSU_AMT, c.RT_HWC_CNT, c.RT_PER_CHI_CNT,
      NVL(c.RT_MEDI_AMT,0) AS MEDI_AMT,
      NVL(c.RT_EDU_AMT,0)  AS EDU_AMT,
      NVL(c.OTO_CARD_ETC,0) AS CARD_AMT,
      NVL(c.RT_DON_LAW,0)+NVL(c.RT_PSA,0)+NVL(c.RT_PSA_RELGN,0) AS GIFT_AMT
    FROM YTS39.PAY_WRK_CALC c
    WHERE c.CALC_NO = :1
  `, [calcNo])
  if (!rows.length) throw new Error(`CALC_NO 없음: ${calcNo}`)
  return rows[0]
}

// ── L03 body 구성 ────────────────────────────────────────────────────────────
// 카탈로그에서 알려진 모든 amtClusCd — 전부 0으로 초기화 후 YTS39 값 주입
const ALL_CODES = [
  "8900","8991",
  "8001","8002","8003","8101","8102","8103","8104",
  "8201","8205","8208","8211","8215",
  "8301","8305","8311","8312",
  "8321","8322","8323","8324","8325","8326","8327","8328","8329",
  "8401","8402","8403","8404","8406","8407",
  "8419","8420","8415","8416","8417","8418",
  "8431","8432","8433","8434","8435","8438","8440","8442",
  "8461","8462","8463",
  "8450","8451","8452","8453","8501",
  "8601","8602","8604","8605","8606","8608","8609","8610","8916",
  "8701","8702","8703","8707","8708",
  "8710","8711",
  "8720","8721","8725","8729",
  "8730","8731","8732","8733","8734",
  "8740","8743","8744","8746","8747",
  "8751","8752","8753","8750",
  "8760","8761","8763","8764","8765","8766","8783","8784","8790",
  "8811","8812","8813","8814","8815",
  "8821","8822","8823","8824","8825",
  "8831","8832","8833","8834","8835",
  "8455","8457","8458",
]

function buildL03Body(d) {
  const totPay  = Number(d.TOT_PAY_AMT)
  const prepaid = Number(d.PAYM_INCM_TAX)

  // 전체 코드 0 초기화
  const detailList = ALL_CODES.map(code => ({
    amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0",
  }))

  // 값 주입 헬퍼
  const set = (code, field, val) => {
    if (!val || Number(val) === 0) return
    const item = detailList.find(it => it.amtClusCd === code)
    if (item) item[field] = String(val)
  }

  // 총급여 / 기납부
  set("8900", "useAmt",      totPay)
  set("8991", "useAmt",      prepaid)

  // 기본공제 — 본인 항상 1
  set("8001", "incDdcNfpCnt", 1)
  if (Number(d.BASC_SUB_MATE_AMT) > 0)   set("8002", "incDdcNfpCnt", 1)
  if (Number(d.BASC_SUB_FAMILY_CNT) > 0) set("8003", "incDdcNfpCnt", d.BASC_SUB_FAMILY_CNT)

  // 추가공제
  set("8101", "incDdcNfpCnt", d.ADD_SUB_OAT_CNT)
  set("8102", "incDdcNfpCnt", d.ADD_SUB_HDC_PERS_CNT)
  if (Number(d.ADD_SUB_LADY_AMT)       > 0) set("8103", "incDdcNfpCnt", 1)
  if (Number(d.ADD_SUB_SNGL_PRNT_AMT)  > 0) set("8104", "incDdcNfpCnt", 1)

  // 연금보험료 / 특별소득공제 / 세액공제
  set("8201", "useAmt", d.NP_INSU_AMT)
  set("8301", "useAmt", d.SPCL_IF_HLTH_INSU_AMT)
  set("8305", "useAmt", d.SPCL_IF_EMP_INSU_AMT)
  set("8710", "useAmt", d.SPCL_IF_GRT_INSU_AMT)
  set("8763", "incDdcNfpCnt", d.RT_HWC_CNT)
  set("8761", "incDdcNfpCnt", d.RT_PER_CHI_CNT)

  return {
    crdcDdcAmt: "0", smltClcClCd: ATTR_YR, v_saveChk: "Y", v_conbChk: "", yrsSrvcClCd: "",
    pbtAddDdcAmt: "0", pbtDdcAmt: "0", addDdcrtDdcAmt: "0", ddcPsbAmt: "0",
    tdmrAddDdcAmt: "0", lstDdcAmt: "0", tdmrDdcAmt: "0", bppAddDdcAmt: "0",
    gnrlDdcAmt: "0", ddcExclAmt: "0",
    totaSnwAmt: String(totPay), ddcLmtAmt: "0",
    yrsTaxClcBscList: [{
      ppmTxamt: String(prepaid), attrYr: ATTR_YR, ddcRtnId: "",
      erinAmt: "0", totaSnwAmt: String(totPay), statusValue: "R"
    }],
    yrsTaxClcDetailDVOList: detailList,
  }
}

// ── L03 응답 파싱 ─────────────────────────────────────────────────────────────
function pickAmt(list, code) {
  const it = list.find(x => String(x.amtClusCd) === code)
  return it ? Number(it.ddcAmt ?? 0) : null
}
function parseL03(raw) {
  try {
    const parsed = JSON.parse(raw)
    const list   = parsed.yrsTaxClcDetailDVOList ?? []
    return {
      prodTax:    pickAmt(list, "8990"),
      decidedTax: pickAmt(list, "8999"),
      withheld:   pickAmt(list, "8992"),
      workDdc:    pickAmt(list, "8901"),
      taxBase:    pickAmt(list, "8903"),
      result:     parsed.resultMsg?.result ?? null,
    }
  } catch { return { result: "PARSE_ERROR" } }
}

// ── 비교 출력 ─────────────────────────────────────────────────────────────────
function printCompare(yts, nts) {
  const fmt = n => n == null ? "—" : n.toLocaleString("ko-KR")
  const cols = [
    ["산출세액",    yts.PROD_TAX_AMT, nts.prodTax],
    ["결정세액",    yts.RES_INCM_TAX, nts.decidedTax],
    ["차감징수",    yts.SUB_INCM_TAX, nts.withheld],
    ["근로소득공제", null,             nts.workDdc],
    ["과세표준",    null,             nts.taxBase],
  ]
  console.log("\n┌─────────────────────────────────────────────────────┐")
  console.log(`│ CALC_NO: ${yts.CALC_NO}`)
  console.log(`│ 총급여: ${fmt(yts.TOT_PAY_AMT)}  기납부: ${fmt(yts.PAYM_INCM_TAX)}`)
  console.log("├──────────────┬──────────────┬──────────────┬────────┤")
  console.log("│ 항목         │ YTS39        │ 국세청(NTS)  │ 일치   │")
  console.log("├──────────────┼──────────────┼──────────────┼────────┤")
  for (const [label, ytsVal, ntsVal] of cols) {
    const match = ytsVal == null ? "—" : (ytsVal === ntsVal ? "✅ 일치" : "❌ 차이")
    console.log(`│ ${label.padEnd(12)} │ ${(ytsVal==null?"—":fmt(ytsVal)).padStart(12)} │ ${fmt(ntsVal).padStart(12)} │ ${match.padEnd(6)} │`)
  }
  console.log("└──────────────┴──────────────┴──────────────┴────────┘")
  console.log(`\n국세청 응답코드: ${nts.result}`)
}

// ── NTS 텍스트 클릭 헬퍼 ─────────────────────────────────────────────────────
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

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  // 1) Oracle + DB 조회
  console.log(`[1/4] Oracle 연결 중... (${DB_USER})`)
  oracledb.initOracleClient({ libDir: ORACLE_LIB })
  oracledb.fetchAsString = [oracledb.CLOB]
  const yts = await fetchYtsData(CALC_NO)
  console.log(`      CALC_NO: ${yts.CALC_NO}  총급여: ${Number(yts.TOT_PAY_AMT).toLocaleString()}`)

  const excl = []
  if (Number(yts.MEDI_AMT)  > 0) excl.push(`의료비 ${Number(yts.MEDI_AMT).toLocaleString()}`)
  if (Number(yts.EDU_AMT)   > 0) excl.push(`교육비 ${Number(yts.EDU_AMT).toLocaleString()}`)
  if (Number(yts.CARD_AMT)  > 0) excl.push(`신용카드 ${Number(yts.CARD_AMT).toLocaleString()}`)
  if (Number(yts.GIFT_AMT)  > 0) excl.push(`기부금 ${Number(yts.GIFT_AMT).toLocaleString()}`)
  if (excl.length) console.warn(`\n⚠️  Stage 1 미전송: ${excl.join(", ")} → 결과 차이 예상\n`)

  // 2) L03 body 구성
  const l03Body = buildL03Body(yts)
  const injectedCodes = l03Body.yrsTaxClcDetailDVOList
    .filter(it => Number(it.useAmt) > 0 || Number(it.incDdcNfpCnt) > 0)
    .map(it => it.amtClusCd)
  console.log(`[2/4] L03 body 구성: ${ALL_CODES.length}개 코드 (비零 ${injectedCodes.length}개: ${injectedCodes.join(",")})`)

  // 3) NTS 세션 수립
  console.log("[3/4] 국세청 접속 중... (headed 필수)")
  const browser = await chromium.launch({ headless: false })
  const ctx     = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page    = await ctx.newPage()
  page.on("dialog", d => d.accept().catch(() => {}))

  // 자연 L03 응답 캡처 (기본값 참고용)
  const naturalResponses = []
  await ctx.route("**ATEYSEAA001L03**", async (route) => {
    try {
      const resp = await route.fetch()
      const text = await resp.text()
      naturalResponses.push(text)
      await route.fulfill({ response: resp, body: text })
    } catch { await route.continue() }
  })

  // NTS 메인 → 모의계산 → 연말정산 자동계산하기
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

  // 세션 수립 완료 — 팝업/계산하기 클릭 불필요 (L03 직접 POST)
  console.log("      세션 수립 완료")

  // 4) 우리 body로 L03 재전송
  console.log(`\n[4/4] 우리 데이터로 L03 전송 중...`)
  const bodyStr = JSON.stringify(l03Body)
  const ntsRaw  = await page.evaluate(async ({ url, body }) => {
    try {
      const res = await fetch(url, {
        method:      "POST",
        headers:     { "Content-Type": "application/json;charset=UTF-8" },
        body,
        credentials: "include",
      })
      return await res.text()
    } catch (e) { return JSON.stringify({ error: e.message }) }
  }, { url: L03_URL, body: bodyStr })

  const nts = parseL03(ntsRaw)

  // 자연 계산 결과 참고 출력
  if (naturalResponses.length) {
    const nat = parseL03(naturalResponses[naturalResponses.length - 1])
    console.log(`\n[참고] NTS 자연계산 산출세액: ${(nat.prodTax ?? 0).toLocaleString()} (응답코드: ${nat.result})`)
  }

  // 비교 출력
  printCompare(yts, nts)

  await browser.close()
}

main().catch(e => { console.error("오류:", e.message); process.exit(1) })
