/**
 * YTS39 ↔ 국세청(NTS) 연말정산 자동계산 매핑표 — 2026 귀속 (단일 원천 / source of truth)
 *
 * ▶ 2026-07-29 신설: mapping/2025.ts 를 **물리 복사**한 near-copy.
 *   2026 라이브 캡처(data/capture/io-2026-catalog-20260729.jsonl) 실측 결과 amtClusCd 코드체계·
 *   payload 구조가 2025와 동일 → 검증된 2025 계약을 그대로 시작점으로 삼는다.
 *   연도별로 바뀌는 전송 래퍼(actionId·screenId·드롭다운 id·detail 행별필드)는 ntsProfile.PROFILE_2026 에 격리.
 *
 * ▶ 왜 import·spread 가 아니라 물리 복사인가: 연도 파일 격리(2025 수정이 2026을 조용히 안 바꿈).
 *   국소 갱신 철학 = "직전연도 복사 후 diff 로만 갱신". 개정된 행만 손대고 확정행은 그대로 둔다.
 *
 * ▶ 2026 신규코드 검증결과(라이브 캡처 실측 2026-07-29, payload+response+입력화면 삼각검증 · data/capture/2026-verify/):
 *   [진짜 신규 입력 — 배선 대기(confirm 후 lock)]
 *   - 8454 : 국민성장집합투자증권저축(그밖의소득공제). OUT=대상×40% 실측(4440→1776). YTS 원천 미확정 → 원천 확정 후 배선.
 *   [신규 아님 — 오분류 정정]
 *   - 8405 : 주택청약종합저축 8405·8407 이중코드(UI가 둘 다 22220 전송). 이미 8407 단일화 확정(2026-07-21) → 8405 배선 불필요, 2026.ts 현행 8407 정답.
 *   [기존 항목의 소계/구간분해 OUT — 입력배선 불필요]
 *   - 8780~8786 : 고향사랑기부금 2026 개정(조특법§58) 구간분해. 화면입력은 8783(일반)/8784(특별) 2칸 유지, NTS가 구간별 분해회신(8780=총합계·8781=10만이하 100/110·8782=20만초과 15%·8785=특별재난·8786=10만~20만 40%신규). 실측확정(일반/특별 각 100만: 8783=250,909·8784=300,000·8780=550,909·8781=90,909·8786=40,000). ★8783/8784 self 대조 유지 — [[reference_nts_hometown_love_8783_8784]].
 *   - 8613/8615/8620 : 세액감면 그룹 소계(8613=외국인기술자 8602+8612, 8615=성과보상기금, 8620=조특법30조제외 RT_R_LAW 8종 합). 개별 self 대조로 충분, 배선 불필요.
 *   - 8745 / 8846 : 기부금 당해/이월 집계 — [[reference_nts_gift_carryforward_limit]].
 *   ※ 결과·집계 에코코드(8901/8917~8925 등)·소계코드(8430/8726/8705/8735/8761)는 입력배선 불필요.
 *   ※ 폐지된 입력코드 0(2026.ts 115코드 전부 payload 등장). near-copy 가정 실측 확인 — 진짜 신규 입력은 8454 하나뿐.
 *   ⚠ 세액계산 영향: 고향사랑 10만~20만 40% 신규구간 → YTS 세액계산SW 반영여부 점검 필요([[project_tax_calc_regression]]).
 *   ※ 오분류 교훈: "값 실린 미등록코드=신규" 성급단정 2건 오류(8780=고향합계·8405=이중코드) — probe(패턴추론) 아닌 confirm(라이브캡처)+기존note 정독으로 교정. 8454도 lock 전 확정캡처 재확인 권장.
 *
 * ▶ 스키마·매년관리 원칙은 2025.ts 헤더 참조(동일).
 */

import type { Coverage, MappingRow } from "./types"

