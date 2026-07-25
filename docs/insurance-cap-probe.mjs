/**
 * 보장성보험료 원본전송 구분 프로브 — 국세청이 100만 한도를 self로 cap하는가(A) vs ddcLmtAmt 의존(B)?
 *
 * 배경: hometax-insurance-probe 는 useAmt 에 SPCL_IF_*(이미 100만 capped)를 보낸다. 라이브 UI 캡처는
 *   useAmt(원본)+ddcLmtAmt(=100만×율)를 함께 보내 cap 되나, 우리 전송(buildCompareBody)은 useAmt 만·ddcLmtAmt=0.
 *   → 원본(FMLY_DTL 합)을 useAmt 로, ddcLmtAmt=0 으로 쏴서:
 *      (A) OUT == RT_*(=min(원본,100만)×율)  → 국세청 자체 100만 cap. 원본전송 안전.
 *      (B) OUT == 원본×율(cap 안됨)          → ddcLmtAmt 의존. 원본전송 위험(과다공제).
 *
 * 방법: 원본>100만(cap 걸린) 대상 자동선택. 사람마다 none/grt(원본)/hdc(원본)/both 발사 후 OUT 대조.
 * 사용법: node docs/insurance-cap-probe.mjs   ⚠ 읽기전용. headed 필수(실제 Chrome 창).
 */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"
import pw       from "../node_modules/playwright/index.js"

const { chromium } = pw
const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const DB_USER = "YTS39", DB_PASS = "Yts391234!"
const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const L03_URL   = "https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEAA001L03&screenId=UTEYSEJF01&popupYn=false&realScreenId="
const ATTR_YR   = "2025"

