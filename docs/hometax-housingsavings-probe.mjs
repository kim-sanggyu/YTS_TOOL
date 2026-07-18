/**
 * 홈택스 모의계산 — 주택마련저축(주택청약종합저축 8405) 전송 계약 판별 프로브
 *
 * 증상: 배치(우리 최소필드 body)로 8405 만 보내면 NTS OUT=0. 하지만 UI 캡처(8405+8407 동반,
 *   각 항목에 ereClCd:"01"/yrsSrvcClCd:"01"/statusValue:"R" 포함)에선 8405 OUT=×40% 정상.
 *   → 8405 가 0 인 원인 판별: ⓐ8407 동반 필요 / ⓑ분류필드 필요 / ⓒ8407 이 진짜 입력코드.
 *
 * 방법: 실제 562-060(주택청약종합저축) 보유자 1명에게 baseline 대비 변형 5발 발사 후 8405/8407 OUT 비교.
 *   base : 주택마련 미포함
 *   A    : 8405 useAmt (우리 배치와 동일 최소필드)          ← 0 재현 예상
 *   B    : 8407 useAmt (최소필드)
 *   C    : 8405 + 8407 둘 다 (최소필드)
 *   D    : 8405 useAmt + ereClCd:"01"+yrsSrvcClCd:"01"+statusValue:"R"
 *   → 어느 변형이 8405(또는 8407) OUT=×40% 를 만드는지가 정답.
 *
 * 사용법:
 *   node docs/hometax-housingsavings-probe.mjs            → 562-060 보유자 자동 1명
 *   node docs/hometax-housingsavings-probe.mjs X202600086 → 특정 CALC_NO
 *
 * ⚠ 읽기 전용(DB SELECT + NTS 조회). 저장 없음. eversafe → headed 필수.
 */

import oracledb from "../node_modules/oracledb/lib/oracledb.js"
import pw       from "../node_modules/playwright/index.js"
import fs       from "node:fs"

const { chromium } = pw

// 콘솔 + 파일(data/capture/hs-probe-result.txt) 동시 출력 — 붙여넣기 없이 결과 확인용
const OUT_FILE = "data/capture/hs-probe-result.txt"
const _lines = []
const log = (...a) => { const s = a.join(" "); process.stdout.write(s + "\n"); _lines.push(s) }
function flush() { try { fs.mkdirSync("data/capture", { recursive: true }); fs.writeFileSync(OUT_FILE, _lines.join("\n")) } catch {} }

const ORACLE_LIB = "D:/tools/instantclient_11_2"
const DB_CONNECT = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const DB_USER    = "YTS39"
const DB_PASS    = "Yts391234!"
const START_URL  = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const L03_URL    = "https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEAA001L03&screenId=UTEYSEJF01&popupYn=false&realScreenId="
const ATTR_YR    = "2025"

const arg1 = process.argv[2]
const specificCalcNo = arg1 && /^X\d{9,}$/.test(arg1) ? arg1 : null

async function dbQuery(sql, params = []) {
  const conn = await oracledb.getConnection({ user: DB_USER, password: DB_PASS, connectString: DB_CONNECT })
  try {
    const r = await conn.execute(sql, params, { outFormat: oracledb.OUT_FORMAT_OBJECT })
    return r.rows ?? []
  } finally { await conn.close() }
}

async function pickTarget() {
  if (specificCalcNo) return specificCalcNo
  const rows = await dbQuery(`
    SELECT CALC_NO FROM (
      SELECT c.CALC_NO
      FROM YTS39.PAY_WRK_CALC c
      WHERE c.CALC_NO LIKE 'X2026%'
        AND EXISTS (SELECT 1 FROM YTS39.PAY_WRK_PEN_SAVE_SPEC s
                    WHERE s.CALC_NO = c.CALC_NO AND s.PEN_SAVE_CLS = '562-060' AND NVL(s.PEN_SAVE_PMT_AMT,0) > 0)
      ORDER BY c.CALC_NO
    ) WHERE ROWNUM = 1
  `)
  return rows[0]?.CALC_NO
}

async function fetchYts(calcNo) {
  const [d] = await dbQuery(`
    SELECT c.CALC_NO, c.TOT_PAY_AMT, c.PAYM_INCM_TAX,
      c.BASC_SUB_MATE_AMT, c.NP_INSU_AMT, c.SPCL_IF_HLTH_INSU_AMT, c.SPCL_IF_EMP_INSU_AMT,
      NVL(c.OTO_HOUSE_LOAN_ALL_AMT,0) AS YTS_DDC_8405,
      (SELECT NVL(SUM(PEN_SAVE_PMT_AMT),0) FROM YTS39.PAY_WRK_PEN_SAVE_SPEC s
         WHERE s.CALC_NO=c.CALC_NO AND s.PEN_SAVE_CLS='562-060') AS PMT_562_060
    FROM YTS39.PAY_WRK_CALC c WHERE c.CALC_NO = :1`, [calcNo])
  if (!d) throw new Error(`CALC_NO 없음: ${calcNo}`)
  return d
}

