/**
 * 연금계좌 — CALC_PROC_TOTAL 파싱 input 확정 프로브
 *
 * 가설: CALC_PROC_TOTAL [상세공제내역] '연금계좌' 블록의 "입력금액"(한도 적용 전 진짜 납입/전환액)을
 *   그대로 NTS 8701/8702/8703/8708 에 보내면, NTS가 한도·공제율을 계산해 8706 을 돌려주고
 *   그 값이 YTS Σ(RT_RSIGN_PEN_*) 와 일치한다. (ISA ×10 불필요 — 텍스트에 전환액 원본이 이미 있음)
 *
 * 사용법: node docs/hometax-pension-total-probe.mjs [prefix|CALC_NO] [건수]
 */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"
import pw       from "../node_modules/playwright/index.js"
const { chromium } = pw

const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const DB_USER = "YTS39", DB_PASS = "Yts391234!"
const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const L03_URL   = "https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEAA001L03&screenId=UTEYSEJF01&popupYn=false&realScreenId="
const ATTR_YR = "2025", PEN_RESULT_CODE = "8706"

const LABEL_CODE = [
  [/과학기술/, "8701"],
  [/근로자퇴직급여|퇴직급여보장/, "8702"],
  [/연금저축/, "8703"],
  [/ISA/, "8708"],
]
function parsePension(text) {
  const lines = text.split("\n")
  const start = lines.findIndex(l => /▩.*연금계좌/.test(l))
  if (start < 0) return {}
  const out = {}
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^▩/.test(l)) break
    if (/^\s*-{5,}/.test(l)) continue
    if (!l.trim()) { if (Object.keys(out).length) break; else continue }
    const m = l.match(/^\s+(\S.*?)\s{2,}([\d,]+)\s+([\d,]+)\s+/)
    if (!m) continue
    const label = m[1].trim(), input = Number(m[2].replace(/,/g, ""))
    const code = (LABEL_CODE.find(([re]) => re.test(label)) || [])[1]
    if (code) out[code] = (out[code] || 0) + input
  }
  return out
}

const arg1 = process.argv[2], arg2 = process.argv[3]
const specific = arg1 && /^X\d{9,}$/.test(arg1) ? arg1 : null
const prefix = arg1 && !specific ? arg1 : "X2026"
const limit = Number(arg2) || 3

