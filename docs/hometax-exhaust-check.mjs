/**
 * 세액소진 확인 — 특정 CALC_NO 에 baseline+의료비(지출)+연금(납입)을 보내고
 * NTS 계산흐름(산출세액→세액공제→결정세액)을 덤프해 "NTS도 소진되는지" 직접 확인.
 * 사용법: node docs/hometax-exhaust-check.mjs X202600296
 */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"
import pw from "../node_modules/playwright/index.js"
const { chromium } = pw
const ORACLE_LIB="D:/tools/instantclient_11_2"
const DB_CONNECT="(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
const START_URL="https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const L03_URL="https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEAA001L03&screenId=UTEYSEJF01&popupYn=false&realScreenId="
const ATTR_YR="2025"
const CALC_NO=process.argv[2]||"X202600296"

const MEDI=[["본인등배려자","8720"],["그밖의부양가족","8721"],["난임시술비","8725"],["미숙아등이상아","8729"]]
const PEN={"562-020":"8701","562-010":"8702","562-025":"8702","562-040":"8703","562-130":"8707","562-120":"8708"}

async function q(sql,p=[]){const c=await oracledb.getConnection({user:"YTS39",password:"Yts391234!",connectString:DB_CONNECT});try{return (await c.execute(sql,p,{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows??[]}finally{await c.close()}}

const ALL=["8900","8991","8001","8002","8003","8101","8102","8103","8104","8201","8301","8305",
 "8720","8721","8725","8726","8729","8701","8702","8703","8705","8706","8707","8708",
 "8901","8902","8903","8921","8922","8923","8990","8992","8998","8999"]

function build(d, medi, penInputs){
 const totPay=Number(d.TOT_PAY_AMT), prepaid=Number(d.PAYM_INCM_TAX)
 const detail=ALL.map(code=>({amtClusCd:code,useAmt:"0",ddcLmtAmt:"0",incDdcNfpCnt:"0",ddcTrgtAmt:"0",ddcAmt:"0"}))
 const set=(c,f,v)=>{if(!v)return;const it=detail.find(x=>x.amtClusCd===c);if(it)it[f]=String(v)}
 set("8900","useAmt",totPay); set("8991","useAmt",prepaid); set("8001","incDdcNfpCnt",1)
 if(Number(d.BASC_SUB_MATE_AMT)>0)set("8002","incDdcNfpCnt",1)
 if(Number(d.BASC_SUB_FAMILY_CNT)>0)set("8003","incDdcNfpCnt",d.BASC_SUB_FAMILY_CNT)
 set("8101","incDdcNfpCnt",d.ADD_SUB_OAT_CNT); set("8102","incDdcNfpCnt",d.ADD_SUB_HDC_PERS_CNT)
 set("8201","useAmt",d.NP_INSU_AMT); set("8301","useAmt",d.SPCL_IF_HLTH_INSU_AMT); set("8305","useAmt",d.SPCL_IF_EMP_INSU_AMT)
 if(medi) for(const [k,code] of MEDI){const v=Number(medi[k]??0); if(v>0)set(code,"useAmt",v)}
 if(penInputs) for(const [code,amt] of Object.entries(penInputs)) set(code,"useAmt",amt)
 return {crdcDdcAmt:"0",smltClcClCd:ATTR_YR,v_saveChk:"Y",v_conbChk:"",yrsSrvcClCd:"",pbtAddDdcAmt:"0",pbtDdcAmt:"0",addDdcrtDdcAmt:"0",ddcPsbAmt:"0",tdmrAddDdcAmt:"0",lstDdcAmt:"0",tdmrDdcAmt:"0",bppAddDdcAmt:"0",gnrlDdcAmt:"0",ddcExclAmt:"0",totaSnwAmt:String(totPay),ddcLmtAmt:"0",yrsTaxClcBscList:[{ppmTxamt:String(prepaid),attrYr:ATTR_YR,ddcRtnId:"",erinAmt:"0",totaSnwAmt:String(totPay),statusValue:"R"}],yrsTaxClcDetailDVOList:detail}
}
function toMap(raw){const m={};try{for(const it of (JSON.parse(raw).yrsTaxClcDetailDVOList??[]))m[String(it.amtClusCd)]=Number(it.ddcAmt??0)}catch{}return m}
const f=n=>n==null?"—":Number(n).toLocaleString("ko-KR")
async function clickText(page,t,pr=false){for(const fr of page.frames()){try{const ok=await fr.evaluate(({t,pr})=>{let e=Array.from(document.querySelectorAll("a,button,input,li,span,div")).filter(x=>(x.offsetWidth||x.offsetHeight)&&(x.textContent||x.value||"").trim()===t);if(pr)e=e.sort((a,b)=>b.getBoundingClientRect().left-a.getBoundingClientRect().left);if(e[0]){e[0].click();return true}return false},{t,pr});if(ok)return}catch{}}}
async function post(page,body){return page.evaluate(async({url,b})=>{try{const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json;charset=UTF-8"},body:b,credentials:"include"});return await r.text()}catch(e){return JSON.stringify({error:e.message})}},{url:L03_URL,b:JSON.stringify(body)})}

async function main(){
 oracledb.initOracleClient({libDir:ORACLE_LIB}); oracledb.fetchAsString=[oracledb.CLOB]
 const d=(await q(`SELECT c.TOT_PAY_AMT,c.PAYM_INCM_TAX,c.BASC_SUB_MATE_AMT,c.BASC_SUB_FAMILY_CNT,c.ADD_SUB_OAT_CNT,c.ADD_SUB_HDC_PERS_CNT,
   c.NP_INSU_AMT,c.SPCL_IF_HLTH_INSU_AMT,c.SPCL_IF_EMP_INSU_AMT, c.PROD_TAX_AMT, c.RES_INCM_TAX, c.EXHAUSTED_POINT,
   NVL(c.RT_RSIGN_PEN_TECH_AMT,0)+NVL(c.RT_RSIGN_PEN_RET_AMT,0)+NVL(c.RT_RSIGN_PEN_PF_AMT,0)+NVL(c.RT_ISA_PEN_AMT,0) PEN_TAX,
   c.CALC_PROC_MEDI FROM YTS39.PAY_WRK_CALC c WHERE c.CALC_NO=:1`,[CALC_NO]))[0]
 const medi=d.CALC_PROC_MEDI&&d.CALC_PROC_MEDI!=="null"?JSON.parse(d.CALC_PROC_MEDI):null
 const spec=await q(`SELECT PEN_SAVE_CLS,PEN_SAVE_PMT_AMT FROM YTS39.PAY_WRK_PEN_SAVE_SPEC WHERE CALC_NO=:1`,[CALC_NO])
 const penInputs={}; for(const r of spec){const c=PEN[r.PEN_SAVE_CLS]; if(c)penInputs[c]=(penInputs[c]||0)+Number(r.PEN_SAVE_PMT_AMT||0)}
 console.log(`▶ ${CALC_NO}  총급여 ${f(d.TOT_PAY_AMT)}  YTS산출 ${f(d.PROD_TAX_AMT)} 결정 ${f(d.RES_INCM_TAX)} 소진지점 ${d.EXHAUSTED_POINT}`)
 console.log(`  의료비지출 본인등 ${f(medi&&medi.본인등배려자)} 그밖 ${f(medi&&medi.그밖의부양가족)}  연금input ${JSON.stringify(penInputs)}  YTS연금공제 ${f(d.PEN_TAX)}`)

 const browser=await chromium.launch({headless:false})
 const page=await (await browser.newContext({viewport:{width:1920,height:1080}})).newPage()
 page.on("dialog",x=>x.accept().catch(()=>{}))
 await page.goto(START_URL,{waitUntil:"domcontentloaded",timeout:60000}).catch(()=>{}); await page.waitForTimeout(7000)
 await clickText(page,"모의계산",true); await page.waitForTimeout(6000)
 try{await page.getByText("연말정산 자동계산하기",{exact:true}).first().click({timeout:8000})}catch{}; await page.waitForTimeout(2000)
 await page.evaluate(()=>{const e=Array.from(document.querySelectorAll('[id="a_1905120000"]'));const v=e.filter(x=>x.offsetParent!==null);(v[0]||e[0])?.click()}); await page.waitForTimeout(9000)

 // A: 의료비+연금 (실제 화면과 유사)  /  B: 연금만(의료비 제외)
 const A=toMap(await post(page,build(d,medi,penInputs))); await page.waitForTimeout(400)
 const B=toMap(await post(page,build(d,null,penInputs))); await page.waitForTimeout(400)
 const show=(tag,m)=>{
  console.log(`\n  [${tag}]`)
  console.log(`    산출세액(8990) ${f(m["8990"])}  근로소득세액공제(8923) ${f(m["8923"])}`)
  console.log(`    의료비공제(8726) ${f(m["8726"])}  연금계좌공제(8706) ${f(m["8706"])}`)
  console.log(`    결정세액(8999) ${f(m["8999"])}`)
 }
 show("A: 의료비+연금 전송", A)
 show("B: 연금만 전송(의료비 제외)", B)
 await browser.close(); console.log("\n완료.")
}
main().catch(e=>{console.error("오류:",e.message);process.exit(1)})
