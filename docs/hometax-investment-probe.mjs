/**
 * 홈택스 모의계산 — 투자조합출자(8415~8423) 소계 8410 OUT 구조 판별 프로브
 *
 * 질문: 개별 8415~8423 은 self ddcAmt 를 받나? 소계 8410 에 합이 오나? 둘 다인가?
 *   현황판이 8410 을 nts OUT=— 로 표시 중이라, 소계가 실제 OUT 으로 오는지 실측 확정.
 *
 * 방법: 실제 사람(base 컨텍스트)에 투자조합 금액을 "직접 조합해" 전송 후 8410 + 8415~8423 OUT 비교.
 *   base : 투자조합 미포함
 *   A    : 8420(벤처등 당해) 10,000,000        → self 8420? 소계 8410?
 *   B    : 8420 10,000,000 + 8418(벤처 -1년) 8,000,000  → 8410 = 합? 개별 self 각각?
 *   C    : 8417(조합1 -1년) 5,000,000          → 조합 10% self? 8410?
 *
 * 사용법: node docs/hometax-investment-probe.mjs [CALC_NO]  (없으면 562-110 보유자 자동 1명)
 * ⚠ 읽기 전용(DB SELECT + NTS 조회). 저장 없음. eversafe → headed 필수.
 */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"
import pw       from "../node_modules/playwright/index.js"
import fs       from "node:fs"
const { chromium } = pw

const OUT_FILE = "data/capture/inv-probe-result.txt"
const _lines = []
const log = (...a) => { const s = a.join(" "); process.stdout.write(s + "\n"); _lines.push(s) }
function flush() { try { fs.mkdirSync("data/capture", { recursive: true }); fs.writeFileSync(OUT_FILE, _lines.join("\n")) } catch {} }

const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const DB_USER = "YTS39", DB_PASS = "Yts391234!"
const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const L03_URL   = "https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEAA001L03&screenId=UTEYSEJF01&popupYn=false&realScreenId="
const ATTR_YR   = "2025"

const arg1 = process.argv[2]
const specificCalcNo = arg1 && /^X\d{9,}$/.test(arg1) ? arg1 : null