async function dbQuery(sql, p = []) {
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  try { return (await conn.execute(sql, p, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? [] }
  finally { await conn.close() }
}
async function pickTargets() {
  if (specific) return [specific]
  const rows = await dbQuery(`
    SELECT CALC_NO FROM (
      SELECT c.CALC_NO, NVL(c.RSIGN_PEN_TECH_AMT,0)+NVL(c.RSIGN_PEN_RET_AMT,0)+NVL(c.RSIGN_PEN_PF_AMT,0)+NVL(c.ISA_PEN_AMT,0) S
      FROM YTS39.PAY_WRK_CALC c
      WHERE c.CALC_NO LIKE '${prefix}%' AND NVL(c.RSIGN_PEN_TECH_AMT,0)+NVL(c.RSIGN_PEN_RET_AMT,0)+NVL(c.RSIGN_PEN_PF_AMT,0)+NVL(c.ISA_PEN_AMT,0)>0
      ORDER BY S DESC
    ) WHERE ROWNUM <= :1`, [limit])
  return rows.map(r => r.CALC_NO)
}
async function fetchYts(calcNo) {
  const r = await dbQuery(`
    SELECT c.CALC_NO, c.TOT_PAY_AMT, c.PAYM_INCM_TAX,
      c.BASC_SUB_MATE_AMT, c.BASC_SUB_FAMILY_CNT, c.ADD_SUB_OAT_CNT, c.ADD_SUB_HDC_PERS_CNT,
      c.ADD_SUB_LADY_AMT, c.ADD_SUB_SNGL_PRNT_AMT, c.NP_INSU_AMT, c.SPCL_IF_HLTH_INSU_AMT, c.SPCL_IF_EMP_INSU_AMT,
      NVL(c.RT_RSIGN_PEN_TECH_AMT,0)+NVL(c.RT_RSIGN_PEN_RET_AMT,0)+NVL(c.RT_RSIGN_PEN_PF_AMT,0)+NVL(c.RT_ISA_PEN_AMT,0) AS YTS_ANS,
      c.CALC_PROC_TOTAL
    FROM YTS39.PAY_WRK_CALC c WHERE c.CALC_NO = :1`, [calcNo])
  if (!r.length) throw new Error(`없음 ${calcNo}`)
  return r[0]
}

const ALL_CODES = ["8900","8991","8001","8002","8003","8101","8102","8103","8104","8201","8301","8305",
  "8701","8702","8703","8705","8706","8707","8708","8901","8902","8903","8923","8990","8992","8998","8999"]
function buildBody(d, penInputs) {
  const totPay = Number(d.TOT_PAY_AMT), prepaid = Number(d.PAYM_INCM_TAX)
  const detail = ALL_CODES.map(code => ({ amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0" }))
  const set = (code, field, val) => { if (!val) return; const it = detail.find(x => x.amtClusCd === code); if (it) it[field] = String(val) }
  set("8900","useAmt",totPay); set("8991","useAmt",prepaid); set("8001","incDdcNfpCnt",1)
  if (Number(d.BASC_SUB_MATE_AMT)>0) set("8002","incDdcNfpCnt",1)
  if (Number(d.BASC_SUB_FAMILY_CNT)>0) set("8003","incDdcNfpCnt",d.BASC_SUB_FAMILY_CNT)
  set("8101","incDdcNfpCnt",d.ADD_SUB_OAT_CNT); set("8102","incDdcNfpCnt",d.ADD_SUB_HDC_PERS_CNT)
  if (Number(d.ADD_SUB_LADY_AMT)>0) set("8103","incDdcNfpCnt",1)
  if (Number(d.ADD_SUB_SNGL_PRNT_AMT)>0) set("8104","incDdcNfpCnt",1)
  set("8201","useAmt",d.NP_INSU_AMT); set("8301","useAmt",d.SPCL_IF_HLTH_INSU_AMT); set("8305","useAmt",d.SPCL_IF_EMP_INSU_AMT)
  if (penInputs) for (const [code, amt] of Object.entries(penInputs)) set(code, "useAmt", amt)
  return { crdcDdcAmt:"0", smltClcClCd:ATTR_YR, v_saveChk:"Y", v_conbChk:"", yrsSrvcClCd:"",
    pbtAddDdcAmt:"0", pbtDdcAmt:"0", addDdcrtDdcAmt:"0", ddcPsbAmt:"0", tdmrAddDdcAmt:"0", lstDdcAmt:"0", tdmrDdcAmt:"0",
    bppAddDdcAmt:"0", gnrlDdcAmt:"0", ddcExclAmt:"0", totaSnwAmt:String(totPay), ddcLmtAmt:"0",
    yrsTaxClcBscList:[{ ppmTxamt:String(prepaid), attrYr:ATTR_YR, ddcRtnId:"", erinAmt:"0", totaSnwAmt:String(totPay), statusValue:"R" }],
    yrsTaxClcDetailDVOList: detail }
}
function toMap(raw){ const m={}; try{ for(const it of (JSON.parse(raw).yrsTaxClcDetailDVOList??[])) m[String(it.amtClusCd)]=Number(it.ddcAmt??0);}catch{} return m }
const fmt = n => n==null?"—":Number(n).toLocaleString("ko-KR")

async function clickText(page,text,pr=false){for(const f of page.frames()){try{const ok=await f.evaluate(({t,pr})=>{let els=Array.from(document.querySelectorAll("a,button,input,li,span,div")).filter(e=>(e.offsetWidth||e.offsetHeight)&&(e.textContent||e.value||"").trim()===t);if(pr)els=els.sort((a,b)=>b.getBoundingClientRect().left-a.getBoundingClientRect().left);if(els[0]){els[0].click();return true}return false},{t:text,pr});if(ok)return}catch{}}}
async function establishSession(page){await page.goto(START_URL,{waitUntil:"domcontentloaded",timeout:60000}).catch(()=>{});await page.waitForTimeout(7000);await clickText(page,"모의계산",true);await page.waitForTimeout(6000);try{await page.getByText("연말정산 자동계산하기",{exact:true}).first().click({timeout:8000})}catch{};await page.waitForTimeout(2000);await page.evaluate(()=>{const els=Array.from(document.querySelectorAll('[id="a_1905120000"]'));const vis=els.filter(e=>e.offsetParent!==null);(vis[0]||els[0])?.click()});await page.waitForTimeout(9000)}
async function postL03(page,body){return page.evaluate(async({url,bodyStr})=>{try{const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json;charset=UTF-8"},body:bodyStr,credentials:"include"});return await res.text()}catch(e){return JSON.stringify({error:e.message})}},{url:L03_URL,bodyStr:JSON.stringify(body)})}

async function main(){
  console.log("[1] Oracle...")
  oracledb.initOracleClient({ libDir: ORACLE_LIB }); oracledb.fetchAsString=[oracledb.CLOB]
  const targets = await pickTargets()
  console.log("    대상:", targets.join(", "))
  console.log("[2] 세션 수립...")
  const browser = await chromium.launch({ headless: false })
  const page = await (await browser.newContext({ viewport:{width:1920,height:1080} })).newPage()
  page.on("dialog", d => d.accept().catch(()=>{}))
  await establishSession(page); console.log("    완료")
  for (const calcNo of targets) {
    const d = await fetchYts(calcNo)
    const penInputs = parsePension(d.CALC_PROC_TOTAL)
    const ytsAns = Number(d.YTS_ANS)
    const raw = await postL03(page, buildBody(d, penInputs)); await page.waitForTimeout(400)
    const nts = toMap(raw)[PEN_RESULT_CODE] ?? null
    const ok = nts != null && Number(nts) === ytsAns
    console.log(`\n▶ ${calcNo}  파싱input=${JSON.stringify(penInputs)}`)
    console.log(`   NTS 8706 = ${fmt(nts)}  vs YTS = ${fmt(ytsAns)}  ${ok ? "✅ 일치" : "❌"}`)
  }
  await browser.close(); console.log("\n완료.")
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