export const MAPPING_2026: MappingRow[] = [
  // ── 총급여 (계산 기본입력) ───────────────────────────────────────────────
  { group: "기본입력", ntsCode: "8900", label: "총급여",       ytsCol: "TOT_PAY_AMT",   valueKey: "useAmt", rule: "value",  status: "추정", send: true },

  // ── 인적공제 (인원, incDdcNfpCnt) ──────────────────────────────────────────
  { group: "인적공제", ntsCode: "8001", label: "기본공제-본인",     ytsCol: null,                  resultCol: "BASC_SUB_SELF_AMT",  valueKey: "incDdcNfpCnt", rule: "const1", status: "확정", send: true, note: "self ddcAmt=1,500,000(본인 150만). 인원(incDdcNfpCnt=1) 전송. 라이브 payload 캡처 실측(capture-io 2026-07-18, n=38)" },
  { group: "인적공제", ntsCode: "8002", label: "기본공제-배우자",   ytsCol: "BASC_SUB_MATE_AMT",   resultCol: "BASC_SUB_MATE_AMT",   valueKey: "incDdcNfpCnt", rule: "flag",   status: "확정", send: true, note: "self ddcAmt=1,500,000(150만). 인원(flag→1) 전송, 결과대조=BASC_SUB_MATE_AMT. 라이브 payload 캡처 실측(2026-07-18, n=38)" },
  { group: "인적공제", ntsCode: "8003", label: "기본공제-부양가족(통합)", ytsCol: "BASC_SUB_FAMILY_CNT", resultCol: "BASC_SUB_FAMILY_AMT", valueKey: "incDdcNfpCnt", rule: "value",  status: "확정", send: false, altSent: true, note: "IN은 8004~8009 유형별로 전송(8003 미전송)하나, ★국세청 OUT은 8003(통합)에 회신 → 부양가족은 8003 소계형 대조. YTS BASC_SUB_FAMILY_AMT(인원×150만) ↔ NTS 8003 OUT. 라이브 실측(2026-07-22 X202600219: 5명 7,500,000 일치)" },
  // 부양가족 유형별 (PAY_WRK_FMLY.FMLY_RELN 집계 → FAM_{코드} 가상컬럼) = 부양가족 인적공제.
  //   ★유형별을 통합(CALC BASC_SUB_FAMILY_CNT 등)으로 단순화하지 말 것 — "과한 코드"로 보이나 자녀공제와 엮여 필수.
  //     기본공제만 보면 유형 무관(전원 한 유형에 몰아도 과세표준 동일)이지만, 자녀공제(8763)가 직계비속(8005)
  //     인원에 의존 → 8005=0으로 통합하면 8763도 0으로 떨어짐. (2026-07-23 실측 3명 전원, docs/hometax-family-lump-probe.mjs)
  //   ※자녀공제(8763)는 유형별만으론도 산출 안 됨(별도 총인원 필요). 출산입양(8761)은 순번별 8764~66이 산출. (2026-07-17 실측)
  { group: "인적공제", ntsCode: "8004", label: "부양가족-직계존속",              ytsCol: "FAM_8004", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, note: "FMLY_RELN 550-020(소득자 직계존속)+550-030(배우자 직계존속)" },
  { group: "인적공제", ntsCode: "8005", label: "부양가족-직계비속(자녀·손자녀·입양)", ytsCol: "FAM_8005", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, note: "FMLY_RELN 550-050" },
  { group: "인적공제", ntsCode: "8006", label: "부양가족-직계비속 그외",          ytsCol: "FAM_8006", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, note: "FMLY_RELN 550-055" },
  { group: "인적공제", ntsCode: "8007", label: "부양가족-형제자매",              ytsCol: "FAM_8007", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, note: "FMLY_RELN 550-060" },
  { group: "인적공제", ntsCode: "8008", label: "부양가족-수급자",                ytsCol: "FAM_8008", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, note: "FMLY_RELN 550-070" },
  { group: "인적공제", ntsCode: "8009", label: "부양가족-위탁아동",              ytsCol: "FAM_8009", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, note: "FMLY_RELN 550-080" },
  { group: "인적공제", ntsCode: "8101", label: "추가공제-경로우대", ytsCol: "ADD_SUB_OAT_CNT",     resultCol: "ADD_SUB_OAT_AMT",      valueKey: "incDdcNfpCnt", rule: "value",  status: "확정", send: true, note: "self ddcAmt=인원×100만. 인원(ADD_SUB_OAT_CNT) 전송, 결과대조=ADD_SUB_OAT_AMT. 라이브 캡처 실측(2026-07-18, n=38, 1명→1,000,000)" },
  { group: "인적공제", ntsCode: "8102", label: "추가공제-장애인",   ytsCol: "ADD_SUB_HDC_PERS_CNT",resultCol: "ADD_SUB_HDC_PERS_AMT", valueKey: "incDdcNfpCnt", rule: "value",  status: "확정", send: true, note: "self ddcAmt=인원×200만. 인원(ADD_SUB_HDC_PERS_CNT) 전송, 결과대조=ADD_SUB_HDC_PERS_AMT. 라이브 캡처 실측(2026-07-18, n=38, 2명→4,000,000)" },
  { group: "인적공제", ntsCode: "8103", label: "추가공제-부녀자",   ytsCol: "ADD_SUB_LADY_AMT",    resultCol: "ADD_SUB_LADY_AMT",      valueKey: "incDdcNfpCnt", rule: "flag",   status: "확정", send: true, note: "self ddcAmt=500,000(50만). 인원(flag→1) 전송, 결과대조=ADD_SUB_LADY_AMT. 라이브 캡처 실측(2026-07-18, n=56, 배우자없음+직계비속0+부녀자로 격리 — 한부모(8104)와 배타관계)" },
  { group: "인적공제", ntsCode: "8104", label: "추가공제-한부모",   ytsCol: "ADD_SUB_SNGL_PRNT_AMT",resultCol: "ADD_SUB_SNGL_PRNT_AMT", valueKey: "incDdcNfpCnt", rule: "flag",  status: "확정", send: true, note: "self ddcAmt=1,000,000(100만). 인원(flag→1) 전송, 결과대조=ADD_SUB_SNGL_PRNT_AMT. 라이브 캡처 실측(2026-07-18, n=46/47, 배우자없음+직계비속 → 한부모 자동 적용)" },

  // ── 연금보험료공제 (소득공제, useAmt) — 소계 OUT=8919 ──
  //   ★보낼 값=대상금액(_OBJ_AMT, 캡 전) / 대조=공제금액(_AMT, 잔액캡 후). NTS가 근로소득금액 잔액 소진을 스스로
  //   재현하게 해야 검증됨. 잔액 부족 시 공제=min(대상,잔액)<대상 — 국민연금 X2026 6명 OBJ≠AMT 실측
  //   (X202600049 대상329,220→공제0). 구: _AMT(공제금액,캡후)를 전송해 잔액로직이 검증 사각이던 것 교정(2026-07-21).
  //   OBJ/AMT 모두 PAY_WRK_CALC 컬럼(NP_INSU_OBJ_AMT=FN_PAY_GET_WRK_SOC_INSU_AMT 값과 동일 실측).
  { group: "연금보험료", ntsCode: "8201", label: "국민연금",       ytsCol: "NP_INSU_OBJ_AMT",        resultCol: "NP_INSU_AMT",        valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "연금보험료", ntsCode: "8205", label: "공무원연금",     ytsCol: "ETC_PEN_PUBL_OBJ_AMT",   resultCol: "ETC_PEN_PUBL_AMT",   valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "연금보험료", ntsCode: "8208", label: "군인연금",       ytsCol: "ETC_PEN_MLTARY_OBJ_AMT", resultCol: "ETC_PEN_MLTARY_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "연금보험료", ntsCode: "8211", label: "사립학교교직원연금", ytsCol: "ETC_PEN_SCHL_OBJ_AMT", resultCol: "ETC_PEN_SCHL_AMT",  valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "연금보험료", ntsCode: "8215", label: "별정우체국연금", ytsCol: "ETC_PEN_POST_OBJ_AMT",   resultCol: "ETC_PEN_POST_AMT",   valueKey: "useAmt", rule: "value", status: "확정", send: true },

  // ── 특별소득공제 (useAmt) — 소계 OUT=8920 ──────────────────────────────────
  //   보험료공제(건강·고용)도 연금보험료와 동일 원칙: 대상금액(_OBJ_AMT, 캡 전) 전송 → NTS 잔액 재현 →
  //   공제금액(_AMT, 캡 후) 대조. 구 _AMT 전송(잔액로직 사각)을 _OBJ_AMT로 교정(2026-07-21). 둘 다 PAY_WRK_CALC.
  { group: "특별소득공제", ntsCode: "8301", label: "건강보험료",   ytsCol: "SPCL_IF_HLTH_INSU_OBJ_AMT", resultCol: "SPCL_IF_HLTH_INSU_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8305", label: "고용보험료",   ytsCol: "SPCL_IF_EMP_INSU_OBJ_AMT",  resultCol: "SPCL_IF_EMP_INSU_AMT",  valueKey: "useAmt", rule: "value", status: "확정", send: true },
  // ── 주택자금(특별소득공제) — 한도 있어 원본 상환액(PAY_WRK_MAIN) LOAN_{코드} 주입 전송, NTS 한도로직 검증. ──
  //   대조 공제액 = SP_*_AMT(한도후). 코드↔YTS컬럼 순서 실측·상규님 확정(capture-io 2026-07-18, 8321~8329 = LRSF1/2/3/10/20/30/40/50/60).
  //   소계 OUT: 8310(원리금 소계)·8320(장기주택저당 소계). 전용 탭 없음(전체 결정세액 비교에 기여).
  { group: "특별소득공제", ntsCode: "8311", label: "주택임차 원리금-대출기관",       ytsCol: "LOAN_8311", resultCol: "SP_HOUSE_RALR_LENDER_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8312", label: "주택임차 원리금-거주자",         ytsCol: "LOAN_8312", resultCol: "SP_HOUSE_RALR_HABT_AMT",   valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8321", label: "장기주택저당 2011이전 15년미만",        ytsCol: "LOAN_8321", resultCol: "SP_LH_LRSF1_AMT",  valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8322", label: "장기주택저당 2011이전 15~29년",        ytsCol: "LOAN_8322", resultCol: "SP_LH_LRSF2_AMT",  valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8323", label: "장기주택저당 2011이전 30년이상",        ytsCol: "LOAN_8323", resultCol: "SP_LH_LRSF3_AMT",  valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8324", label: "장기주택저당 2011이전 15년이상 고정&비거치", ytsCol: "LOAN_8324", resultCol: "SP_LH_LRSF10_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8325", label: "장기주택저당 2011이전 15년이상 고정or비거치",              ytsCol: "LOAN_8325", resultCol: "SP_LH_LRSF20_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8326", label: "장기주택저당 2012이후 15년이상 고정&비거치", ytsCol: "LOAN_8326", resultCol: "SP_LH_LRSF30_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8327", label: "장기주택저당 2012이후 15년이상 고정or비거치", ytsCol: "LOAN_8327", resultCol: "SP_LH_LRSF40_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8328", label: "장기주택저당 2012이후 15년이상 그밖",         ytsCol: "LOAN_8328", resultCol: "SP_LH_LRSF50_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8329", label: "장기주택저당 2012이후 10~15년",             ytsCol: "LOAN_8329", resultCol: "SP_LH_LRSF60_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },

  // ── 그밖의 소득공제 (useAmt) — 국세청 화면(그밖의소득공제 상세팝업) 기준 정리 (2026-07-17 화면·payload 실측) ──
  { group: "그밖의소득공제", ntsCode: "8401", label: "개인연금저축",              ytsCol: "OTHER_8401", resultCol: "OTO_PPF", valueKey: "useAmt", rule: "value", status: "확정", send: true, tab: "기타", note: "IN=PAY_WRK_PEN_SAVE_SPEC PEN_SAVE_CLS='562-030' ΣPEN_SAVE_PMT_AMT(납입액 원본) → OTHER_8401 주입. OUT self ddcAmt=납입액×40%(한도72만) ↔ OTO_PPF. 라이브 캡처 실측(2026-07-18, 1,000,000→400,000). ★한도캡(납입>180만) 시 ddcLmtAmt 없이 NTS 자체캡 여부 미검증" },
  { group: "그밖의소득공제", ntsCode: "8402", label: "소기업소상공인", ytsCol: "OTHER_8402", resultCol: "OTO_SM_ETPR_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, tab: "기타", note: "IN=PAY_WRK_MAIN.SM_ETPR_AMT(납입액 원본) → OTHER_8402 주입. OUT self ddcAmt=min(납입액, 소득금액별한도 600/500/400/200만) ↔ OTO_SM_ETPR_AMT. 라이브 캡처 실측(2026-07-18, 1,000,000→1,000,000). ★한도캡 시 ddcLmtAmt 없이 NTS 자체캡 여부 미검증" },
  // 주택마련저축 = PAY_WRK_PEN_SAVE_SPEC 납입액(CLS별) → OTHER_ 주입. OUT self ddcAmt=납입액×40%(한도). 라이브 캡처 실측(2026-07-18).
  //   ★주택청약종합저축은 카탈로그 입력코드 8407(2015이후)로 통일(2026-07-21). 구 표시코드 8405는 카탈로그에 없고
  //     8405로 보내면 OUT=0. 8407로 보내면 NTS가 8405·8407 둘 다 동일 ddcAmt 회신·과표 1회 → 8407 단일로 전송·대조.
  { group: "그밖의소득공제", ntsCode: "8403", label: "청약저축",                ytsCol: "OTHER_8403", resultCol: "OTO_HOUSE_LOAN_SBSC_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, note: "IN=PEN_SAVE_SPEC CLS 562-050 Σ납입액→OTHER_8403. OUT ×40% ↔ OTO_HOUSE_LOAN_SBSC_AMT. 실측(2026-07-18, 1,000,000→400,000)" },
  { group: "그밖의소득공제", ntsCode: "8407", label: "주택청약종합저축",          ytsCol: "OTHER_8407", resultCol: "OTO_HOUSE_LOAN_ALL_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, note: "IN=PEN_SAVE_SPEC CLS 562-060 Σ납입액→OTHER_8407. 국세청 입력코드=8407(카탈로그 2015이후 주택청약종합저축). 구 ntsCode 8405+sendCode 8407 → 8407 단일화(2026-07-21). 8405로 보내면 OUT=0, 8407로 보내면 NTS가 8405·8407 둘 다 동일 ddcAmt 회신(과표 1회) — 한도미달(X202600086)·한도초과(X202600493) 2건 8405=8407 실측(hometax-housingsavings-probe). OUT ×40% ↔ OTO_HOUSE_LOAN_ALL_AMT" },
  { group: "그밖의소득공제", ntsCode: "8404", label: "근로자주택마련저축",         ytsCol: "OTHER_8404", resultCol: "OTO_HOUSE_LOAN_WRK_AMT",  valueKey: "useAmt", rule: "value", status: "확정", send: true, note: "IN=PEN_SAVE_SPEC CLS 562-080 Σ납입액→OTHER_8404. OUT ×40% ↔ OTO_HOUSE_LOAN_WRK_AMT. 실측(2026-07-18, 500,000→200,000)" },
  // 투자조합출자 = 3연도(입력연도-2~입력연도) × 3종류(벤처등/조합1/조합2). PAY_WRK_PEN_SAVE_SPEC INVST_CLS×INVST_YY 로 분리(단일컬럼 아님).
  //   IN = SUM(PEN_SAVE_PMT_AMT) → OTHER_{코드}(route.injectInvestmentVals, code=investmentCode(CLS,연차)). OUT self=벤처100/70/30%·조합10%, 소계 8410.
  //   대조 공제액 = SUM(PEN_SAVE_SUB_AMT)(연도/종류별) — investmentList 로 조회(단일 resultCol 아님). 코드·연도·종류 라이브 캡처 실측확정(2026-07-18).
  { group: "그밖의소득공제", ntsCode: "8416", label: "벤처등", ytsCol: "OTHER_8416", valueKey: "useAmt", rule: "value", status: "확정", send: true, yearOffset: -2 },
  { group: "그밖의소득공제", ntsCode: "8415", label: "조합1", ytsCol: "OTHER_8415", valueKey: "useAmt", rule: "value", status: "확정", send: true, yearOffset: -2 },
  { group: "그밖의소득공제", ntsCode: "8421", label: "조합2", ytsCol: "OTHER_8421", valueKey: "useAmt", rule: "value", status: "확정", send: true, yearOffset: -2 },
  { group: "그밖의소득공제", ntsCode: "8418", label: "벤처등", ytsCol: "OTHER_8418", valueKey: "useAmt", rule: "value", status: "확정", send: true, yearOffset: -1 },
  { group: "그밖의소득공제", ntsCode: "8417", label: "조합1", ytsCol: "OTHER_8417", valueKey: "useAmt", rule: "value", status: "확정", send: true, yearOffset: -1 },
  { group: "그밖의소득공제", ntsCode: "8422", label: "조합2", ytsCol: "OTHER_8422", valueKey: "useAmt", rule: "value", status: "확정", send: true, yearOffset: -1 },
  { group: "그밖의소득공제", ntsCode: "8420", label: "벤처등", ytsCol: "OTHER_8420", valueKey: "useAmt", rule: "value", status: "확정", send: true, yearOffset: 0 },
  { group: "그밖의소득공제", ntsCode: "8419", label: "조합1", ytsCol: "OTHER_8419", valueKey: "useAmt", rule: "value", status: "확정", send: true, yearOffset: 0 },
  { group: "그밖의소득공제", ntsCode: "8423", label: "조합2", ytsCol: "OTHER_8423", valueKey: "useAmt", rule: "value", status: "확정", send: true, yearOffset: 0 },
  { group: "그밖의소득공제", ntsCode: "8410", label: "투자조합출자 소계", ytsCol: null, resultCol: "OTO_IU_ETC", valueKey: "useAmt", rule: "value", status: "확정", send: false, note: "소계 결과전용(send:false). NTS OUT 8410=Σ개별(8415~8423) ddcAmt·과표 1회 반영 — 개별도 self ddcAmt 반환(하이브리드). 프로브 hometax-investment-probe(2026-07-21): 8420 1천만+8418 8백만→8410 1,800만, 벤처당해100%·조합1 10% 실측. 대조 OTO_IU_ETC(YTS 투자조합 공제 합). runHometaxCalc ALL_CODES에 8410 포함해 소계 결과 수신." },
  // 신용카드 등 — CALC_PROC_CARD(JSON) 가~아를 CARD_{코드} 가상컬럼으로 주입 (route.injectCardVals).
  //   NTS 8430(카드소계)에 총공제 반환 → YTS 최종공제금액(=OTO_CARD_ETC)과 대조. (2026-07-12 실측확정)
  { group: "그밖의소득공제(신용카드)", ntsCode: "8431", label: "신용카드",       ytsCol: "CARD_8431", resultCol: "OTO_CARD_ETC", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8430" },
  { group: "그밖의소득공제(신용카드)", ntsCode: "8432", label: "직불·선불카드",  ytsCol: "CARD_8432", resultCol: "OTO_CARD_ETC", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8430" },
  { group: "그밖의소득공제(신용카드)", ntsCode: "8433", label: "현금영수증",     ytsCol: "CARD_8433", resultCol: "OTO_CARD_ETC", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8430" },
  { group: "그밖의소득공제(신용카드)", ntsCode: "8435", label: "전통시장",       ytsCol: "CARD_8435", resultCol: "OTO_CARD_ETC", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8430" },
  { group: "그밖의소득공제(신용카드)", ntsCode: "8434", label: "대중교통",       ytsCol: "CARD_8434", resultCol: "OTO_CARD_ETC", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8430" },
  { group: "그밖의소득공제(신용카드)", ntsCode: "8461", label: "도서공연-신용",  ytsCol: "CARD_8461", resultCol: "OTO_CARD_ETC", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8430" },
  { group: "그밖의소득공제(신용카드)", ntsCode: "8462", label: "도서공연-직불",  ytsCol: "CARD_8462", resultCol: "OTO_CARD_ETC", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8430" },
  { group: "그밖의소득공제(신용카드)", ntsCode: "8463", label: "도서공연-현금",  ytsCol: "CARD_8463", resultCol: "OTO_CARD_ETC", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8430" },
  { group: "그밖의소득공제", ntsCode: "8452", label: "우리사주출연금 소득공제",       ytsCol: "OTHER_8452", resultCol: "OTO_SU",                 valueKey: "useAmt", rule: "value", status: "확정", send: true, tab: "기타", note: "IN=PAY_WRK_MAIN.STOCK_URDM→OTHER_8452. OUT self 전액(한도1500만) ↔ OTO_SU. 라이브 캡처 실측(2026-07-19, 1,000,000→1,000,000)" },
  { group: "그밖의소득공제", ntsCode: "8451", label: "장기집합투자증권저축",          ytsCol: "OTHER_8451", resultCol: "OTO_LONG_STOCK_SAVING",   valueKey: "useAmt", rule: "value", status: "확정", send: true, tab: "기타", note: "IN=PEN_SAVE_SPEC CLS 562-100 Σ납입액→OTHER_8451. OUT self ×40%(한도240만) ↔ OTO_LONG_STOCK_SAVING. 라이브 캡처 실측(2026-07-19, 2,000,000→800,000)" },
  { group: "그밖의소득공제", ntsCode: "8501", label: "청년형 장기집합투자증권저축",     ytsCol: "OTHER_8501", resultCol: "OTO_YM_LONG_STOCK_SAVING", valueKey: "useAmt", rule: "value", status: "확정", send: true, tab: "기타", note: "IN=PEN_SAVE_SPEC CLS 562-140 Σ납입액→OTHER_8501. OUT self ×40%(한도240만) ↔ OTO_YM_LONG_STOCK_SAVING. 카탈로그 미등재 코드였음, 라이브 캡처 실측(2026-07-19, 3,000,000→1,200,000)" },
  { group: "그밖의소득공제", ntsCode: "8453", label: "고용유지중소기업근로자소득공제",  ytsCol: "OTHER_8453", resultCol: "OTO_EMPL_MTN_WAGE_CUT",  valueKey: "useAmt", rule: "value", status: "확정", send: true, tab: "기타", note: "IN=PAY_WRK_MAIN.EMPL_MTN_WAGE_CUT(임금삭감액)→OTHER_8453. OUT self ×50%(한도1000만) ↔ OTO_EMPL_MTN_WAGE_CUT. 라이브 캡처 실측(2026-07-19, 4,000,000→2,000,000)" },

  // ── 세액감면 (useAmt) ──────────────────────────────────────────────────────
  { group: "세액감면", ntsCode: "8601", label: "세액감면-소득세법(정부간협약)", ytsCol: "CUT_8601", resultCol: "RT_IT_LAW", valueKey: "useAmt", rule: "value", status: "추정", send: true, note: "IN=감면대상급여 MAIN.TAX_GOVM_AGREE→CUT_8601. OUT self ↔ RT_IT_LAW. X2026 대상자 0이라 원단위 미검증. 2026-07-22 원천확정(상규님 지정)" },
  // ── 조특법30조제외(외국인기술자·성과공유·성과보상기금·우수인력) = 국세청 개별코드로 세분. 감면세액 합계는 RT_R_LAW 하나(개별 self 대조는 단일항목일 때만 정확). ──
  //    코드-화면 1:1은 라이브캡처 #2 useAmt 실측 확정. X2026 대상자 0이라 원단위 미검증. IN=FN_PAY_GET_WRK_NTAX Txx 합.
  { group: "세액감면", ntsCode: "8602", label: "조특법30조제외-외국인기술자 50%", ytsCol: "CUT_8602", resultCol: "RT_R_LAW", valueKey: "useAmt", rule: "value", status: "추정", send: true, note: "IN=FN Txx T01 합→CUT_8602. OUT self ↔ RT_R_LAW(조특법30조제외 감면세액 합). 대상 0 미검증. 2026-07-22 원천확정" },
  { group: "세액감면", ntsCode: "8612", label: "조특법30조제외-외국인기술자 70%", ytsCol: "CUT_8612", resultCol: "RT_R_LAW", valueKey: "useAmt", rule: "value", status: "추정", send: true, note: "IN=FN T02 합→CUT_8612. OUT self ↔ RT_R_LAW. 대상 0 미검증" },
  { group: "세액감면", ntsCode: "8609", label: "조특법30조제외-성과공유 경영성과급", ytsCol: "CUT_8609", resultCol: "RT_R_LAW", valueKey: "useAmt", rule: "value", status: "추정", send: true, note: "IN=FN T30 합→CUT_8609. OUT self ↔ RT_R_LAW. 대상 0 미검증" },
  { group: "세액감면", ntsCode: "8611", label: "조특법30조제외-내국인 우수인력 국내복귀", ytsCol: "CUT_8611", resultCol: "RT_R_LAW", valueKey: "useAmt", rule: "value", status: "추정", send: true, note: "IN=FN T50 합→CUT_8611. OUT self ↔ RT_R_LAW. 대상 0 미검증" },
  { group: "세액감면", ntsCode: "8617", label: "조특법30조제외-중소기업 성과보상기금 90%", ytsCol: "CUT_8617", resultCol: "RT_R_LAW", valueKey: "useAmt", rule: "value", status: "추정", send: true, note: "IN=FN T42 합→CUT_8617. OUT self ↔ RT_R_LAW. 대상 0 미검증. 2026-07-22 율확정(상규님: T42=90%)" },
  { group: "세액감면", ntsCode: "8610", label: "조특법30조제외-중소기업 성과보상기금 50%", ytsCol: "CUT_8610", resultCol: "RT_R_LAW", valueKey: "useAmt", rule: "value", status: "추정", send: true, note: "IN=FN T40 합→CUT_8610. 대상 0 미검증. T40=50%" },
  { group: "세액감면", ntsCode: "8616", label: "조특법30조제외-중견기업 성과보상기금 50%", ytsCol: "CUT_8616", resultCol: "RT_R_LAW", valueKey: "useAmt", rule: "value", status: "추정", send: true, note: "IN=FN T43 합→CUT_8616. 대상 0 미검증. T43=50%" },
  { group: "세액감면", ntsCode: "8614", label: "조특법30조제외-중견기업 성과보상기금 30%", ytsCol: "CUT_8614", resultCol: "RT_R_LAW", valueKey: "useAmt", rule: "value", status: "추정", send: true, note: "IN=FN T41 합→CUT_8614. 대상 0 미검증. T41=30%" },
  // ★ 조특법30조(중소기업 취업자 소득세 감면) = 율 70%(8603)·90%(8608) 두 가지뿐. 국세청 화면 "감면대상급여 입력 → 감면세액 자동계산"
  //    (감면세액 = 산출세액 × (감면대상급여/총급여) × 율). IN=감면대상급여 useAmt = FN_PAY_GET_WRK_NTAX(MAIN)+FN_PAY_GET_WRK_NTAX(SUB) T12/T13 → CUT_8603/CUT_8608 주입.
  //    OUT self ddcAmt ↔ RT_R_LAW_CLAUS30. 근로소득세액공제(8700) 연쇄축소도 국세청이 재현. (2026-07-22 라이브캡처 실측 #3/#4 + 9명 원단위 검증)
  //    ※구 8604(100%)·8605(50%)·8916(70%)은 전부 오류(조특법30조엔 100/50% 없음, 8916은 차감소득금액 중간계산코드)로 제거.
  //    ★국세청 통합처리 실측확정(2026-07-24 캡처 #3): 8608(90%)에만 감면대상급여 입력해도 국세청이 감면세액을 8603·8608·8924(세액감면계)에 "동일 값 에코"(중복계상 아님, 계도 단일값).
  //      → 전송0인 8603에 NTS공제 값이 오는 건 통합처리 탓(우리 도구 영향 0: 8603/8608 공유컬럼이라 대조 일치, 팬텀행은 getTaxCutItems filterByInput로 숨김).
  { group: "세액감면", ntsCode: "8603", label: "조특법30조-중소기업취업 70%", ytsCol: "CUT_8603", resultCol: "RT_R_LAW_CLAUS30", valueKey: "useAmt", rule: "value", status: "확정", send: true, note: "IN=감면대상급여 FN_PAY_GET_WRK_NTAX(,'MAIN'/'SUB',,'T12') 합→CUT_8603. OUT self ↔ RT_R_LAW_CLAUS30. 2026-07-22 실측확정" },
  { group: "세액감면", ntsCode: "8608", label: "조특법30조-중소기업취업 90%", ytsCol: "CUT_8608", resultCol: "RT_R_LAW_CLAUS30", valueKey: "useAmt", rule: "value", status: "확정", send: true, note: "IN=감면대상급여 FN_PAY_GET_WRK_NTAX(,'MAIN'/'SUB',,'T13') 합→CUT_8608. OUT self ↔ RT_R_LAW_CLAUS30. 2026-07-22 실측확정(9명 원단위 일치)" },
  { group: "세액감면", ntsCode: "8606", label: "세액감면-조세조약(교직자)", ytsCol: "CUT_8606", resultCol: "RT_TAX_TREATY", valueKey: "useAmt", rule: "value", status: "추정", send: true, note: "IN=FN Txx T20 합(조세조약 교직자 감면대상급여)→CUT_8606. OUT self ↔ RT_TAX_TREATY. X2026 대상 0 미검증. 2026-07-22 원천확정" },

  // ── 세액공제: 자녀·출산입양 (인원) ─────────────────────────────────────────
  { group: "세액공제", ntsCode: "8790", label: "혼인세액공제",     ytsCol: "FAM_MRRG",            resultCol: "RT_MRRG", valueKey: "useAmt", rule: "flag",  status: "확정", send: true, note: "★국세청이 혼인 ddcAmt에 잔액 소진캡 독립적용(2026-07-25 실측: IN ddcAmt=500,000 → OUT 276,750 = 산출615,000−근로338,250). buildCompareBody 특수전송(incDdcNfpCnt=1 + ddcAmt=500,000 원본, 자격=FAM_MRRG>0=PAY_WRK_FMLY MRRG_TAX_SUB_YN 'Y'·배우자550-010 카운트). 원본전송→국세청이 소진 독립재현→YTS RT_MRRG(엔진캡)와 ③표 대조로 소진로직 교차검증. 구 RT_MRRG(소진후값) 전송 폐기: 검증 사각이었음" },
  { group: "세액공제", ntsCode: "8763", label: "자녀세액공제",  ytsCol: "RT_HWC_CNT",     resultCol: "RT_HWC_AMT",     valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, note: "★총인원(RT_HWC_CNT) 필수 전송. 8004~8009(유형별)만으론 8763=0 → 유형별+총인원 둘 다 있어야 산출(8~20세 조건이라 국세청이 직계비속 수만으론 미판단). 2026-07-17 실측 정정" },
  // ── 출산·입양(8761) = 소계형(카드8430·의료8726 동형): 순번별 8764~8766(개별 IN)을 국세청이 합산해 8761(소계 OUT)로 회신 ──
  //   ★8761 자체엔 값 전송 안 함 — 총인원(RT_PER_CHI_CNT) 전송은 국세청이 무시하는 잉여(2026-07-17 실측). 8761은 SUBTOTAL_CODES(소계코드)로만 존재.
  //   순번별 (PAY_WRK_FMLY.PER_CHI_YN 3/5/7 = 첫째/둘째/셋째, 모두 FMLY_RELN 550-050). 8761 소계 OUT ↔ YTS RT_PER_CHI_AMT 대조.
  { group: "세액공제", ntsCode: "8764", label: "출산입양-첫째",     ytsCol: "FAM_8764", resultCol: "RT_PER_CHI_AMT", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, outCode: "8761", note: "PER_CHI_YN=3(30만). OUT은 소계 8761에 합산. resultCol=소계 총액(카드 OTO_CARD_ETC·의료 RT_MEDI_AMT 동형)→ytsDdcMap[8761] 대조(국세청 소진캡 vs YTS 엔진캡, 2026-07-25)" },
  { group: "세액공제", ntsCode: "8765", label: "출산입양-둘째",     ytsCol: "FAM_8765", resultCol: "RT_PER_CHI_AMT", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, outCode: "8761", note: "PER_CHI_YN=5(50만). OUT은 소계 8761에 합산. resultCol=소계 총액" },
  { group: "세액공제", ntsCode: "8766", label: "출산입양-셋째이상", ytsCol: "FAM_8766", resultCol: "RT_PER_CHI_AMT", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, outCode: "8761", note: "PER_CHI_YN=7(70만). OUT은 소계 8761에 합산. resultCol=소계 총액" },

  // ── 세액공제: 보험료 (전송=공제대상금액 SPCL_*) ────────────────────────────
  { group: "세액공제", ntsCode: "8710", label: "보장성보험료",        ytsCol: "INS_GRT", resultCol: "RT_IF_GRT_INSU_AMT",      valueKey: "useAmt", rule: "value", status: "확정", send: true, note: "★원본 지출총액(PAY_WRK_FMLY_DTL SUM(GRT_INSU)→INS_GRT) 전송. 국세청이 100만 한도 self cap(2026-07-25 구분프로브 실측: useAmt=원본 20,191,680·ddcLmtAmt=0 전송→OUT 120,000=100만×12%, no-cap 2,423,002 아님) → NTS self OUT ddcAmt=12% ↔ RT_IF_GRT_INSU_AMT 원단위 일치. 원본전송으로 한도로직 교차검증. 구 SPCL_IF_GRT_INSU_AMT(100만 capped) 전송 폐기: 한도 검증 사각이었음" },
  { group: "세액공제", ntsCode: "8711", label: "장애인전용 보장성보험료", ytsCol: "INS_HDC", resultCol: "RT_IF_HDC_PERS_INSU_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, note: "★원본 지출총액(PAY_WRK_FMLY_DTL SUM(HDC_PERS_INSU)→INS_HDC) 전송. 국세청 100만 self cap(2026-07-25 실측: 원본 1,525,400→OUT 150,000=100만×15%) → NTS OUT ddcAmt=15% ↔ RT_IF_HDC_PERS_INSU_AMT 일치. 8710과 독립 self. 구 SPCL_IF capped 전송 폐기" },

  // ── 세액공제: 교육비 = 소계형(8735). ★국세청 서버는 구분(8730~34) 무시하고 ddcTrgtAmt×15%를 8735로 합산 ──
  //   한도(초중고300만/대학900만)는 국세청 화면이 적용해 ddcTrgtAmt(공제대상)를 만들고, 서버는 그대로 신뢰(재한도 없음).
  //   YTS는 구분별 한도후 값이 없고 한도후 총액(SPCL_EDU_AMT)만 있어, 대표코드 8730 한 칸에 총액을 ddcTrgtAmt로 몰아 전송.
  //   8735 는 결과전용(직접입력 무시) → SUBTOTAL_CODES 로만 표현. useAmt·ddcLmtAmt·인원은 서버 무시(2026-07-17 실측확정).
  { group: "세액공제", ntsCode: "8730", label: "교육비(공제대상 총액)", ytsCol: "SPCL_EDU_AMT", resultCol: "RT_EDU_AMT", valueKey: "ddcTrgtAmt", rule: "value", status: "확정", send: true, outCode: "8735", note: "국세청 8730(본인칸)에 교육비 공제대상 총액(SPCL_EDU_AMT, 한도적용후) 전송 → 서버 ×15% → 8735 소계 ↔ RT_EDU_AMT 대조. 8731~34(구분별)는 한도후 데이터 없어 미사용(서버 계산 구분 무관). resultCol=RT_EDU_AMT 는 소계(outCode 8735)의 YTS 공제액 연결용(카드 8431→8430 대칭) — 없으면 ytsDdcMap[8735] 미채움으로 소계 YTS공제 빈칸" },

  // ── 세액공제: 기타 ─────────────────────────────────────────────────────────
  // ── 기타세액공제(납세조합·주택차입금이자·외국납부) = self형(결과 ddcAmt). 원천=PAY_WRK_MAIN, useAmt 대상금액 전송 ──
  //   국세청 코드·필드·결과key 실측확정(2026-07-17, docs/hometax-capture + edu-rules-probe). ★X2026 대상자 0이라 원단위 미검증(첫 대상자 시 확인).
  { group: "기타세액공제", ntsCode: "8753", label: "납세조합공제",        ytsCol: "ETX_8753", resultCol: "RT_PTU", valueKey: "useAmt", rule: "value", status: "확정", send: true, note: "PAY_WRK_MAIN.ASSO_SUB_TAX_AMT(대상금액,'공제세액'名이나 실제 대상) → self ddcAmt ↔ RT_PTU. ddcLmtAmt 불필요(서버 자체계산)" },
  { group: "기타세액공제", ntsCode: "8752", label: "주택차입금이자상환액", ytsCol: "ETX_8752", resultCol: "RT_HBA", valueKey: "useAmt", rule: "value", status: "확정", send: true, note: "PAY_WRK_MAIN.HOUSE_ALR(이자상환액,대상) → self ddcAmt(=30%) ↔ RT_HBA. 부수 8906 농특세20%" },
  { group: "기타세액공제", ntsCode: "8751", label: "외국납부_국외납부세액",  ytsCol: "ETX_8751", resultCol: "RT_FCG", valueKey: "useAmt", rule: "value", status: "확정", send: true, note: "PAY_WRK_MAIN.FRGN_PAY_TAX(국외납부세액,대상) → self ddcAmt ↔ RT_FCG. ★8754(국외총급여) 동반 필수(없으면 결과0, 한도=산출세액×국외소득/총급여)" },
  { group: "세액공제", ntsCode: "8754", label: "외국납부_국외총급여",   ytsCol: "ETX_8754", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "—", note: "외국납부세액공제 한도계산용 동반입력. 자체 결과 없음. PAY_WRK_MAIN.FRGN_TOT_PAY_AMT" },
  { group: "세액공제", ntsCode: "8750", label: "월세액",           ytsCol: "RENT_8750",           resultCol: "RT_HOUSE_RENT_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, tab: "기타", note: "PAY_WRK_MAIN.HOUSE_RENT(원본 지급총액) 주입 — NTS가 한도·공제율 자체계산(2026-07-15 실측확정)" },


  // ── 세액공제: 의료비 — CALC_PROC_MEDI(JSON) 대상자별 "지출금액"을 MEDI_{코드} 가상컬럼으로 주입 ──
  //   NTS 8726(의료비집계)에 세액공제 총액 반환 → YTS 의료비_공제금액(=RT_MEDI_AMT)과 대조. (2026-07-12 실측확정)
  //   ★지출금액 전송(공제대상금액 아님) — NTS가 3% 최저사용액 차감 자체계산.
  { group: "의료비", ntsCode: "8720", label: "의료비-본인/65세이상/장애인", ytsCol: "MEDI_8720", resultCol: "RT_MEDI_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8726" },
  { group: "의료비", ntsCode: "8721", label: "의료비-그밖의 공제대상자",   ytsCol: "MEDI_8721", resultCol: "RT_MEDI_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8726" },
  { group: "의료비", ntsCode: "8725", label: "의료비-난임시술비",          ytsCol: "MEDI_8725", resultCol: "RT_MEDI_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8726" },
  { group: "의료비", ntsCode: "8729", label: "의료비-미숙아·선천성이상아", ytsCol: "MEDI_8729", resultCol: "RT_MEDI_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8726" },

  // ── 기부금 당해분 (PAY_WRK_GIFT → GIFT_{코드} 가상컬럼으로 주입) ──
  { group: "기부금", ntsCode: "8740", label: "정치자금기부금",    ytsCol: "GIFT_8740", valueKey: "useAmt", rule: "value", status: "확정", send: true,  note: "전액 8740 전송 → NTS가 10만 이하/초과 자동분리(8741 별도전송 금지). OUT self 8740=전체공제액(10만이하 100/110+초과 15%), 8741=10만이하 소계. 실측확정 2026-07-16" },
  { group: "기부금", ntsCode: "8783", label: "고향사랑기부금(일반)",       ytsCol: "GIFT_8783", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8784", label: "고향사랑기부금(특별재난)",   ytsCol: "GIFT_8784", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8743", label: "특례(법정)기부금",           ytsCol: "GIFT_8743", resultCol: "RT_DON_LAW",    valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8744", label: "우리사주조합 기부금",        ytsCol: "GIFT_8744", resultCol: "RT_STOCK_URSM", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8746", label: "일반기부금-종교단체",        ytsCol: "GIFT_8746", resultCol: "RT_PSA_RELGN",  valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8747", label: "일반기부금-종교단체 외",     ytsCol: "GIFT_8747", resultCol: "RT_PSA",         valueKey: "useAmt", rule: "value", status: "확정", send: true },
  // ── 기부금 이월분 (PAY_WRK_GIFT_ADJ → GIFT_{코드} 가상컬럼으로 주입) ──
  { group: "기부금", ntsCode: "8811", label: "특례기부금 이월(-1년)",       ytsCol: "GIFT_8811", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8812", label: "특례기부금 이월(-2년)",       ytsCol: "GIFT_8812", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8813", label: "특례기부금 이월(-3년)",       ytsCol: "GIFT_8813", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8814", label: "특례기부금 이월(-4년)",       ytsCol: "GIFT_8814", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8815", label: "특례기부금 이월(-5년)",       ytsCol: "GIFT_8815", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8821", label: "일반기부금(종교) 이월(-1년)",  ytsCol: "GIFT_8821", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8822", label: "일반기부금(종교) 이월(-2년)",  ytsCol: "GIFT_8822", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8823", label: "일반기부금(종교) 이월(-3년)",  ytsCol: "GIFT_8823", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8824", label: "일반기부금(종교) 이월(-4년)",  ytsCol: "GIFT_8824", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8825", label: "일반기부금(종교) 이월(-5년)",  ytsCol: "GIFT_8825", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8831", label: "일반기부금(종교외) 이월(-1년)", ytsCol: "GIFT_8831", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8832", label: "일반기부금(종교외) 이월(-2년)", ytsCol: "GIFT_8832", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8833", label: "일반기부금(종교외) 이월(-3년)", ytsCol: "GIFT_8833", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8834", label: "일반기부금(종교외) 이월(-4년)", ytsCol: "GIFT_8834", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "기부금", ntsCode: "8835", label: "일반기부금(종교외) 이월(-5년)", ytsCol: "GIFT_8835", valueKey: "useAmt", rule: "value", status: "확정", send: true },

  // ── 세액공제: 연금계좌 — PAY_WRK_PEN_SAVE_SPEC 납입액(PEN_SAVE_PMT_AMT)을 PEN_{코드} 가상컬럼으로 주입 ──
  //   PEN_SAVE_CLS→코드 매핑(mapping/pension.ts). 각 연금계좌 코드로 납입액 전송·항목별 self 대조. (2026-07-12 실측확정)
  //   ★납입액 전송(공제대상 아님) — NTS가 한도·공제율 자체계산. ISA도 전환액 원본이라 ×10 불필요.
  //   OUT = 각 code self ddcAmt(항목별 공제금액, 실측확정 2026-07-15). 국세청이 한도·공제율(12%) 자체계산.
  //   집계 OUT 8705(ISA합)·8706(총합)은 국세청이 별도로도 반환(IN 없는 결과전용) — 카탈로그 반영 예정.
  { group: "연금계좌", ntsCode: "8701", label: "연금계좌-과학기술인",   ytsCol: "PEN_8701", resultCol: "RT_RSIGN_PEN_TECH_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8701" },
  { group: "연금계좌", ntsCode: "8702", label: "연금계좌-IRP퇴직급여",  ytsCol: "PEN_8702", resultCol: "RT_RSIGN_PEN_RET_AMT",  valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8702" },
  { group: "연금계좌", ntsCode: "8703", label: "연금계좌-연금저축",     ytsCol: "PEN_8703", resultCol: "RT_RSIGN_PEN_PF_AMT",   valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8703" },
  // ISA(8707/8708)는 IN은 코드별 전송(각 계좌 납입액), OUT은 국세청이 코드별 ddcAmt + 소계 8705(ISA합)를 함께 반환.
  //   ★YTS는 ISA 세액공제를 RT_ISA_PEN_AMT 단일(합산)컬럼으로만 보관 → ③표 per-code 대조 불가(둘 다 non-zero면
  //   8707/8708 각각 합산값과 비교돼 오탐). 그래서 소계 8705에서만 대조(카드8430·의료8726 동형). outCode=8705.
  //   (2026-07-26 이중케이스 X202600349 실측: 8707=88,429·8708=163,002·8705=251,431=합, 계좌별 한도 9M/6M 독립)
  { group: "연금계좌", ntsCode: "8707", label: "ISA만기-퇴직연금계좌 추가납입", ytsCol: "PEN_8707", resultCol: "RT_ISA_PEN_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8705" },
  { group: "연금계좌", ntsCode: "8708", label: "ISA만기-연금저축계좌 추가납입", ytsCol: "PEN_8708", resultCol: "RT_ISA_PEN_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8705" },


]

/**
 * ── 검증 커버리지 맵 (2026 = 2025 복사) ───────────────────────────────────────
 * 판정 원리·review 규약은 2025.ts COVERAGE_2025 헤더 참조. 2026 실데이터 대조 후 review 승격.
 */
export const COVERAGE_2026: Record<string, Coverage> = {
  // 기본입력
  "8900": { verdict: "해당없음", review: "확정" },   // 총급여(계산 기본입력, 공제 아님)
  // 인적공제 — 인원/정액 전송, 국세청 서버가 공제액(인원×정액) 계산
  "8001": { verdict: "안전", review: "검토중" }, "8002": { verdict: "안전", review: "검토중" }, "8003": { verdict: "안전", review: "검토중" },
  "8004": { verdict: "안전", review: "검토중" }, "8005": { verdict: "안전", review: "검토중" }, "8006": { verdict: "안전", review: "검토중" },
  "8007": { verdict: "안전", review: "검토중" }, "8008": { verdict: "안전", review: "검토중" }, "8009": { verdict: "안전", review: "검토중" },
  "8101": { verdict: "안전", review: "검토중" }, "8102": { verdict: "안전", review: "검토중" }, "8103": { verdict: "안전", review: "검토중" }, "8104": { verdict: "안전", review: "검토중" },
  // 연금보험료 — _OBJ_AMT(캡 전) 전송, 국세청이 근로소득금액 잔액소진 재현
  "8201": { verdict: "안전", review: "검토중" }, "8205": { verdict: "안전", review: "검토중" }, "8208": { verdict: "안전", review: "검토중" }, "8211": { verdict: "안전", review: "검토중" }, "8215": { verdict: "안전", review: "검토중" },
  // 특별소득공제 — 건보/고용 _OBJ_AMT(캡 전) 전송
  "8301": { verdict: "안전", review: "검토중" }, "8305": { verdict: "안전", review: "검토중" },
  // 주택자금 — LOAN_ 원본 상환액 전송, 국세청 한도 재현
  "8311": { verdict: "안전", review: "검토중" }, "8312": { verdict: "안전", review: "검토중" },
  "8321": { verdict: "안전", review: "검토중" }, "8322": { verdict: "안전", review: "검토중" }, "8323": { verdict: "안전", review: "검토중" },
  "8324": { verdict: "안전", review: "검토중" }, "8325": { verdict: "안전", review: "검토중" }, "8326": { verdict: "안전", review: "검토중" },
  "8327": { verdict: "안전", review: "검토중" }, "8328": { verdict: "안전", review: "검토중" }, "8329": { verdict: "안전", review: "검토중" },
  // 그밖의소득공제
  "8401": { verdict: "미검증", review: "검토중" },   // 원본 납입이나 한도캡(납입>180만) 시 국세청 자체캡 미실측(note)
  "8402": { verdict: "미검증", review: "검토중" },   // 원본 납입이나 소득금액별 한도캡 미실측(note)
  "8403": { verdict: "안전", review: "검토중" }, "8407": { verdict: "안전", review: "검토중" }, "8404": { verdict: "안전", review: "검토중" },   // 주택마련저축 ×40% 실측
  "8415": { verdict: "안전", review: "검토중" }, "8416": { verdict: "안전", review: "검토중" }, "8417": { verdict: "안전", review: "검토중" },
  "8418": { verdict: "안전", review: "검토중" }, "8419": { verdict: "안전", review: "검토중" }, "8420": { verdict: "안전", review: "검토중" },
  "8421": { verdict: "안전", review: "검토중" }, "8422": { verdict: "안전", review: "검토중" }, "8423": { verdict: "안전", review: "검토중" },   // 투자조합출자
  "8410": { verdict: "해당없음", review: "검토중" },   // 투자조합 소계(결과전용, send:false)
  "8431": { verdict: "안전", review: "확정" }, "8432": { verdict: "안전", review: "확정" }, "8433": { verdict: "안전", review: "확정" },
  "8434": { verdict: "안전", review: "확정" }, "8435": { verdict: "안전", review: "확정" },
  "8461": { verdict: "안전", review: "확정" }, "8462": { verdict: "안전", review: "확정" }, "8463": { verdict: "안전", review: "확정" },   // 신용카드 원본 지출(PAY_WRK_FMLY_DTL SUM, 로직A無)→국세청 소계 8430 자체계산. SQL SUM↔CALC_PROC_CARD↔8430 원단위 일치 확인(2026-07-31)
  "8452": { verdict: "미검증", review: "검토중" }, "8451": { verdict: "미검증", review: "검토중" }, "8501": { verdict: "미검증", review: "검토중" }, "8453": { verdict: "미검증", review: "검토중" },   // 실데이터 0명(대상 미발생)
  // 세액감면 — 감면대상급여(원본) 전송, 국세청이 감면세액 자동계산
  "8603": { verdict: "안전", review: "검토중" }, "8608": { verdict: "안전", review: "검토중" },   // 조특법30조, 9명 원단위 검증
  "8601": { verdict: "미검증", review: "검토중" }, "8602": { verdict: "미검증", review: "검토중" }, "8612": { verdict: "미검증", review: "검토중" },
  "8609": { verdict: "미검증", review: "검토중" }, "8611": { verdict: "미검증", review: "검토중" }, "8617": { verdict: "미검증", review: "검토중" },
  "8610": { verdict: "미검증", review: "검토중" }, "8616": { verdict: "미검증", review: "검토중" }, "8614": { verdict: "미검증", review: "검토중" }, "8606": { verdict: "미검증", review: "검토중" },   // status 추정·대상 0명
  // 세액공제
  "8790": { verdict: "안전", review: "검토중" },   // 혼인 원본 500,000, 국세청 잔액소진캡 실측(2026-07-25)
  "8763": { verdict: "안전", review: "검토중" },   // 자녀(인원+총인원)
  "8764": { verdict: "안전", review: "검토중" }, "8765": { verdict: "안전", review: "검토중" }, "8766": { verdict: "안전", review: "검토중" },   // 출산입양
  "8710": { verdict: "안전", review: "검토중" }, "8711": { verdict: "안전", review: "검토중" },   // 보험료 원본 지출총액, 100만 self cap 교차검증(2026-07-27)
  "8730": { verdict: "사각", review: "검토중" },   // ★교육비: 한도후 중간값(SPCL_EDU_AMT) 전송 → 국세청 ×15%만, 한도(초중고300/대학900)는 화면JS → 한도로직 사각
  "8751": { verdict: "미검증", review: "검토중" }, "8752": { verdict: "미검증", review: "검토중" }, "8753": { verdict: "미검증", review: "검토중" },   // 기타세액공제 대상 0명
  "8754": { verdict: "해당없음", review: "검토중" },   // 외국납부 국외총급여(한도계산용 동반입력, 자체결과 없음)
  "8750": { verdict: "안전", review: "검토중" },   // 월세 원본 지급총액, 국세청 한도·율 자체계산
  // 의료비 — ★유형별 집계(3%·실손차감 후) 전송 → 국세청 서버는 로직A 재현 안 함(화면JS) → 사각(화면구동 검증 필요)
  // ★2026-08-01 fmly_dtl 독립 재집계(대조a)로 집계·실손 사각 메움 + 3%·율은 국세청 재현(대조b) → 안전 승격
  "8720": { verdict: "안전", review: "확정" }, "8721": { verdict: "안전", review: "확정" }, "8725": { verdict: "안전", review: "확정" }, "8729": { verdict: "안전", review: "확정" },
  // 기부금 — 원본(공제가능액) 전송, 국세청이 한도·tiered율·이월 건별 재현(커버리지 모범 케이스)
  "8740": { verdict: "안전", review: "확정" }, "8783": { verdict: "안전", review: "확정" }, "8784": { verdict: "안전", review: "확정" },
  "8743": { verdict: "안전", review: "확정" }, "8744": { verdict: "안전", review: "확정" }, "8746": { verdict: "안전", review: "확정" }, "8747": { verdict: "안전", review: "확정" },
  "8811": { verdict: "안전", review: "확정" }, "8812": { verdict: "안전", review: "확정" }, "8813": { verdict: "안전", review: "확정" }, "8814": { verdict: "안전", review: "확정" }, "8815": { verdict: "안전", review: "확정" },
  "8821": { verdict: "안전", review: "확정" }, "8822": { verdict: "안전", review: "확정" }, "8823": { verdict: "안전", review: "확정" }, "8824": { verdict: "안전", review: "확정" }, "8825": { verdict: "안전", review: "확정" },
  "8831": { verdict: "안전", review: "확정" }, "8832": { verdict: "안전", review: "확정" }, "8833": { verdict: "안전", review: "확정" }, "8834": { verdict: "안전", review: "확정" }, "8835": { verdict: "안전", review: "확정" },
  // 연금계좌 — 납입액(원본) 전송, 국세청이 한도·율 자체계산(ISA도 전환액 원본)
  "8701": { verdict: "안전", review: "검토중" }, "8702": { verdict: "안전", review: "검토중" }, "8703": { verdict: "안전", review: "검토중" },
  "8707": { verdict: "안전", review: "검토중" }, "8708": { verdict: "안전", review: "검토중" },
}

/** L03 응답 계산흐름 표시용 결과코드(2026 = 2025 복사) — 입력 아님, 파싱/추적용 */
export const NTS_RESULT_CODES_2026: { code: string; label: string }[] = [
  { code: "8900", label: "총급여" },
  { code: "8901", label: "근로소득공제" },
  { code: "8902", label: "근로소득금액" },
  { code: "8903", label: "종합소득 과세표준" },
  { code: "8990", label: "산출세액" },
  { code: "8700", label: "근로소득세액공제" },
  { code: "8999", label: "결정세액" },
]

/**
 * 계산과정(CALC_PROC_TOTAL) 라벨 → NTS 코드(2026 = 2025 복사, 등장 순서대로).
 * 목적·규약은 2025.ts PROC_LABEL_CODE_2025 헤더 참조. 2026 계산과정 실측(proc-order-probe)으로 라벨변화만 갱신.
 */
export const PROC_LABEL_CODE_2026: Record<string, string> = {
  // 소득공제 — 인적공제
  "본인": "8001", "배우자": "8002", "부양가족": "8003",
  "경로우대": "8101", "장애인": "8102", "부녀자": "8103", "한부모가족": "8104",
  // 소득공제 — 연금보험료
  "국민연금": "8201", "공무원연금": "8205", "군인연금": "8208", "사학연금": "8211", "우체국연금": "8215",
  // 소득공제 — 특별소득공제(건강/고용/주택자금)
  "건강보험료": "8301", "고용보험료": "8305",
  "주택임차차입금원리금상환액(대출기관)": "8311", "주택임차차입금원리금상환액(거주자)": "8312",
  "2011년이전:상환15년미만": "8321", "2011년이전:상환15년∼29년": "8322", "2011년이전:상환30년이상": "8323",
  "2011년이전(15년이상):고정and비거치식": "8324", "2011년이전(15년이상):고정or비거치식": "8325",
  "2012년이후(15년이상):고정and비거치": "8326", "2012년이후(15년이상):고정or비거치": "8327",
  "2012년이후(15년이상):그밖의대출": "8328", "2012년이후(10년∼15년):고정or비거치": "8329",
  // 소득공제 — 그밖의소득공제
  "개인연금저축": "8401", "소기업·소상공인공제부금": "8402",
  "청약저축": "8403", "주택청약종합저축": "8407", "근로자주택마련저축": "8404",
  "투자조합출자등": "8410",   // 소계형(개별 8415~8423 → 소계 8410)
  "신용카드등": "8430",       // 소계형(개별 8431~8463 → 소계 8430)
  "우리사주조합출연금": "8452", "고용유지중소기업근로자": "8453",
  "장기집합투자증권저축공제": "8451", "청년형장기집합투자증권저축": "8501",
  // 세액감면
  "소득세법": "8601", "조특법(30조)": "8608", "조특법(30조제외)": "8602", "조세조약": "8606",  // 조특법30조 대표=8608(90%, 흔함), 70%=8603. 계산과정 "조특법(30조)"=RT_R_LAW_CLAUS30 합
  // 세액공제
  "근로소득세액": "8700", "혼인세액공제": "8790", "자녀": "8763", "출산입양": "8761",
  "보장성보험료": "8710", "장애인전용보험료": "8711",
  "의료비": "8726",   // 소계형(개별 8720/8721/8725/8729 → 소계 8726)
  "교육비": "8735",   // 소계형(개별 8730 → 결과 소계 8735). 카드8430·의료8726과 같은 소계코드 규약
  "정치자금기부금-10만원이하": "8741", "정치자금기부금-10만원초과": "8740",  // ※8741=10만이하소계 추정, self대조는 8740
  "고향사랑기부금-10만원이하(일반+특별)": "8783", "고향사랑기부금-10만원초과(특별)": "8784", "고향사랑기부금-10만원초과(일반)": "8783",  // ※금액대 vs 일반/특별 축 불일치, 앵커용 추정
  "납세조합공제": "8753", "주택차입금이자상환액": "8752", "월세액": "8750",
  "특례기부금": "8743", "우리사주조합기부금": "8744",
  "일반기부금(종교단체외)": "8747", "일반기부금(종교단체)": "8746",
  "외국납부": "8751",
  // 세액공제 — 연금계좌
  "과학기술인공제회법": "8701", "근로자퇴직급여보장법": "8702", "연금저축": "8703",
  "ISA연금계좌납입액": "8705",  // ISA합 소계(8707/8708 멤버). 계산과정은 ISA 한 줄 → 소계코드 8705에 앵커(2026-07-26 실측)
}

/** 혼인세액공제 법정 정액(2026 = 2025 동일, 50만). */
export const MARRIAGE_CREDIT_2026 = 500000
