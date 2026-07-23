/**
 * 홈택스 모의계산 — 부양가족 "유형별 vs 통합" 전송 실측 프로브
 *
 * 목적(상규님 가설 검증 2026-07-23):
 *   H1) 부양가족 기본공제는 유형과 무관(1인 150만 동일) → 통합으로 몰아 보내도 과세표준 동일한가?
 *   H2) 자녀세액공제(8763)는 직계비속(8005) 인원에 의존하는가? (8005=0이면 8763=0?)
 *
 * 방법: 한 사람당 4발 발사 후 대조.
 *   S0 baseline  : 총급여 + 기납부만
 *   S1 typed     : 현행(유형별 8004~8009 정확) + 공통(본인·배우자·추가공제·자녀총인원 8763)
 *   S2 lump→8005 : 부양가족 전원을 8005 하나에 몰기 + 공통      → H1 (과세표준이 typed와 같나)
 *   S3 lump→8004 : 부양가족 전원을 8004(직계존속), 8005=0 + 공통 → H2 (8763 자녀공제 살아있나)
 *   ※ S1~S3 은 부양가족 배치만 다르고 나머지(본인·배우자·추가공제·자녀총인원)는 고정 → 차이는 배치에서만.
 *
 * 판정:
 *   H1 확정 = S1.과세표준(8903) === S2.과세표준(8903)  (유형 무관 → 통합 가능)
 *   H2 확정 = S3.자녀공제(8763) === 0 (또는 S1 대비 하락)  (8005 의존 → 유형 필요)
 *
 * 사용법:
 *   node docs/hometax-family-lump-probe.mjs            → X2026 접두, 자동 3명(직계비속+자녀공제 보유, 유형 다양)
 *   node docs/hometax-family-lump-probe.mjs X2026 5    → 접두 + 건수
 *   node docs/hometax-family-lump-probe.mjs X202600123 → 특정 CALC_NO
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
const limit  = Number(arg2) || 3

// ── Oracle ───────────────────────────────────────────────────────────────────
async function dbQuery(sql, params = []) {
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  try {
    const r = await conn.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT })
    return r.rows ?? []
  } finally { await conn.close() }
}

// 직계비속(550-050) 보유 + 자녀세액공제(RT_HWC_CNT>0) + 부양가족 유형 다양 우선
async function pickTargets() {
  if (specificCalcNo) return [specificCalcNo]
  const rows = await dbQuery(`
    SELECT CALC_NO FROM (
      SELECT c.CALC_NO,
        (SELECT COUNT(DISTINCT f.FMLY_RELN) FROM YTS39.PAY_WRK_FMLY f
           WHERE f.CALC_NO = c.CALC_NO AND f.BAS_SUB_YN = 'Y'
             AND f.FMLY_RELN IN ('550-020','550-030','550-050','550-055','550-060','550-070','550-080')) AS RELN_KINDS,
        (SELECT COUNT(*) FROM YTS39.PAY_WRK_FMLY f
           WHERE f.CALC_NO = c.CALC_NO AND f.BAS_SUB_YN = 'Y' AND f.FMLY_RELN = '550-050') AS BISOK,
        NVL(c.BASC_SUB_FAMILY_CNT, 0) AS FAM_CNT
      FROM YTS39.PAY_WRK_CALC c
      WHERE c.CALC_NO LIKE '${prefix}%'
        AND NVL(c.RT_HWC_CNT, 0) > 0
        AND NVL(c.BASC_SUB_FAMILY_CNT, 0) >= 2
    )
    WHERE BISOK > 0 AND RELN_KINDS >= 2
    ORDER BY RELN_KINDS DESC, FAM_CNT DESC
  `)
  return rows.slice(0, limit).map(r => r.CALC_NO)
}

async function fetchYts(calcNo) {
  const rows = await dbQuery(`
    SELECT c.CALC_NO,
      c.TOT_PAY_AMT, c.PAYM_INCM_TAX, c.RES_INCM_TAX,
      NVL(c.BASC_SUB_SELF_AMT, 0)      AS BASC_SUB_SELF_AMT,
      NVL(c.BASC_SUB_MATE_AMT, 0)      AS BASC_SUB_MATE_AMT,
      NVL(c.BASC_SUB_FAMILY_CNT, 0)    AS BASC_SUB_FAMILY_CNT,
      NVL(c.BASC_SUB_FAMILY_AMT, 0)    AS BASC_SUB_FAMILY_AMT,
      NVL(c.ADD_SUB_OAT_CNT, 0)        AS ADD_SUB_OAT_CNT,
      NVL(c.ADD_SUB_HDC_PERS_CNT, 0)   AS ADD_SUB_HDC_PERS_CNT,
      NVL(c.ADD_SUB_LADY_AMT, 0)       AS ADD_SUB_LADY_AMT,
      NVL(c.ADD_SUB_SNGL_PRNT_AMT, 0)  AS ADD_SUB_SNGL_PRNT_AMT,
      NVL(c.RT_HWC_CNT, 0)             AS RT_HWC_CNT,
      NVL(c.RT_HWC_AMT, 0)             AS RT_HWC_AMT
    FROM YTS39.PAY_WRK_CALC c
    WHERE c.CALC_NO = :1
  `, [calcNo])
  if (!rows.length) throw new Error(`CALC_NO 없음: ${calcNo}`)
  return rows[0]
}

// 부양가족 유형별(8004~09) 집계 — runCompareForCalcNo.injectFamilyVals 복제 (BAS_SUB_YN='Y')
async function fetchFamily(calcNo) {
  const rows = await dbQuery(`
    SELECT
      SUM(CASE WHEN FMLY_RELN IN ('550-020','550-030') THEN 1 ELSE 0 END) AS FAM_8004,
      SUM(CASE WHEN FMLY_RELN = '550-050' THEN 1 ELSE 0 END) AS FAM_8005,
      SUM(CASE WHEN FMLY_RELN = '550-055' THEN 1 ELSE 0 END) AS FAM_8006,
      SUM(CASE WHEN FMLY_RELN = '550-060' THEN 1 ELSE 0 END) AS FAM_8007,
      SUM(CASE WHEN FMLY_RELN = '550-070' THEN 1 ELSE 0 END) AS FAM_8008,
      SUM(CASE WHEN FMLY_RELN = '550-080' THEN 1 ELSE 0 END) AS FAM_8009
    FROM YTS39.PAY_WRK_FMLY
    WHERE CALC_NO = :1 AND BAS_SUB_YN = 'Y'
  `, [calcNo])
  return rows[0] ?? {}
}

const FAMILY_CODES = ["8004", "8005", "8006", "8007", "8008", "8009"]

// ── L03 body ─────────────────────────────────────────────────────────────────
const ALL_CODES = [
  "8900","8991",
  "8001","8002","8004","8005","8006","8007","8008","8009","8101","8102","8103","8104",
  "8763",
  "8901","8902","8903","8916","8923","8990","8992","8998","8999",
]

function baseDetail() {
  return ALL_CODES.map(code => ({
    amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0",
  }))
}

// strategy: "baseline" | "typed" | "lump8005" | "lump8004"
function buildBody(d, f, strategy) {
  const totPay  = Number(d.TOT_PAY_AMT)
  const prepaid = Number(d.PAYM_INCM_TAX)
  const detail  = baseDetail()
  const set = (code, field, val) => {
    if (!val || Number(val) === 0) return
    const item = detail.find(it => it.amtClusCd === code)
    if (item) item[field] = String(val)
  }

  set("8900", "useAmt", totPay)
  set("8991", "useAmt", prepaid)

  if (strategy !== "baseline") {
    // 공통 (모든 전송 전략 공유) — 본인·배우자·추가공제·자녀총인원
    set("8001", "incDdcNfpCnt", 1)
    if (Number(d.BASC_SUB_MATE_AMT) > 0) set("8002", "incDdcNfpCnt", 1)
    set("8101", "incDdcNfpCnt", d.ADD_SUB_OAT_CNT)
    set("8102", "incDdcNfpCnt", d.ADD_SUB_HDC_PERS_CNT)
    if (Number(d.ADD_SUB_LADY_AMT)      > 0) set("8103", "incDdcNfpCnt", 1)
    if (Number(d.ADD_SUB_SNGL_PRNT_AMT) > 0) set("8104", "incDdcNfpCnt", 1)
    set("8763", "incDdcNfpCnt", d.RT_HWC_CNT)   // 자녀세액공제 총인원

    // 부양가족 배치 — 여기만 전략별로 다름
    const famTotal = FAMILY_CODES.reduce((s, c) => s + Number(f[`FAM_${c}`] || 0), 0)
    if (strategy === "typed") {
      for (const code of FAMILY_CODES) set(code, "incDdcNfpCnt", f[`FAM_${code}`])
    } else if (strategy === "lump8005") {
      set("8005", "incDdcNfpCnt", famTotal)   // 전원 직계비속에
    } else if (strategy === "lump8004") {
      set("8004", "incDdcNfpCnt", famTotal)   // 전원 직계존속에 (8005=0)
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

// ── 출력 ─────────────────────────────────────────────────────────────────────
function printHead(calcNo, d, f) {
  console.log(`\n══════════════════════════════════════════════════════`)
  console.log(`▶ ${calcNo}  총급여 ${fmt(d.TOT_PAY_AMT)}`)
  console.log(`  [YTS] 부양가족 ${fmt(d.BASC_SUB_FAMILY_AMT)}(${fmt(d.BASC_SUB_FAMILY_CNT)}명)`
            + ` / 자녀세액공제 ${fmt(d.RT_HWC_AMT)}(${fmt(d.RT_HWC_CNT)}명)`)
  console.log(`  [FMLY 유형별] ${FAMILY_CODES.map(c => `${c}:${f[`FAM_${c}`] ?? 0}`).join("  ")}`
            + `  (직계비속 8005=${f.FAM_8005 ?? 0})`)
}

async function runOne(page, calcNo) {
  const d = await fetchYts(calcNo)
  const f = await fetchFamily(calcNo)
  printHead(calcNo, d, f)

  const strategies = ["baseline", "typed", "lump8005", "lump8004"]
  const out = {}
  for (const s of strategies) {
    const raw = await postL03(page, buildBody(d, f, s))
    await page.waitForTimeout(500)
    out[s] = { map: toMap(raw), rc: resultCode(raw) }
  }

  // 요약표
  const pad = (s, n) => String(s).padStart(n)
  console.log(`  ┌ 전략         result   과세표준(8903)   차감소득(8916)   자녀공제(8763)   부양가족합(8004~09 OUT)`)
  for (const s of strategies) {
    const m = out[s].map
    const famSum = FAMILY_CODES.reduce((acc, c) => acc + (m[c] ?? 0), 0)
    console.log(`  │ ${s.padEnd(10)}  ${out[s].rc.padEnd(6)}  ${pad(fmt(m["8903"]), 14)}   ${pad(fmt(m["8916"]), 14)}   ${pad(fmt(m["8763"]), 14)}   ${pad(fmt(famSum), 14)}`)
  }

  // 판정
  const t = out.typed.map, l5 = out.lump8005.map, l4 = out.lump8004.map
  const h1 = (t["8903"] ?? null) !== null && t["8903"] === l5["8903"]
  const h2Child = t["8763"] ?? 0
  const h2Lump4 = l4["8763"] ?? 0
  console.log(`  ├ H1 기본공제 유형무관: typed.과세표준 ${fmt(t["8903"])} ${h1 ? "===" : "≠"} lump8005.과세표준 ${fmt(l5["8903"])}  ⇒ ${h1 ? "✅ 통합 가능(유형 무관)" : "❌ 유형별 차이 있음"}`)
  console.log(`  └ H2 자녀공제 8005의존: typed.자녀 ${fmt(h2Child)} → lump8004(8005=0).자녀 ${fmt(h2Lump4)}  ⇒ ${h2Lump4 === 0 && h2Child > 0 ? "✅ 8005 필요(0으로 떨어짐)" : h2Lump4 === h2Child ? "❌ 8005 불필요(총인원만으로 산출)" : "⚠ 부분변화·확인요"}`)
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("[1] Oracle 연결...")
  oracledb.initOracleClient({ libDir: ORACLE_LIB })
  oracledb.fetchAsString = [oracledb.CLOB]

  const targets = await pickTargets()
  if (!targets.length) { console.error("대상 없음 (직계비속+자녀공제+유형2종 미발견)"); process.exit(1) }
  console.log(`    대상 ${targets.length}명: ${targets.join(", ")}`)

  console.log("[2] 국세청 세션 수립... (headed 필수)")
  const browser = await chromium.launch({ headless: false })
  const ctx     = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page    = await ctx.newPage()
  page.on("dialog", dlg => dlg.accept().catch(() => {}))
  await establishSession(page)
  console.log("    세션 완료")

  for (const calcNo of targets) {
    try { await runOne(page, calcNo) } catch (e) { console.error(`  ${calcNo} 오류:`, e.message) }
  }

  await browser.close()
  console.log("\n완료.")
}

main().catch(e => { console.error("오류:", e.message); process.exit(1) })
