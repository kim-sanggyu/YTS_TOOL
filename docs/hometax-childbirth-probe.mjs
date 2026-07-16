/**
 * 홈택스 모의계산 — 자녀(8763)·출산입양(8761) "총인원 전송" 잉여 여부 실측 프로브
 *
 * 질문(상규님): 8764/8765/8766(순번별) + 8004~8009(유형별)를 보내 국세청이 8761/8763을
 *   자동산출한다면, 8761/8763에 "총인원(RT_PER_CHI_CNT / RT_HWC_CNT)"을 또 보내는 것은 잉여인가?
 *
 * 논리적 추정: 출산공제는 순번(첫째30/둘째50/셋째70만)에 따라 금액이 갈리므로,
 *   "총인원 N명" 하나만으론 금액을 산출할 수 없다 → 8764~66이 진짜 드라이버,
 *   8761 총인원 전송은 국세청이 무시(잉여)일 개연성 큼. 자녀(8763)도 동형.
 *
 * 방법: 대상자마다 3발 발사 후 8761/8763 ddcAmt 와 결정세액(8998/8999) 비교.
 *   A) 현행     : 8004~09(유형별) + 8764~66(순번별) + 8761/8763(총인원 count)
 *   B) 총인원제거: 8004~09 + 8764~66            (8761/8763 count 미전송)
 *   C) 순번제거  : 8761/8763(총인원 count)만     (8004~09·8764~66 미전송)
 *
 *   판정:
 *     A==B (8761/8763 동일) → 총인원 전송은 잉여(제거해도 무해) ✅ 추정 확정
 *     A!=B                  → 총인원이 결과에 영향 → 유지 필요
 *     C 가 0 또는 오답      → 순번별이 진짜 드라이버(총인원만으론 산출 불가)
 *
 * 사용법:
 *   node docs/hometax-childbirth-probe.mjs            → 출산입양 발생자 자동 4명(X2026)
 *   node docs/hometax-childbirth-probe.mjs X2026 6    → 접두 + 건수
 *   node docs/hometax-childbirth-probe.mjs X202600123 → 특정 CALC_NO
 *
 * ⚠ 읽기 전용(DB SELECT + NTS 조회). 저장 없음. eversafe 때문에 headed 필수(실제 Chrome 창).
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

// ── 인자 ─────────────────────────────────────────────────────────────────────
const arg1 = process.argv[2]
const arg2 = process.argv[3]
const specificCalcNo = arg1 && /^X\d{9,}$/.test(arg1) ? arg1 : null
const prefix = arg1 && !specificCalcNo ? arg1 : "X2026"
const limit  = Number(arg2) || 4

// ── Oracle ───────────────────────────────────────────────────────────────────
async function dbQuery(sql, params = []) {
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  try {
    const r = await conn.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT })
    return r.rows ?? []
  } finally { await conn.close() }
}

// arg1 == "CHILD" → 자녀공제(8763) 발생자 대상(8763 대칭 확인용). 그 외 → 출산입양(8761) 발생자.
const childMode = arg1 === "CHILD"
async function pickTargets() {
  if (specificCalcNo) return [specificCalcNo]
  const filterCol = childMode ? "RT_HWC_AMT" : "RT_PER_CHI_AMT"
  const orderCol  = childMode ? "RT_HWC_CNT"  : "RT_PER_CHI_CNT"
  const rows = await dbQuery(`
    SELECT CALC_NO FROM (
      SELECT c.CALC_NO
      FROM YTS39.PAY_WRK_CALC c
      WHERE c.CALC_NO LIKE 'X2026%'
        AND NVL(c.${filterCol}, 0) > 0
      ORDER BY NVL(c.${orderCol}, 0) DESC, NVL(c.${filterCol}, 0) DESC
    ) WHERE ROWNUM <= :1
  `, [limit])
  return rows.map(r => r.CALC_NO)
}

async function fetchYts(calcNo) {
  const rows = await dbQuery(`
    SELECT c.CALC_NO,
      c.TOT_PAY_AMT, c.PAYM_INCM_TAX, c.PROD_TAX_AMT, c.RES_INCM_TAX, c.SUB_INCM_TAX,
      c.BASC_SUB_MATE_AMT,
      c.ADD_SUB_OAT_CNT, c.ADD_SUB_HDC_PERS_CNT, c.ADD_SUB_LADY_AMT, c.ADD_SUB_SNGL_PRNT_AMT,
      c.NP_INSU_AMT, c.SPCL_IF_HLTH_INSU_AMT, c.SPCL_IF_EMP_INSU_AMT,
      NVL(c.RT_HWC_CNT, 0)      AS RT_HWC_CNT,
      NVL(c.RT_HWC_AMT, 0)      AS RT_HWC_AMT,
      NVL(c.RT_PER_CHI_CNT, 0)  AS RT_PER_CHI_CNT,
      NVL(c.RT_PER_CHI_AMT, 0)  AS RT_PER_CHI_AMT
    FROM YTS39.PAY_WRK_CALC c
    WHERE c.CALC_NO = :1
  `, [calcNo])
  if (!rows.length) throw new Error(`CALC_NO 없음: ${calcNo}`)
  return rows[0]
}

// 부양가족 유형별(8004~09) + 출산입양 순번별(8764~66) 집계 — runCompareForCalcNo.injectFamilyVals 복제
async function fetchFamily(calcNo) {
  const rows = await dbQuery(`
    SELECT
      SUM(CASE WHEN FMLY_RELN IN ('550-020','550-030') THEN 1 ELSE 0 END) AS FAM_8004,
      SUM(CASE WHEN FMLY_RELN = '550-050' THEN 1 ELSE 0 END) AS FAM_8005,
      SUM(CASE WHEN FMLY_RELN = '550-055' THEN 1 ELSE 0 END) AS FAM_8006,
      SUM(CASE WHEN FMLY_RELN = '550-060' THEN 1 ELSE 0 END) AS FAM_8007,
      SUM(CASE WHEN FMLY_RELN = '550-070' THEN 1 ELSE 0 END) AS FAM_8008,
      SUM(CASE WHEN FMLY_RELN = '550-080' THEN 1 ELSE 0 END) AS FAM_8009,
      SUM(CASE WHEN PER_CHI_YN = '3' AND FMLY_RELN = '550-050' THEN 1 ELSE 0 END) AS FAM_8764,
      SUM(CASE WHEN PER_CHI_YN = '5' AND FMLY_RELN = '550-050' THEN 1 ELSE 0 END) AS FAM_8765,
      SUM(CASE WHEN PER_CHI_YN = '7' AND FMLY_RELN = '550-050' THEN 1 ELSE 0 END) AS FAM_8766
    FROM YTS39.PAY_WRK_FMLY
    WHERE CALC_NO = :1 AND BAS_SUB_YN = 'Y'
  `, [calcNo])
  return rows[0] ?? {}
}

// ── L03 body ─────────────────────────────────────────────────────────────────
const ALL_CODES = [
  "8900","8991",
  "8001","8002","8004","8005","8006","8007","8008","8009","8101","8102","8103","8104",
  "8201","8301","8305",
  "8761","8763","8764","8765","8766",
  "8901","8902","8903","8923","8990","8992","8998","8999",
]

function baseDetail() {
  return ALL_CODES.map(code => ({
    amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0",
  }))
}

// strategy: "A"(현행) | "B"(총인원제거) | "C"(순번제거)
function buildBody(d, f, strategy) {
  const totPay  = Number(d.TOT_PAY_AMT)
  const prepaid = Number(d.PAYM_INCM_TAX)
  const detail  = baseDetail()
  const set = (code, field, val) => {
    if (!val || Number(val) === 0) return
    const item = detail.find(it => it.amtClusCd === code)
    if (item) item[field] = String(val)
  }

  // 공통(모든 전략): 소득·기본 인적공제
  set("8900", "useAmt", totPay)
  set("8991", "useAmt", prepaid)
  set("8001", "incDdcNfpCnt", 1)
  if (Number(d.BASC_SUB_MATE_AMT) > 0) set("8002", "incDdcNfpCnt", 1)
  set("8101", "incDdcNfpCnt", d.ADD_SUB_OAT_CNT)
  set("8102", "incDdcNfpCnt", d.ADD_SUB_HDC_PERS_CNT)
  if (Number(d.ADD_SUB_LADY_AMT)      > 0) set("8103", "incDdcNfpCnt", 1)
  if (Number(d.ADD_SUB_SNGL_PRNT_AMT) > 0) set("8104", "incDdcNfpCnt", 1)
  set("8201", "useAmt", d.NP_INSU_AMT)
  set("8301", "useAmt", d.SPCL_IF_HLTH_INSU_AMT)
  set("8305", "useAmt", d.SPCL_IF_EMP_INSU_AMT)

  // 부양가족 유형별(8004~09) + 순번별(8764~66) — A/B 만
  if (strategy === "A" || strategy === "B") {
    for (const code of ["8004","8005","8006","8007","8008","8009","8764","8765","8766"]) {
      set(code, "incDdcNfpCnt", f[`FAM_${code}`])
    }
  }
  // 총인원 count(8761/8763) — A/C 만
  if (strategy === "A" || strategy === "C") {
    set("8763", "incDdcNfpCnt", d.RT_HWC_CNT)
    set("8761", "incDdcNfpCnt", d.RT_PER_CHI_CNT)
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
function printHead(calcNo, d, f) {
  console.log(`\n══════════════════════════════════════════════════════`)
  console.log(`▶ ${calcNo}  총급여 ${fmt(d.TOT_PAY_AMT)}`)
  console.log(`  [YTS 정답]  자녀(8763) 인원 ${fmt(d.RT_HWC_CNT)} → 공제 ${fmt(d.RT_HWC_AMT)}` +
              `   /  출산입양(8761) 인원 ${fmt(d.RT_PER_CHI_CNT)} → 공제 ${fmt(d.RT_PER_CHI_AMT)}`)
  console.log(`  [FMLY 집계] 8004~09 = ${["8004","8005","8006","8007","8008","8009"].map(c => f[`FAM_${c}`] ?? 0).join("/")}` +
              `   순번 8764/8765/8766(첫/둘/셋) = ${f.FAM_8764 ?? 0}/${f.FAM_8765 ?? 0}/${f.FAM_8766 ?? 0}`)
  console.log(`──────────────────────────────────────────────────────`)
  console.log(`  전략         │ NTS 8763(자녀) │ NTS 8761(출산) │ 결정세액(8998) │ 차감(8999)`)
}

function printRow(tag, m) {
  const c = s => fmt(s).padStart(13)
  console.log(`  ${tag.padEnd(12)}│ ${c(m["8763"])} │ ${c(m["8761"])} │ ${c(m["8998"])} │ ${c(m["8999"])}`)
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
  if (!targets.length) { console.error("대상 없음 (출산입양 발생 건 미발견)"); process.exit(1) }
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
    const f = await fetchFamily(calcNo)
    printHead(calcNo, d, f)

    const aRaw = await postL03(page, buildBody(d, f, "A")); await page.waitForTimeout(400)
    const bRaw = await postL03(page, buildBody(d, f, "B")); await page.waitForTimeout(400)
    const cRaw = await postL03(page, buildBody(d, f, "C")); await page.waitForTimeout(400)

    const a = toMap(aRaw), b = toMap(bRaw), c = toMap(cRaw)
    printRow("A 현행", a)
    printRow("B 총인원제거", b)
    printRow("C 순번제거", c)

    // 판정
    const ab8761 = (a["8761"] ?? 0) === (b["8761"] ?? 0)
    const ab8763 = (a["8763"] ?? 0) === (b["8763"] ?? 0)
    const ab999  = (a["8999"] ?? 0) === (b["8999"] ?? 0)
    console.log(`    (응답 A=${resultCode(aRaw)} B=${resultCode(bRaw)} C=${resultCode(cRaw)})`)
    console.log(`    ⇒ A==B : 8761 ${ab8761 ? "✅" : "❌"} / 8763 ${ab8763 ? "✅" : "❌"} / 결정세액 ${ab999 ? "✅" : "❌"}` +
                `   ${ab8761 && ab8763 && ab999 ? "→ 총인원 전송 잉여(제거해도 무해)" : "→ 총인원이 영향! 유지 필요"}`)
    const cMatch = (c["8761"] ?? 0) === Number(d.RT_PER_CHI_AMT)
    console.log(`    ⇒ C(순번없이 총인원만): NTS 8761 = ${fmt(c["8761"])} vs YTS ${fmt(d.RT_PER_CHI_AMT)}  ${cMatch ? "✅ 총인원만으로도 산출됨" : "❌ 순번별이 드라이버"}`)
  }

  await browser.close()
  console.log("\n완료.")
}

main().catch(e => { console.error("오류:", e.message); process.exit(1) })