async function dbQuery(sql, params = []) {
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  try { return (await conn.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? [] }
  finally { await conn.close() }
}

// 원본(FMLY_DTL 합) > 100만 인 cap 대상: 8710 고액 2명 + 8711 cap 2명
async function pickTargets() {
  const grt = await dbQuery(`SELECT CALC_NO FROM (
    SELECT c.CALC_NO, (SELECT NVL(SUM(GRT_INSU),0) FROM YTS39.PAY_WRK_FMLY_DTL d WHERE d.CALC_NO=c.CALC_NO) SRC
    FROM YTS39.PAY_WRK_CALC c JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO=c.CALC_NO
    WHERE m.YY='2025' AND NVL(c.SPCL_IF_GRT_INSU_AMT,0)>=1000000
    ORDER BY SRC DESC) WHERE ROWNUM<=2`)
  const hdc = await dbQuery(`SELECT CALC_NO FROM (
    SELECT c.CALC_NO, (SELECT NVL(SUM(HDC_PERS_INSU),0) FROM YTS39.PAY_WRK_FMLY_DTL d WHERE d.CALC_NO=c.CALC_NO) SRC
    FROM YTS39.PAY_WRK_CALC c JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO=c.CALC_NO
    WHERE m.YY='2025' AND NVL(c.SPCL_IF_HDC_PERS_INSU_AMT,0)>=1000000
    ORDER BY SRC DESC) WHERE ROWNUM<=2`)
  return [...grt.map(r => r.CALC_NO), ...hdc.map(r => r.CALC_NO)]
}

async function fetchYts(calcNo) {
  const [r] = await dbQuery(`
    SELECT c.CALC_NO, c.TOT_PAY_AMT, c.PAYM_INCM_TAX,
      c.BASC_SUB_MATE_AMT, c.BASC_SUB_FAMILY_CNT,
      c.ADD_SUB_OAT_CNT, c.ADD_SUB_HDC_PERS_CNT, c.ADD_SUB_LADY_AMT, c.ADD_SUB_SNGL_PRNT_AMT,
      c.NP_INSU_AMT, c.SPCL_IF_HLTH_INSU_AMT, c.SPCL_IF_EMP_INSU_AMT,
      (SELECT NVL(SUM(GRT_INSU),0)     FROM YTS39.PAY_WRK_FMLY_DTL d WHERE d.CALC_NO=c.CALC_NO) AS SRC_GRT,
      (SELECT NVL(SUM(HDC_PERS_INSU),0) FROM YTS39.PAY_WRK_FMLY_DTL d WHERE d.CALC_NO=c.CALC_NO) AS SRC_HDC,
      NVL(c.SPCL_IF_GRT_INSU_AMT,0)      AS OBJ_GRT,  NVL(c.RT_IF_GRT_INSU_AMT,0)      AS RT_GRT,
      NVL(c.SPCL_IF_HDC_PERS_INSU_AMT,0) AS OBJ_HDC,  NVL(c.RT_IF_HDC_PERS_INSU_AMT,0) AS RT_HDC,
      c.EXHAUSTED_POINT
    FROM YTS39.PAY_WRK_CALC c WHERE c.CALC_NO = :1`, [calcNo])
  if (!r) throw new Error(`CALC_NO 없음: ${calcNo}`)
  return r
}

const ALL_CODES = ["8900","8991","8001","8002","8003","8101","8102","8103","8104","8201","8301","8305","8710","8711","8901","8902","8903","8923","8990","8992","8998","8999"]
const baseDetail = () => ALL_CODES.map(code => ({ amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0" }))

function buildBody(d, strategy) {
  const totPay = Number(d.TOT_PAY_AMT), prepaid = Number(d.PAYM_INCM_TAX)
  const detail = baseDetail()
  const set = (code, field, val) => { if (!val || Number(val) === 0) return; const it = detail.find(x => x.amtClusCd === code); if (it) it[field] = String(val) }
  set("8900","useAmt",totPay); set("8991","useAmt",prepaid); set("8001","incDdcNfpCnt",1)
  if (Number(d.BASC_SUB_MATE_AMT)>0) set("8002","incDdcNfpCnt",1)
  if (Number(d.BASC_SUB_FAMILY_CNT)>0) set("8003","incDdcNfpCnt",d.BASC_SUB_FAMILY_CNT)
  set("8101","incDdcNfpCnt",d.ADD_SUB_OAT_CNT); set("8102","incDdcNfpCnt",d.ADD_SUB_HDC_PERS_CNT)
  if (Number(d.ADD_SUB_LADY_AMT)>0) set("8103","incDdcNfpCnt",1)
  if (Number(d.ADD_SUB_SNGL_PRNT_AMT)>0) set("8104","incDdcNfpCnt",1)
  set("8201","useAmt",d.NP_INSU_AMT); set("8301","useAmt",d.SPCL_IF_HLTH_INSU_AMT); set("8305","useAmt",d.SPCL_IF_EMP_INSU_AMT)
  // ★핵심: 원본(FMLY_DTL 합)을 useAmt 로, ddcLmtAmt 는 0(=우리 전송형태)
  if (strategy === "grt" || strategy === "both") set("8710","useAmt",d.SRC_GRT)
  if (strategy === "hdc" || strategy === "both") set("8711","useAmt",d.SRC_HDC)
  return {
    crdcDdcAmt:"0", smltClcClCd:ATTR_YR, v_saveChk:"Y", v_conbChk:"", yrsSrvcClCd:"",
    pbtAddDdcAmt:"0", pbtDdcAmt:"0", addDdcrtDdcAmt:"0", ddcPsbAmt:"0",
    tdmrAddDdcAmt:"0", lstDdcAmt:"0", tdmrDdcAmt:"0", bppAddDdcAmt:"0", gnrlDdcAmt:"0", ddcExclAmt:"0",
    totaSnwAmt:String(totPay), ddcLmtAmt:"0",
    yrsTaxClcBscList:[{ ppmTxamt:String(prepaid), attrYr:ATTR_YR, ddcRtnId:"", erinAmt:"0", totaSnwAmt:String(totPay), statusValue:"R" }],
    yrsTaxClcDetailDVOList: detail,
  }
}

function toMap(raw) { const m = {}; try { for (const it of (JSON.parse(raw).yrsTaxClcDetailDVOList ?? [])) m[String(it.amtClusCd)] = Number(it.ddcAmt ?? 0) } catch {} return m }
const fmt = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"))

async function clickText(page, text, preferRight = false) {
  for (const f of page.frames()) {
    try {
      const ok = await f.evaluate(({ t, pr }) => {
        let els = Array.from(document.querySelectorAll("a,button,input,li,span,div")).filter(e => (e.offsetWidth || e.offsetHeight) && (e.textContent || e.value || "").trim() === t)
        if (pr) els = els.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)
        if (els[0]) { els[0].click(); return true }; return false
      }, { t: text, pr: preferRight })
      if (ok) return
    } catch {}
  }
}
async function establishSession(page) {
  await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(7000); await clickText(page, "모의계산", true); await page.waitForTimeout(6000)
  try { await page.getByText("연말정산 자동계산하기", { exact: true }).first().click({ timeout: 8000 }) } catch {}
  await page.waitForTimeout(2000)
  await page.evaluate(() => { const els = Array.from(document.querySelectorAll('[id="a_1905120000"]')); const vis = els.filter(e => e.offsetParent !== null); (vis[0] || els[0])?.click() })
  await page.waitForTimeout(9000)
}
async function postL03(page, body) {
  return page.evaluate(async ({ url, bodyStr }) => {
    try { const res = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json;charset=UTF-8" }, body: bodyStr, credentials:"include" }); return await res.text() }
    catch (e) { return JSON.stringify({ error: e.message }) }
  }, { url: L03_URL, bodyStr: JSON.stringify(body) })
}

function verdict(label, out, srcAmt, rt, rate) {
  const capExp = rt                          // 국세청 자체 cap(A) = YTS 정답 RT(=min(원본,100만)×율)
  const noCap  = Math.round(srcAmt * rate)   // cap 안함(B) = 원본×율
  let tag = "?"
  if (out === capExp) tag = "✅ (A) 국세청 자체 100만 cap → 원본전송 안전"
  else if (out === noCap) tag = "⚠️ (B) cap 안됨(ddcLmtAmt 의존) → 원본전송 위험"
  else tag = "❓ 예상 밖 — 수동확인"
  console.log(`  ${label}: 원본 ${fmt(srcAmt)} 전송 → OUT ${fmt(out)}   [cap기대 ${fmt(capExp)} / no-cap ${fmt(noCap)}]  ${tag}`)
}

async function main() {
  console.log("[1] Oracle 연결...")
  oracledb.initOracleClient({ libDir: ORACLE_LIB }); oracledb.fetchAsString = [oracledb.CLOB]
  const targets = await pickTargets()
  if (!targets.length) { console.error("대상 없음"); process.exit(1) }
  console.log(`    대상 ${targets.length}명: ${targets.join(", ")}`)
  console.log("[2] 국세청 세션 수립... (headed 필수)")
  const browser = await chromium.launch({ headless: false })
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await ctx.newPage(); page.on("dialog", d => d.accept().catch(() => {}))
  await establishSession(page); console.log("    세션 완료")

  for (const calcNo of targets) {
    const d = await fetchYts(calcNo)
    console.log(`\n═══ ${calcNo}  총급여 ${fmt(d.TOT_PAY_AMT)}  소진 ${d.EXHAUSTED_POINT ?? "?"}`)
    console.log(`   보장성  원본 ${fmt(d.SRC_GRT)} / capped ${fmt(d.OBJ_GRT)} / YTS공제 ${fmt(d.RT_GRT)}`)
    console.log(`   장애인  원본 ${fmt(d.SRC_HDC)} / capped ${fmt(d.OBJ_HDC)} / YTS공제 ${fmt(d.RT_HDC)}`)
    const grt = toMap(await postL03(page, buildBody(d, "grt"))); await page.waitForTimeout(400)
    const hdc = toMap(await postL03(page, buildBody(d, "hdc"))); await page.waitForTimeout(400)
    if (Number(d.SRC_GRT) > 0) verdict("8710 보장성", grt["8710"] ?? 0, Number(d.SRC_GRT), Number(d.RT_GRT), 0.12)
    if (Number(d.SRC_HDC) > 0) verdict("8711 장애인", hdc["8711"] ?? 0, Number(d.SRC_HDC), Number(d.RT_HDC), 0.15)
  }
  await browser.close(); console.log("\n완료.")
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
