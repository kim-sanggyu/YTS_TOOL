/**
 * 종교 기부금(548-070) 당해+이월의 NTS OUT 분배 확정 프로브.
 * 질문: 국세청이 종교 기부금 세액공제 ddcAmt 를
 *   (A) 각 코드(8746 당해, 8821~8825 이월)별로 쪼개 회신하나,
 *   (B) 당해 8746 한 코드에 몰아 회신(이월 OUT=0)하나?
 *
 * 방법: 종교 이월 보유자 자동선정 → 그 사람 실제 코드별 useAmt(GIFT_ABLE_SUB_AMT) 전송 →
 *       OUT ddcAmt 를 코드별로 출력. 인적공제는 정상값으로 과세표준(8903) 살려 소진 가림 방지.
 *
 * 사용법: node docs/gift-religion-carry-probe.mjs [CALC_NO]   ⚠ 읽기전용 SELECT + NTS 모의계산(비로그인).
 * 인자 생략 시 후보 목록만 출력하고 1등 후보로 진행.
 */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"
import pw       from "../node_modules/playwright/index.js"

const { chromium } = pw
const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const DB_USER = "YTS39", DB_PASS = "Yts391234!"
const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const L03_URL   = "https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEAA001L03&screenId=UTEYSEJF01&popupYn=false&realScreenId="

// 종교(548-070) 이월 코드: diff 1~5 → 8821~8825
const RELIGION_BASE = "8746"
const RELIGION_CARRY = ["8821", "8822", "8823", "8824", "8825"]
function religionCode(diff) {
  if (diff === 0) return RELIGION_BASE
  if (diff >= 1 && diff <= 5) return RELIGION_CARRY[diff - 1]
  return null
}

