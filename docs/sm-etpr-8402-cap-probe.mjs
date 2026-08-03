/**
 * 소기업소상공인(8402) 초과구간 국세청 자체캡 실측 프로브 — 읽기 전용(DB SELECT + NTS 비로그인 모의계산, 저장 없음).
 *
 * 목적: 납입 원본(> 소득구간 한도)을 8402 useAmt 로 보냈을 때 국세청 회신 ddcAmt 가
 *   소득금액별 한도(600/500/400/200만)로 self cap 되는지 판별.
 *   - 캡값(=YTS OTO_SM_ETPR_AMT) 이면 → 국세청 self cap 확인 → 원본전송 매핑 안전(verdict 확정 승격)
 *   - 납입 전액 회신 → 초과구간 과다공제 위험 → 매핑 교정 필요
 *
 * 사용법: node docs/sm-etpr-8402-cap-probe.mjs Y202600235
 * ⚠ eversafe → headed 필수. NTS 스로틀 주의(발사 최소).
 */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"
import pw from "../node_modules/playwright/index.js"

const { chromium } = pw
const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const DB_USER = "YTS39", DB_PASS = "Yts391234!"
const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const L03_URL = "https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEAA001L03&screenId=UTEYSEJF01&popupYn=false&realScreenId="
const ATTR_YR = "2025"
const calcNo = process.argv[2] || "Y202600235"
const fmt = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"))

async function dbQuery(sql, params = []) {
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  try { const r = await conn.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT }); return r.rows ?? [] }
  finally { await conn.close() }
}

async function fetchYts(cn) {
  const [d] = await dbQuery(`
    SELECT c.CALC_NO, c.TOT_PAY_AMT, c.PAYM_INCM_TAX, NVL(c.OTO_SM_ETPR_AMT,0) AS YTS_SM,
      c.NP_INSU_AMT, c.SPCL_IF_HLTH_INSU_AMT, c.SPCL_IF_EMP_INSU_AMT, c.BASC_SUB_MATE_AMT,
      NVL(m.SM_ETPR_AMT,0) AS SM_ETPR_AMT
    FROM YTS39.PAY_WRK_CALC c JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
    WHERE c.CALC_NO = :1`, [cn])
  if (!d) throw new Error(`CALC_NO 없음: ${cn}`)
  return d
}