const ALL_CODES = [
  "8900","8991","8001","8002","8201","8301","8305",
  "8403","8404","8405","8406","8407",
  "8901","8902","8903","8990","8999",
]
function baseDetail() {
  return ALL_CODES.map(code => ({ amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0" }))
}

// variant: "base" | "A" | "B" | "C" | "D"
function buildBody(d, variant) {
  const totPay = Number(d.TOT_PAY_AMT), prepaid = Number(d.PAYM_INCM_TAX), amt = Number(d.PMT_562_060)
  const detail = baseDetail()
  const set = (code, field, val) => { const it = detail.find(x => x.amtClusCd === code); if (it && val) it[field] = String(val) }
  const enrich = (code) => { const it = detail.find(x => x.amtClusCd === code); if (it) Object.assign(it, { ereClCd: "01", yrsSrvcClCd: "01", statusValue: "R", attrYr: ATTR_YR }) }

  set("8900","useAmt",totPay); set("8991","useAmt",prepaid); set("8001","incDdcNfpCnt",1)
  if (Number(d.BASC_SUB_MATE_AMT)>0) set("8002","incDdcNfpCnt",1)
  set("8201","useAmt",d.NP_INSU_AMT); set("8301","useAmt",d.SPCL_IF_HLTH_INSU_AMT); set("8305","useAmt",d.SPCL_IF_EMP_INSU_AMT)

  if (variant === "A") { set("8405","useAmt",amt) }
  if (variant === "B") { set("8407","useAmt",amt) }
  if (variant === "C") { set("8405","useAmt",amt); set("8407","useAmt",amt) }
  if (variant === "D") { set("8405","useAmt",amt); enrich("8405") }
  if (variant === "E") { set("8403","useAmt",1000000) }   // 청약저축 최소필드 → 400,000 이면 정상
  if (variant === "F") { set("8404","useAmt",1000000) }   // 근로자주택마련 최소필드 → 400,000 이면 정상

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
  if(!calcNo){ console.error("562-060 보유자 없음"); process.exit(1) }
  const d = await fetchYts(calcNo)
  const expect = Math.round(Number(d.PMT_562_060) * 0.4)   // ×40% (한도 무시 근사)
  log(`    대상 ${calcNo}  총급여 ${fmt(d.TOT_PAY_AMT)}  562-060 납입 ${fmt(d.PMT_562_060)}  YTS공제(OTO_HOUSE_LOAN_ALL_AMT) ${fmt(d.YTS_DDC_8405)}  (×40%≈${fmt(expect)})`)

  log("[2] 국세청 세션...")
  const browser = await chromium.launch({ headless:false })
  const page = await (await browser.newContext({ viewport:{width:1920,height:1080} })).newPage()
  page.on("dialog",dl=>dl.accept().catch(()=>{}))
  await establishSession(page)
  log("    세션 완료\n")

  const base = toMap(await postL03(page, buildBody(d,"base"))); await page.waitForTimeout(400)
  const desc={A:"8405만(최소)",B:"8407만(최소)",C:"8405+8407(최소)",D:"8405만+분류필드",E:"8403청약저축(최소)",F:"8404근로자(최소)"}
  for(const v of ["A","B","C","D","E","F"]){
    const m = toMap(await postL03(page, buildBody(d,v))); await page.waitForTimeout(400)
    log(`  [${v}] ${desc[v].padEnd(18)}  8403=${fmt(m["8403"]).padStart(9)}  8404=${fmt(m["8404"]).padStart(9)}  8405=${fmt(m["8405"]).padStart(9)}  8407=${fmt(m["8407"]).padStart(9)}  과표Δ=${fmt((base["8903"]??0)-(m["8903"]??0)).padStart(9)}`)
  }
  log("\n판정: A/D=8405 0 재현 · B/C=8407 정답 · E=8403·F=8404 각 400,000 이면 그 코드 최소필드로 정상.")
  log(`\n(결과 파일: ${OUT_FILE})`)
  flush()
  await browser.close()
}
main().catch(e=>{ log("오류: " + e.message); flush(); process.exit(1) })