async function q(sql, params = []) {
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  try { return (await conn.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? [] }
  finally { await conn.close() }
}

// 종교 이월 보유자 후보 — 당해+이월 대상금액이 있고 과세표준 살아있을 만한 사람
async function findCandidates() {
  return q(`
    SELECT * FROM (
      SELECT g.CALC_NO,
             COUNT(*) AS ROWS_CNT,
             SUM(CASE WHEN TO_NUMBER(g.GIFT_YY) < TO_NUMBER(SUBSTR(g.CALC_NO,2,4)) THEN 1 ELSE 0 END) AS CARRY_CNT,
             SUM(NVL(g.GIFT_ABLE_SUB_AMT,0)) AS ABLE_SUM,
             SUM(NVL(g.GIFT_SUB_AMT,0))      AS SUB_SUM
      FROM YTS39.PAY_WRK_GIFT_ADJ g
      WHERE g.GIFT_CLS = '548-070' AND g.GIFT_YY IS NOT NULL
      GROUP BY g.CALC_NO
      HAVING SUM(CASE WHEN TO_NUMBER(g.GIFT_YY) < TO_NUMBER(SUBSTR(g.CALC_NO,2,4)) THEN 1 ELSE 0 END) >= 1
      ORDER BY SUB_SUM DESC
    ) WHERE ROWNUM <= 15`)
}

async function fetchPerson(calcNo) {
  const [c] = await q(`
    SELECT c.CALC_NO, c.TOT_PAY_AMT, c.PAYM_INCM_TAX,
           c.BASC_SUB_MATE_AMT, c.BASC_SUB_FAMILY_CNT,
           NVL(c.RT_PSA_RELGN,0) AS RT_PSA_RELGN
    FROM YTS39.PAY_WRK_CALC c WHERE c.CALC_NO = :1`, [calcNo])
  if (!c) throw new Error(`CALC_NO 없음: ${calcNo}`)
  const gifts = await q(`
    SELECT g.GIFT_YY, NVL(g.GIFT_ABLE_SUB_AMT,0) AS ABLE, NVL(g.GIFT_SUB_AMT,0) AS SUB
    FROM YTS39.PAY_WRK_GIFT_ADJ g
    WHERE g.CALC_NO = :1 AND g.GIFT_CLS = '548-070' AND g.GIFT_YY IS NOT NULL
    ORDER BY g.GIFT_YY DESC`, [calcNo])
  return { c, gifts }
}

function buildBody(person, dataYear, ntsYear) {
  const totPay  = Number(person.c.TOT_PAY_AMT)
  const prepaid = Number(person.c.PAYM_INCM_TAX)
  const detail = new Map()   // code -> {useAmt, incDdcNfpCnt}
  const set = (code, field, val) => {
    if (!val || Number(val) === 0) return
    const it = detail.get(code) ?? { useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0" }
    it[field] = String(val); detail.set(code, it)
  }
  set("8900", "useAmt", totPay)
  set("8991", "useAmt", prepaid)
  set("8001", "incDdcNfpCnt", 1)
  if (Number(person.c.BASC_SUB_MATE_AMT) > 0)   set("8002", "incDdcNfpCnt", 1)
  if (Number(person.c.BASC_SUB_FAMILY_CNT) > 0) set("8003", "incDdcNfpCnt", person.c.BASC_SUB_FAMILY_CNT)

  // 종교 기부금 코드별 대상금액(useAmt) 주입
  const sent = []
  for (const g of person.gifts) {
    const yy = Number(g.GIFT_YY)
    const diff = yy === dataYear ? 0 : ntsYear - yy   // 당해=YTS데이터연도, 이월연차는 NTS 귀속연도 기준(production giftCarryDiff 동형)
    const code = religionCode(diff)
    if (!code) { console.warn(`  ⚠ diff=${diff}(GIFT_YY=${yy}) → 코드매핑 없음, 스킵`); continue }
    set(code, "useAmt", g.ABLE)
    sent.push({ code, giftYy: yy, diff, useAmt: Number(g.ABLE), ytsSub: Number(g.SUB) })
  }

  const detailList = [...detail.entries()].map(([amtClusCd, v]) => ({ amtClusCd, ...v }))
  const body = {
    crdcDdcAmt: "0", smltClcClCd: String(ntsYear), v_saveChk: "Y", v_conbChk: "", yrsSrvcClCd: "",
    pbtAddDdcAmt: "0", pbtDdcAmt: "0", addDdcrtDdcAmt: "0", ddcPsbAmt: "0",
    tdmrAddDdcAmt: "0", lstDdcAmt: "0", tdmrDdcAmt: "0", bppAddDdcAmt: "0",
    gnrlDdcAmt: "0", ddcExclAmt: "0", totaSnwAmt: String(totPay), ddcLmtAmt: "0",
    yrsTaxClcBscList: [{ ppmTxamt: String(prepaid), attrYr: String(ntsYear), ddcRtnId: "", erinAmt: "0", totaSnwAmt: String(totPay), statusValue: "R" }],
    yrsTaxClcDetailDVOList: detailList,
  }
  return { body, sent }
}

function pickAmt(list, code) { const it = list.find(x => String(x.amtClusCd) === code); return it ? Number(it.ddcAmt ?? 0) : null }

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

async function main() {
  oracledb.initOracleClient({ libDir: ORACLE_LIB })

  console.log("=== 종교 이월(548-070) 보유자 후보 (SUB_SUM desc) ===")
  const cands = await findCandidates()
  console.table(cands)
  if (!cands.length) { console.log("후보 없음"); return }

  const calcNo = process.argv[2] || cands[0].CALC_NO
  const dataYear = Number(String(calcNo).substring(1, 5))
  const ntsYear = Number(process.argv[3] || "2025")   // 손택스 모의계산기 존재연도(전환기 X2026→2025)
  console.log(`\n▶ 대상: ${calcNo}  (dataYear=${dataYear}, ntsYear=${ntsYear})`)

  const person = await fetchPerson(calcNo)
  console.log(`  총급여 ${Number(person.c.TOT_PAY_AMT).toLocaleString()} · 기납부 ${Number(person.c.PAYM_INCM_TAX).toLocaleString()} · 부양 ${person.c.BASC_SUB_FAMILY_CNT}명 · YTS 종교공제(RT_PSA_RELGN) ${Number(person.c.RT_PSA_RELGN).toLocaleString()}`)
  console.log("  종교 기부금 행:")
  console.table(person.gifts.map(g => ({ GIFT_YY: g.GIFT_YY, 대상금액: Number(g.ABLE), YTS공제: Number(g.SUB) })))

  const { body, sent } = buildBody(person, dataYear, ntsYear)
  console.log("\n  전송 종교 코드:")
  console.table(sent)

  // NTS 세션 수립 (headed) 후 L03 직접 POST
  console.log("\n국세청 접속(headed)…")
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  page.on("dialog", d => d.accept().catch(() => {}))
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
  console.log("세션 수립 완료. L03 전송…")

  const raw = await page.evaluate(async ({ url, body }) => {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json;charset=UTF-8" }, body, credentials: "include" })
      return await res.text()
    } catch (e) { return JSON.stringify({ error: e.message }) }
  }, { url: L03_URL, body: JSON.stringify(body) })

  // 진단: 응답 유효성 확인
  console.log(`\n[진단] 응답 길이 ${raw.length}`)
  let parsed = null
  try { parsed = JSON.parse(raw) } catch { console.error("JSON 파싱실패. 원본 앞부분:\n", raw.slice(0, 600)); await browser.close(); return }
  console.log("[진단] resultMsg:", JSON.stringify(parsed.resultMsg ?? parsed.error ?? "(없음)"))
  const list = parsed.yrsTaxClcDetailDVOList ?? []
  console.log(`[진단] detail 코드 수 ${list.length}`)
  const nonzero = list.filter(x => Number(x.ddcAmt ?? 0) !== 0).map(x => `${x.amtClusCd}:${x.ddcAmt}`)
  console.log(`[진단] ddcAmt≠0 코드(${nonzero.length}): ${nonzero.slice(0, 40).join(", ")}`)
  if (list.length === 0) { console.error("→ 계산 응답 비어있음(세션 미수립 추정). 종료."); await browser.close(); return }

  console.log("\n=== NTS OUT (종교 코드별 ddcAmt) ===")
  const outRows = [{ code: "8746", name: "종교 당해" }, ...RELIGION_CARRY.map((c, i) => ({ code: c, name: `종교 이월 -${i + 1}년` }))]
    .map(r => {
      const s = sent.find(x => x.code === r.code)
      return { 코드: r.code, 항목: r.name, IN_useAmt: s ? s.useAmt : 0, YTS공제: s ? s.ytsSub : 0, NTS_OUT_ddcAmt: pickAmt(list, r.code) ?? 0 }
    })
  console.table(outRows)

  console.log("\n=== 계/참고 코드 ===")
  console.table([
    { 코드: "8922", 항목: "특별세액공제계", ddcAmt: pickAmt(list, "8922") },
    { 코드: "8923", 항목: "세액공제계",     ddcAmt: pickAmt(list, "8923") },
    { 코드: "8903", 항목: "과세표준",       ddcAmt: pickAmt(list, "8903") },
    { 코드: "8990", 항목: "산출세액",       ddcAmt: pickAmt(list, "8990") },
    { 코드: "8999", 항목: "결정세액",       ddcAmt: pickAmt(list, "8999") },
  ])

  const carrySum = outRows.filter(r => r.코드 !== "8746").reduce((a, r) => a + r.NTS_OUT_ddcAmt, 0)
  const base = outRows.find(r => r.코드 === "8746")?.NTS_OUT_ddcAmt ?? 0
  console.log(`\n판정: 당해8746 OUT=${base.toLocaleString()} · 이월합 OUT=${carrySum.toLocaleString()}`)
  console.log(carrySum > 0 ? "→ (A) 코드별 분배: 이월 코드에도 OUT 회신됨" : "→ (B) 당해 몰기: 이월 OUT=0, 8746에 합산 추정")

  await browser.close()
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
