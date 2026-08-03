/**
 * 소기업소상공인(8402) 소득구간별 한도표 스윕 — 읽기 전용(NTS 비로그인 모의계산, 저장 없음, DB 불필요).
 *
 * 목적: 납입액을 모든 한도보다 크게(10,000,000) 고정하고 총급여(8900)만 바꿔가며
 *   국세청 회신 8402 ddcAmt 가 소득금액 구간별로 어떤 한도로 self cap 되는지 계단표를 추출.
 *   → 우리 note(600/500/400/200만)와 조특법 원문(500/300/200만?)의 실제 구간표를 국세청으로 확정.
 *
 * 사용법: node docs/sm-etpr-8402-bracket-sweep.mjs
 * ⚠ eversafe → headed 필수. 발사 7회(경계 집중). NTS 스로틀 주의.
 */
import pw from "../node_modules/playwright/index.js"
const { chromium } = pw
const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const L03_URL = "https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEAA001L03&screenId=UTEYSEJF01&popupYn=false&realScreenId="
const ATTR_YR = "2025"
const PMT = 10_000_000                 // 납입 고정(모든 한도 초과)
const GROSS_POINTS = [30_000_000, 52_000_000, 53_000_000, 70_000_000, 114_000_000, 116_000_000, 150_000_000]
const fmt = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"))

// 근로소득공제(2025) — 소득금액 역산 라벨용
function wageDeduction(G) {
  let d
  if (G <= 5_000_000) d = G * 0.7
  else if (G <= 15_000_000) d = 3_500_000 + (G - 5_000_000) * 0.4
  else if (G <= 45_000_000) d = 7_500_000 + (G - 15_000_000) * 0.15
  else if (G <= 100_000_000) d = 12_000_000 + (G - 45_000_000) * 0.05
  else d = 14_750_000 + (G - 100_000_000) * 0.02
  return Math.min(d, 20_000_000)
}
const incomeAmt = G => G - wageDeduction(G)

const ALL_CODES = ["8900","8001","8402","8901","8902","8903","8990","8999"]
const baseDetail = () => ALL_CODES.map(code => ({ amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0" }))
function buildBody(gross) {
  const detail = baseDetail()
  const set = (code, field, val) => { const it = detail.find(x => x.amtClusCd === code); if (it && val) it[field] = String(val) }
  set("8900","useAmt",gross); set("8001","incDdcNfpCnt",1); set("8402","useAmt",PMT)
  return {
    crdcDdcAmt:"0", smltClcClCd:ATTR_YR, v_saveChk:"Y", v_conbChk:"", yrsSrvcClCd:"",
    pbtAddDdcAmt:"0", pbtDdcAmt:"0", addDdcrtDdcAmt:"0", ddcPsbAmt:"0", tdmrAddDdcAmt:"0",
    lstDdcAmt:"0", tdmrDdcAmt:"0", bppAddDdcAmt:"0", gnrlDdcAmt:"0", ddcExclAmt:"0",
    totaSnwAmt:String(gross), ddcLmtAmt:"0",
    yrsTaxClcBscList:[{ ppmTxamt:"0", attrYr:ATTR_YR, ddcRtnId:"", erinAmt:"0", totaSnwAmt:String(gross), statusValue:"R" }],
    yrsTaxClcDetailDVOList: detail,
  }
}
const toMap = raw => { const m = {}; try { for (const it of (JSON.parse(raw).yrsTaxClcDetailDVOList ?? [])) m[String(it.amtClusCd)] = Number(it.ddcAmt ?? 0) } catch {} return m }
async function clickText(page, text, preferRight=false){ for(const f of page.frames()){ try{ const ok=await f.evaluate(({t,pr})=>{ let els=Array.from(document.querySelectorAll("a,button,input,li,span,div")).filter(e=>(e.offsetWidth||e.offsetHeight)&&(e.textContent||e.value||"").trim()===t); if(pr)els=els.sort((a,b)=>b.getBoundingClientRect().left-a.getBoundingClientRect().left); if(els[0]){els[0].click();return true} return false },{t:text,pr:preferRight}); if(ok)return }catch{} } }
async function establishSession(page){ await page.goto(START_URL,{waitUntil:"domcontentloaded",timeout:60000}).catch(()=>{}); await page.waitForTimeout(7000); await clickText(page,"모의계산",true); await page.waitForTimeout(6000); try{await page.getByText("연말정산 자동계산하기",{exact:true}).first().click({timeout:8000})}catch{}; await page.waitForTimeout(2000); await page.evaluate(()=>{const els=Array.from(document.querySelectorAll('[id="a_1905120000"]'));const vis=els.filter(e=>e.offsetParent!==null);(vis[0]||els[0])?.click()}); await page.waitForTimeout(9000) }
async function postL03(page, body){ return page.evaluate(async ({url,bodyStr})=>{ try{ const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json;charset=UTF-8"},body:bodyStr,credentials:"include"}); return await res.text() }catch(e){return JSON.stringify({error:e.message})} },{url:L03_URL,bodyStr:JSON.stringify(body)}) }

async function main() {
  console.log(`[스윕] 8402 납입 ${fmt(PMT)} 고정, 총급여 ${GROSS_POINTS.length}점\n`)
  console.log("[1] 국세청 비로그인 모의계산 세션...")
  const browser = await chromium.launch({ headless: false })
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
  page.on("dialog", dl => dl.accept().catch(() => {}))
  await establishSession(page)
  console.log("    세션 완료\n")

  console.log("  총급여          소득금액(역산)   8402 한도(ddcAmt)")
  console.log("  ─────────────────────────────────────────────────")
  for (const G of GROSS_POINTS) {
    const m = toMap(await postL03(page, buildBody(G)))
    const cap = m["8402"] ?? 0
    console.log(`  ${fmt(G).padStart(13)}   ${fmt(incomeAmt(G)).padStart(13)}   ${fmt(cap).padStart(13)}`)
    await page.waitForTimeout(800)
  }
  console.log("\n판정: 계단이 바뀌는 소득금액 경계 = 국세청 실제 구간표. 우리 note(600/500/400/200만)와 대조.")
  await browser.close()
}
main().catch(e => { console.error("오류:", e.message); process.exit(1) })