async function dbQuery(sql, params = []) {
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  try { return (await conn.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? [] }
  finally { await conn.close() }
}
async function pickTarget() {
  if (specificCalcNo) return specificCalcNo
  const rows = await dbQuery(`
    SELECT CALC_NO FROM (
      SELECT c.CALC_NO FROM YTS39.PAY_WRK_CALC c
      WHERE c.CALC_NO LIKE 'X2026%'
        AND EXISTS (SELECT 1 FROM YTS39.PAY_WRK_PEN_SAVE_SPEC s WHERE s.CALC_NO=c.CALC_NO AND s.PEN_SAVE_CLS='562-110')
      ORDER BY c.CALC_NO) WHERE ROWNUM = 1`)
  return rows[0]?.CALC_NO
}
async function fetchYts(calcNo) {
  const [d] = await dbQuery(`
    SELECT c.CALC_NO, c.TOT_PAY_AMT, c.PAYM_INCM_TAX,
      c.BASC_SUB_MATE_AMT, c.NP_INSU_AMT, c.SPCL_IF_HLTH_INSU_AMT, c.SPCL_IF_EMP_INSU_AMT
    FROM YTS39.PAY_WRK_CALC c WHERE c.CALC_NO = :1`, [calcNo])
  if (!d) throw new Error(`CALC_NO 없음: ${calcNo}`)
  return d
}

const INV_CODES = ["8410","8415","8416","8417","8418","8419","8420","8421","8422","8423"]
const ALL_CODES = ["8900","8991","8001","8002","8201","8301","8305", ...INV_CODES, "8901","8902","8903","8990","8999"]
function baseDetail() {
  return ALL_CODES.map(code => ({ amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0" }))
}
function buildBody(d, variant) {
  const totPay = Number(d.TOT_PAY_AMT), prepaid = Number(d.PAYM_INCM_TAX)
  const detail = baseDetail()
  const set = (code, field, val) => { const it = detail.find(x => x.amtClusCd === code); if (it && val) it[field] = String(val) }
  set("8900","useAmt",totPay); set("8991","useAmt",prepaid); set("8001","incDdcNfpCnt",1)
  if (Number(d.BASC_SUB_MATE_AMT)>0) set("8002","incDdcNfpCnt",1)
  set("8201","useAmt",d.NP_INSU_AMT); set("8301","useAmt",d.SPCL_IF_HLTH_INSU_AMT); set("8305","useAmt",d.SPCL_IF_EMP_INSU_AMT)

  if (variant === "A") { set("8420","useAmt",10000000) }
  if (variant === "B") { set("8420","useAmt",10000000); set("8418","useAmt",8000000) }
  if (variant === "C") { set("8417","useAmt",5000000) }

  return {
    crdcDdcAmt:"0", smltClcClCd:ATTR_YR, v_saveChk:"Y", v_conbChk:"", yrsSrvcClCd:"",
    pbtAddDdcAmt:"0", pbtDdcAmt:"0", addDdcrtDdcAmt:"0", ddcPsbAmt:"0", tdmrAddDdcAmt:"0",
    lstDdcAmt:"0", tdmrDdcAmt:"0", bppAddDdcAmt:"0", gnrlDdcAmt:"0", ddcExclAmt:"0",
    totaSnwAmt:String(totPay), ddcLmtAmt:"0",
    yrsTaxClcBscList:[{ ppmTxamt:String(prepaid), attrYr:ATTR_YR, ddcRtnId:"", erinAmt:"0", totaSnwAmt:String(totPay), statusValue:"R" }],
    yrsTaxClcDetailDVOList: detail,
  }
}
function toMap(raw){ const m={}; try{ for(const it of (JSON.parse(raw).yrsTaxClcDetailDVOList??[])) m[String(it.amtClusCd)]=Number(it.ddcAmt??0) }catch{} return m }
const fmt = n => (n==null?"—":Number(n).toLocaleString("ko-KR"))
async function clickText(page, text, preferRight=false){ for(const f of page.frames()){ try{ const ok=await f.evaluate(({t,pr})=>{ let els=Array.from(document.querySelectorAll("a,button,input,li,span,div")).filter(e=>(e.offsetWidth||e.offsetHeight)&&(e.textContent||e.value||"").trim()===t); if(pr)els=els.sort((a,b)=>b.getBoundingClientRect().left-a.getBoundingClientRect().left); if(els[0]){els[0].click();return true} return false },{t:text,pr:preferRight}); if(ok)return }catch{} } }
async function establishSession(page){ await page.goto(START_URL,{waitUntil:"domcontentloaded",timeout:60000}).catch(()=>{}); await page.waitForTimeout(7000); await clickText(page,"모의계산",true); await page.waitForTimeout(6000); try{await page.getByText("연말정산 자동계산하기",{exact:true}).first().click({timeout:8000})}catch{}; await page.waitForTimeout(2000); await page.evaluate(()=>{const els=Array.from(document.querySelectorAll('[id="a_1905120000"]'));const vis=els.filter(e=>e.offsetParent!==null);(vis[0]||els[0])?.click()}); await page.waitForTimeout(9000) }
async function postL03(page, body){ return page.evaluate(async ({url,bodyStr})=>{ try{ const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json;charset=UTF-8"},body:bodyStr,credentials:"include"}); return await res.text() }catch(e){return JSON.stringify({error:e.message})} },{url:L03_URL,bodyStr:JSON.stringify(body)}) }

async function main(){
  log("[1] Oracle 연결...")
  oracledb.initOracleClient({ libDir: ORACLE_LIB })
  const calcNo = await pickTarget()
  if(!calcNo){ console.error("562-110 보유자 없음"); process.exit(1) }
  const d = await fetchYts(calcNo)
  log(`    base 대상 ${calcNo}  총급여 ${fmt(d.TOT_PAY_AMT)}`)

  log("[2] 국세청 세션...")
  const browser = await chromium.launch({ headless:false })
  const page = await (await browser.newContext({ viewport:{width:1920,height:1080} })).newPage()
  page.on("dialog",dl=>dl.accept().catch(()=>{}))
  await establishSession(page)
  log("    세션 완료\n")

  const base = toMap(await postL03(page, buildBody(d,"base"))); await page.waitForTimeout(400)
  const desc = { A:"8420(벤처당해)1천만", B:"8420 1천만+8418(벤처-1)8백만", C:"8417(조합1 -1) 5백만" }
  const show = ["8410","8417","8418","8420"]
  for(const v of ["A","B","C"]){
    const m = toMap(await postL03(page, buildBody(d,v))); await page.waitForTimeout(400)
    const cells = show.map(c => `${c}=${fmt(m[c]).padStart(11)}`).join("  ")
    log(`  [${v}] ${desc[v].padEnd(26)}  ${cells}  과표Δ=${fmt((base["8903"]??0)-(m["8903"]??0)).padStart(11)}`)
  }
  log("\n판정: 8410>0 이면 소계 OUT 확정 / 개별(8417/18/20)>0 이면 self 도 반환(하이브리드).")
  log("      B 에서 8410 = 8420+8418 이면 소계=개별합.")
  log(`\n(결과 파일: ${OUT_FILE})`)
  flush()
  await browser.close()
}
main().catch(e=>{ log("오류: " + e.message); flush(); process.exit(1) })
