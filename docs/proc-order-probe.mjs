/**
 * 계산과정(CALC_PROC_TOTAL) 줄 순서 ↔ NTS 코드 매핑 실측.
 * ③ NTS 원본 IN/OUT 표는 procCodeOrder(계산과정 등장순)로 정렬됨.
 * 이 스크립트: 표본 몇 명의 CALC_PROC_TOTAL 을 뽑아 (잔액)행 순서대로
 * 항목명→코드 매핑 여부를 찍어 "어디서 순서가 어긋나는지" 눈으로 확인.
 * 사용법: node docs/proc-order-probe.mjs [CALC_NO ...]  (없으면 자동 표본 3명)
 */
import oracledb from "../node_modules/oracledb/lib/oracledb.js"
try{ oracledb.initOracleClient({libDir:"D:/tools/instantclient_11_2"}) }catch(e){ /* already init */ }
oracledb.fetchAsString=[oracledb.CLOB]
const DB_CONNECT="(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=211.191.187.132)(PORT=1521))(CONNECT_DATA=(SID=webora)))"
async function q(sql,p=[]){const c=await oracledb.getConnection({user:"YTS39",password:"Yts391234!",connectString:DB_CONNECT});try{return (await c.execute(sql,p,{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows??[]}finally{await c.close()}}

// HometaxCalcPanel.tsx 와 동일 (복사)
const PROC_ROW_RE = /\(잔액\)\s+[\d,]+\s+-\s+([\d,]+)\s+\(([^)]+?)\s*\)/
// 개선판: 라벨 내부 괄호(대출기관/30조제외 등)까지 캡처 — "라벨 + 공백패딩 + )" 로 필드 종료
const PROC_ROW_RE2 = /\(잔액\)\s+[\d,]+\s+-\s+([\d,]+)\s+\((.+?)\s+\)/
const PROC_LABEL_CODE = {
  "본인":"8001","배우자":"8002","부양가족":"8003",
  "경로우대":"8101","장애인":"8102","부녀자":"8103","한부모가족":"8104",
  "국민연금":"8201",
  "개인연금저축":"8401","소기업·소상공인공제부금":"8402",
  "청약저축":"8403","주택청약종합저축":"8405","근로자주택마련저축":"8404",
  "우리사주조합출연금":"8452","고용유지중소기업근로자":"8453",
  "장기집합투자증권저축공제":"8451","청년형장기집합투자증권저축":"8501",
  "소득세법":"8601","조특법(30조제외)":"8602","조세조약":"8606",
  "근로소득세액":"8700","결혼세액공제":"8790","자녀":"8763","출산입양":"8761",
}

async function main(){
  let nos = process.argv.slice(2)
  if(!nos.length){
    // 계산과정 텍스트가 길고 공제 많은(RT_SUM 큰) 표본 3명
    const r = await q(`SELECT CALC_NO FROM (
        SELECT c.CALC_NO FROM YTS39.PAY_WRK_CALC c JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO=c.CALC_NO
        WHERE m.YY='2025' AND c.CALC_PROC_TOTAL IS NOT NULL
        ORDER BY LENGTH(c.CALC_PROC_TOTAL) DESC
      ) WHERE ROWNUM<=3`)
    nos = r.map(x=>x.CALC_NO)
  }
  for(const no of nos){
    const rows = await q(`SELECT CALC_PROC_TOTAL FROM YTS39.PAY_WRK_CALC WHERE CALC_NO=:1`,[no])
    const text = rows[0]?.CALC_PROC_TOTAL
    if(!text){ console.log(`\n### ${no}: (계산과정 없음)`); continue }
    console.log(`\n########## ${no} ##########`)
    const order=[], seen=new Set()
    let idx=0
    for(const line of String(text).split("\n")){
      const m = PROC_ROW_RE.exec(line)
      if(!m) continue
      idx++
      const label=m[2].trim(), amt=m[1]
      const code=PROC_LABEL_CODE[label]
      const mark = code ? (seen.has(code)?`= ${code}(중복)`:`→ ${code}`) : "✗ (매핑없음=표뒤로밀림)"
      if(code&&!seen.has(code)){seen.add(code);order.push(code)}
      console.log(`  ${String(idx).padStart(2)}. ${label.padEnd(22)} ${amt.padStart(12)}  ${mark}`)
    }
    console.log(`  ▶ procCodeOrder 결과: [${order.join(", ")}]`)

    // 개선 정규식으로 전체 라벨(유니크) + 현재 매핑상태 덤프
    console.log(`  --- 전체 라벨(개선 정규식) ---`)
    const seenL=new Set(); let n=0
    for(const line of String(text).split("\n")){
      const m=PROC_ROW_RE2.exec(line); if(!m) continue
      const label=m[2].trim(); if(seenL.has(label))continue; seenL.add(label)
      n++
      const code=PROC_LABEL_CODE[label]
      console.log(`  ${String(n).padStart(2)}. ${code?("["+code+"]"):"[ ??? ]"}  ${label}`)
    }
    console.log(`  ▶ 전체 유니크 라벨 ${n}개, 매핑됨 ${[...seenL].filter(l=>PROC_LABEL_CODE[l]).length}개`)
  }
  process.exit(0)
}
main().catch(e=>{console.error(e);process.exit(1)})