const ALL_CODES = ["8900","8991","8001","8002","8201","8301","8305","8402","8901","8902","8903","8990","8999"]
const baseDetail = () => ALL_CODES.map(code => ({ amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0" }))

function buildBody(d, variant) {
  const totPay = Number(d.TOT_PAY_AMT), prepaid = Number(d.PAYM_INCM_TAX), amt = Number(d.SM_ETPR_AMT)
  const detail = baseDetail()
  const set = (code, field, val) => { const it = detail.find(x => x.amtClusCd === code); if (it && val) it[field] = String(val) }
  set("8900","useAmt",totPay); set("8991","useAmt",prepaid); set("8001","incDdcNfpCnt",1)
  if (Number(d.BASC_SUB_MATE_AMT) > 0) set("8002","incDdcNfpCnt",1)
  set("8201","useAmt",d.NP_INSU_AMT); set("8301","useAmt",d.SPCL_IF_HLTH_INSU_AMT); set("8305","useAmt",d.SPCL_IF_EMP_INSU_AMT)
  if (variant === "SM") set("8402","useAmt",amt)   // 소기업소상공인 납입 원본 전송(초과구간)
  return {
    crdcDdcAmt:"0", smltClcClCd:ATTR_YR, v_saveChk:"Y", v_conbChk:"", yrsSrvcClCd:"",
    pbtAddDdcAmt:"0", pbtDdcAmt:"0", addDdcrtDdcAmt:"0", ddcPsbAmt:"0", tdmrAddDdcAmt:"0",
    lstDdcAmt:"0", tdmrDdcAmt:"0", bppAddDdcAmt:"0", gnrlDdcAmt:"0", ddcExclAmt:"0",
    totaSnwAmt:String(totPay), ddcLmtAmt:"0",
    yrsTaxClcBscList:[{ ppmTxamt:String(prepaid), attrYr:ATTR_YR, ddcRtnId:"", erinAmt:"0", totaSnwAmt:String(totPay), statusValue:"R" }],
    yrsTaxClcDetailDVOList: detail,
  }
}
const toMap = raw => { const m = {}; try { for (const it of (JSON.parse(raw).yrsTaxClcDetailDVOList ?? [])) m[String(it.amtClusCd)] = Number(it.ddcAmt ?? 0) } catch {} return m }
async function clickText(page, text, preferRight=false){ for(const f of page.frames()){ try{ const ok=await f.evaluate(({t,pr})=>{ let els=Array.from(document.querySelectorAll("a,button,input,li,span,div")).filter(e=>(e.offsetWidth||e.offsetHeight)&&(e.textContent||e.value||"").trim()===t); if(pr)els=els.sort((a,b)=>b.getBoundingClientRect().left-a.getBoundingClientRect().left); if(els[0]){els[0].click();return true} return false },{t:text,pr:preferRight}); if(ok)return }catch{} } }
async function establishSession(page){ await page.goto(START_URL,{waitUntil:"domcontentloaded",timeout:60000}).catch(()=>{}); await page.waitForTimeout(7000); await clickText(page,"모의계산",true); await page.waitForTimeout(6000); try{await page.getByText("연말정산 자동계산하기",{exact:true}).first().click({timeout:8000})}catch{}; await page.waitForTimeout(2000); await page.evaluate(()=>{const els=Array.from(document.querySelectorAll('[id="a_1905120000"]'));const vis=els.filter(e=>e.offsetParent!==null);(vis[0]||els[0])?.click()}); await page.waitForTimeout(9000) }
async function postL03(page, body){ return page.evaluate(async ({url,bodyStr})=>{ try{ const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json;charset=UTF-8"},body:bodyStr,credentials:"include"}); return await res.text() }catch(e){return JSON.stringify({error:e.message})} },{url:L03_URL,bodyStr:JSON.stringify(body)}) }

async function main() {
  console.log("[1] Oracle 연결...")
  oracledb.initOracleClient({ libDir: ORACLE_LIB })
  const d = await fetchYts(calcNo)
  console.log(`    대상 ${calcNo}  총급여 ${fmt(d.TOT_PAY_AMT)}  8402 납입 ${fmt(d.SM_ETPR_AMT)}  YTS공제(OTO_SM_ETPR_AMT) ${fmt(d.YTS_SM)}`)

  console.log("[2] 국세청 비로그인 모의계산 세션...")
  const browser = await chromium.launch({ headless: false })
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
  page.on("dialog", dl => dl.accept().catch(() => {}))
  await establishSession(page)
  console.log("    세션 완료\n")

  const base = toMap(await postL03(page, buildBody(d, "base"))); await page.waitForTimeout(400)
  const sm   = toMap(await postL03(page, buildBody(d, "SM"))); await page.waitForTimeout(400)
  const out8402 = sm["8402"] ?? 0, ytsSm = Number(d.YTS_SM)
  console.log(`  [base]  8402=${fmt(base["8402"] ?? 0)}  과표=${fmt(base["8903"] ?? 0)}`)
  console.log(`  [SM  ]  8402=${fmt(out8402)}  과표=${fmt(sm["8903"] ?? 0)}  과표Δ=${fmt((base["8903"] ?? 0) - (sm["8903"] ?? 0))}`)
  console.log("")
  if (out8402 === ytsSm)                        console.log(`판정: ✅ 국세청 self cap ${fmt(out8402)} = YTS공제 일치 — 원본전송 매핑 안전(verdict 확정 승격 가능)`)
  else if (out8402 === Number(d.SM_ETPR_AMT))    console.log(`판정: ⚠️ 국세청 안 잘림(납입 전액 ${fmt(out8402)}) — 초과구간 과다공제 위험, 매핑 교정 필요`)
  else                                           console.log(`판정: ❓ 예상 밖 회신 ${fmt(out8402)} (YTS공제 ${fmt(ytsSm)}, 납입 ${fmt(d.SM_ETPR_AMT)}) — 별도 분석 필요`)
  await browser.close()
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
