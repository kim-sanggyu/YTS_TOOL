/**
 * YTS39 ↔ 국세청(NTS) 연말정산 자동계산 매핑표 — 2025 귀속 (단일 원천 / source of truth)
 *
 * ▶ 목적: 우리 세액계산 SW(YTS39) 검증을 위해, YTS39 공제값을 국세청 L03 계산엔진에
 *   "정확히·투명하게" 매치해 보내기 위한 유일한 정의. 전송로직·상세뷰·미전송경고가
 *   모두 이 표 하나에서 파생된다. (docs/hometax-yts-mapping-2025.md 는 사람이 읽는 근거문서)
 *
 * ▶ 매년 관리: 직전연도 파일을 복사(2026.ts) 후 diff 로만 갱신. 확정된 행은 그대로 두고
 *   세법개정으로 바뀐 행만 손댄다. 조용한 오염 방지 = status/ send 가 현실을 그대로 비추게 유지.
 *
 * ▶ 스키마
 *   - ntsCode  : 국세청 amtClusCd (8xxx)
 *   - ytsCol   : NTS 로 "보낼 값"의 원천 YTS39 컬럼.
 *                · 소득공제(연금·보험·주택 등) = 납입액(_AMT)
 *                · 세액공제(의료·교육·기부·보장성 등) = **공제대상금액(SPCL_ 계열 / _OBJ_AMT)**
 *                  (NTS 가 공제율·한도를 자기가 계산하므로 최종 공제액이 아니라 대상금액을 넣는다)
 *                · const1(본인 등) = null
 *   - resultCol: YTS39 가 계산해 보관하는 "공제액" 컬럼(RT_*). 전송엔 안 쓰고 결과대사·감사에 참고.
 *   - valueKey : 채울 NTS 필드 (useAmt 금액 / incDdcNfpCnt 인원 / ddcTrgtAmt 교육비대상)
 *   - rule     : value(값 그대로) | flag(값>0 이면 1) | const1(항상 1)
 *   - status   : 확정(검증·직접확인) | 추정(코드범위·정황) | 미확보(코드/컬럼 미확정)
 *   - send     : 현재 L03 전송에 실제로 배선됨. **지금은 검증된 13개만 true.**
 *                (전송 확대 = 이 값을 의도적으로 flip + 대조검증하는 별도 작업)
 *   - note     : 1:N 분할·재확인 필요 등 주의
 */

export type MappingStatus = "확정" | "추정" | "미확보"
export type ValueKey = "useAmt" | "incDdcNfpCnt" | "ddcTrgtAmt"
export type SendRule = "value" | "flag" | "const1"

export interface MappingRow {
  group:     string
  ntsCode:   string
  label:     string
  ytsCol:    string | null
  resultCol?: string
  valueKey:  ValueKey
  rule:      SendRule
  status:    MappingStatus
  send:      boolean
  /** 전용 비교탭 소속(예 "기타") — 잡다한 단일 세액공제 항목을 한 탭에 모을 때. 미지정=탭 없음. */
  tab?:      string
  /** 국세청 결과(OUT) 코드. 소계형만 명시(카드8430/의료8726/연금8706).
   *  미지정 = 세액공제성 그룹이면 self(ntsCode), 소득공제·입력이면 없음(—). */
  outCode?:  string
  /** 실제 국세청 "입력" 코드가 표시코드(ntsCode)와 다를 때만 지정. L03 전송은 sendCode 로.
   *  예: 주택청약종합저축은 화면·대조는 8405 이나 계산입력은 8407(숨은 입력코드, 실측확정). */
  sendCode?: string
  /** 상대 귀속연도(투자조합출자 등 연도별 코드). 현황탭이 입력연도(ntsYear)+offset 로 "○○○○년" 렌더. 0=당해,-1=직전,-2=2년전 */
  yearOffset?: number
  note?:     string
}

export const MAPPING_2025: MappingRow[] = [
  // ── 총급여 / 기납부 (계산 기본입력) ─────────────────────────────────────────
  { group: "기본입력", ntsCode: "8900", label: "총급여",       ytsCol: "TOT_PAY_AMT",   valueKey: "useAmt", rule: "value",  status: "추정", send: true },
  { group: "기본입력", ntsCode: "8991", label: "기납부세액",   ytsCol: "PAYM_INCM_TAX", valueKey: "useAmt", rule: "value",  status: "추정", send: true },

  // ── 인적공제 (인원, incDdcNfpCnt) ──────────────────────────────────────────
  { group: "인적공제", ntsCode: "8001", label: "기본공제-본인",     ytsCol: null,                  resultCol: "BASC_SUB_SELF_AMT",  valueKey: "incDdcNfpCnt", rule: "const1", status: "확정", send: true, note: "self ddcAmt=1,500,000(본인 150만). 인원(incDdcNfpCnt=1) 전송. 라이브 payload 캡처 실측(capture-io 2026-07-18, n=38)" },
  { group: "인적공제", ntsCode: "8002", label: "기본공제-배우자",   ytsCol: "BASC_SUB_MATE_AMT",   valueKey: "incDdcNfpCnt", rule: "flag",   status: "확정", send: true, note: "self ddcAmt=1,500,000(150만). 인원(flag→1) 전송. 라이브 payload 캡처 실측(2026-07-18, n=38)" },
  { group: "인적공제", ntsCode: "8003", label: "기본공제-부양가족(통합)", ytsCol: "BASC_SUB_FAMILY_CNT", valueKey: "incDdcNfpCnt", rule: "value",  status: "확정", send: false, note: "국세청은 8004~8009 유형별로 받음 → 미전송(2026-07-16 실측)" },
  // 부양가족 유형별 (PAY_WRK_FMLY.FMLY_RELN 집계 → FAM_{코드} 가상컬럼) = 부양가족 인적공제.
  //   ※자녀공제(8763)는 유형별만으론 산출 안 됨(별도 총인원 필요). 출산입양(8761)은 순번별 8764~66이 산출. (2026-07-17 실측)
  { group: "인적공제", ntsCode: "8004", label: "부양가족-직계존속",              ytsCol: "FAM_8004", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, note: "FMLY_RELN 550-020(소득자 직계존속)+550-030(배우자 직계존속)" },
  { group: "인적공제", ntsCode: "8005", label: "부양가족-직계비속(자녀·손자녀·입양)", ytsCol: "FAM_8005", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, note: "FMLY_RELN 550-050" },
  { group: "인적공제", ntsCode: "8006", label: "부양가족-직계비속 그외",          ytsCol: "FAM_8006", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, note: "FMLY_RELN 550-055" },
  { group: "인적공제", ntsCode: "8007", label: "부양가족-형제자매",              ytsCol: "FAM_8007", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, note: "FMLY_RELN 550-060" },
  { group: "인적공제", ntsCode: "8008", label: "부양가족-수급자",                ytsCol: "FAM_8008", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, note: "FMLY_RELN 550-070" },
  { group: "인적공제", ntsCode: "8009", label: "부양가족-위탁아동",              ytsCol: "FAM_8009", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, note: "FMLY_RELN 550-080" },
  { group: "인적공제", ntsCode: "8101", label: "추가공제-경로우대", ytsCol: "ADD_SUB_OAT_CNT",     resultCol: "ADD_SUB_OAT_AMT",      valueKey: "incDdcNfpCnt", rule: "value",  status: "확정", send: true, note: "self ddcAmt=인원×100만. 인원(ADD_SUB_OAT_CNT) 전송, 결과대조=ADD_SUB_OAT_AMT. 라이브 캡처 실측(2026-07-18, n=38, 1명→1,000,000)" },
  { group: "인적공제", ntsCode: "8102", label: "추가공제-장애인",   ytsCol: "ADD_SUB_HDC_PERS_CNT",resultCol: "ADD_SUB_HDC_PERS_AMT", valueKey: "incDdcNfpCnt", rule: "value",  status: "확정", send: true, note: "self ddcAmt=인원×200만. 인원(ADD_SUB_HDC_PERS_CNT) 전송, 결과대조=ADD_SUB_HDC_PERS_AMT. 라이브 캡처 실측(2026-07-18, n=38, 2명→4,000,000)" },
  { group: "인적공제", ntsCode: "8103", label: "추가공제-부녀자",   ytsCol: "ADD_SUB_LADY_AMT",    valueKey: "incDdcNfpCnt", rule: "flag",   status: "확정", send: true, note: "self ddcAmt=500,000(50만). 인원(flag→1) 전송. 라이브 캡처 실측(2026-07-18, n=56, 배우자없음+직계비속0+부녀자로 격리 — 한부모(8104)와 배타관계)" },
  { group: "인적공제", ntsCode: "8104", label: "추가공제-한부모",   ytsCol: "ADD_SUB_SNGL_PRNT_AMT",valueKey: "incDdcNfpCnt", rule: "flag",  status: "확정", send: true, note: "self ddcAmt=1,000,000(100만). 인원(flag→1) 전송. 라이브 캡처 실측(2026-07-18, n=46/47, 배우자없음+직계비속 → 한부모 자동 적용)" },

  // ── 연금보험료공제 (소득공제, useAmt) — 전액공제(OUT ddcAmt=useAmt), 소계 OUT=8919 ──
  //   대상금액(_AMT) 전송 → NTS self ddcAmt 전액 회신. *_OBJ_AMT(공제대상)=*_AMT 동일값.
  //   코드·필드·OUT 라이브 캡처 실측확정(capture-io 2026-07-18, n=2). ytsCol DB코멘트 대조 일치.
  { group: "연금보험료", ntsCode: "8201", label: "국민연금",       ytsCol: "NP_INSU_AMT",        valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "연금보험료", ntsCode: "8205", label: "공무원연금",     ytsCol: "ETC_PEN_PUBL_AMT",   valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "연금보험료", ntsCode: "8208", label: "군인연금",       ytsCol: "ETC_PEN_MLTARY_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "연금보험료", ntsCode: "8211", label: "사립학교교직원연금", ytsCol: "ETC_PEN_SCHL_AMT",valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "연금보험료", ntsCode: "8215", label: "별정우체국연금", ytsCol: "ETC_PEN_POST_AMT",   valueKey: "useAmt", rule: "value", status: "확정", send: true },

  // ── 특별소득공제 (useAmt) ──────────────────────────────────────────────────
  //   보험료공제(건강·고용)는 전액공제(OUT ddcAmt=useAmt), 소계 OUT=8920. *_OBJ_AMT(대상)=*_AMT 동일값.
  //   코드·필드·OUT 라이브 캡처 실측확정(capture-io 2026-07-18). ytsCol DB코멘트 대조 일치.
  { group: "특별소득공제", ntsCode: "8301", label: "건강보험료",   ytsCol: "SPCL_IF_HLTH_INSU_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8305", label: "고용보험료",   ytsCol: "SPCL_IF_EMP_INSU_AMT",  valueKey: "useAmt", rule: "value", status: "확정", send: true },
  // ── 주택자금(특별소득공제) — 한도 있어 원본 상환액(PAY_WRK_MAIN) LOAN_{코드} 주입 전송, NTS 한도로직 검증. ──
  //   대조 공제액 = SP_*_AMT(한도후). 코드↔YTS컬럼 순서 실측·상규님 확정(capture-io 2026-07-18, 8321~8329 = LRSF1/2/3/10/20/30/40/50/60).
  //   소계 OUT: 8310(원리금 소계)·8320(장기주택저당 소계). 전용 탭 없음(전체 결정세액 비교에 기여).
  { group: "특별소득공제", ntsCode: "8311", label: "주택임차 원리금-대출기관",       ytsCol: "LOAN_8311", resultCol: "SP_HOUSE_RALR_LENDER_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8312", label: "주택임차 원리금-거주자",         ytsCol: "LOAN_8312", resultCol: "SP_HOUSE_RALR_HABT_AMT",   valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8321", label: "장기주택저당 2011이전 15년미만(600만)",        ytsCol: "LOAN_8321", resultCol: "SP_LH_LRSF1_AMT",  valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8322", label: "장기주택저당 2011이전 15~29년(1000만)",        ytsCol: "LOAN_8322", resultCol: "SP_LH_LRSF2_AMT",  valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8323", label: "장기주택저당 2011이전 30년이상(1500만)",        ytsCol: "LOAN_8323", resultCol: "SP_LH_LRSF3_AMT",  valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8324", label: "장기주택저당 2012이후 15년이상 고정&비거치(2000만)", ytsCol: "LOAN_8324", resultCol: "SP_LH_LRSF10_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8325", label: "장기주택저당 2012이후 15년이상 그밖",              ytsCol: "LOAN_8325", resultCol: "SP_LH_LRSF20_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8326", label: "장기주택저당 2015이후 15년이상 고정&비거치(2000만)", ytsCol: "LOAN_8326", resultCol: "SP_LH_LRSF30_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8327", label: "장기주택저당 2015이후 15년이상 고정or비거치(1800만)", ytsCol: "LOAN_8327", resultCol: "SP_LH_LRSF40_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8328", label: "장기주택저당 2015이후 15년이상 그밖(800만)",         ytsCol: "LOAN_8328", resultCol: "SP_LH_LRSF50_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8329", label: "장기주택저당 2015이후 10~15년(600만)",             ytsCol: "LOAN_8329", resultCol: "SP_LH_LRSF60_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },

  // ── 그밖의 소득공제 (useAmt) — 국세청 화면(그밖의소득공제 상세팝업) 기준 정리 (2026-07-17 화면·payload 실측) ──
  { group: "그밖의소득공제", ntsCode: "8401", label: "개인연금저축",              ytsCol: "OTHER_8401", resultCol: "OTO_PPF", valueKey: "useAmt", rule: "value", status: "확정", send: true, tab: "기타", note: "IN=PAY_WRK_PEN_SAVE_SPEC PEN_SAVE_CLS='562-030' ΣPEN_SAVE_PMT_AMT(납입액 원본) → OTHER_8401 주입. OUT self ddcAmt=납입액×40%(한도72만) ↔ OTO_PPF. 라이브 캡처 실측(2026-07-18, 1,000,000→400,000). ★한도캡(납입>180만) 시 ddcLmtAmt 없이 NTS 자체캡 여부 미검증" },
  { group: "그밖의소득공제", ntsCode: "8402", label: "소기업소상공인", ytsCol: "OTHER_8402", resultCol: "OTO_SM_ETPR_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, tab: "기타", note: "IN=PAY_WRK_MAIN.SM_ETPR_AMT(납입액 원본) → OTHER_8402 주입. OUT self ddcAmt=min(납입액, 소득금액별한도 600/500/400/200만) ↔ OTO_SM_ETPR_AMT. 라이브 캡처 실측(2026-07-18, 1,000,000→1,000,000). ★한도캡 시 ddcLmtAmt 없이 NTS 자체캡 여부 미검증" },
  // 주택마련저축 = PAY_WRK_PEN_SAVE_SPEC 납입액(CLS별) → OTHER_ 주입. OUT self ddcAmt=납입액×40%(한도). 라이브 캡처 실측(2026-07-18).
  //   ★8407은 국세청 UI가 주택청약종합저축을 8405와 함께 미러로 써넣지만 과세표준엔 8405만 계상(검산확정) → 우리는 8405만 전송.
  { group: "그밖의소득공제", ntsCode: "8403", label: "청약저축",                ytsCol: "OTHER_8403", resultCol: "OTO_HOUSE_LOAN_SBSC_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, note: "IN=PEN_SAVE_SPEC CLS 562-050 Σ납입액→OTHER_8403. OUT ×40% ↔ OTO_HOUSE_LOAN_SBSC_AMT. 실측(2026-07-18, 1,000,000→400,000)" },
  { group: "그밖의소득공제", ntsCode: "8405", label: "주택청약종합저축",          ytsCol: "OTHER_8405", resultCol: "OTO_HOUSE_LOAN_ALL_AMT", sendCode: "8407", valueKey: "useAmt", rule: "value", status: "확정", send: true, note: "IN=PEN_SAVE_SPEC CLS 562-060 Σ납입액→OTHER_8405. ★국세청 실제 입력코드는 8407(화면·대조는 8405, 8405로 보내면 OUT=0). sendCode=8407 로 전송→NTS가 8405·8407 둘 다 결과회신(과표 1회). OUT ×40% ↔ OTO_HOUSE_LOAN_ALL_AMT. 프로브 판별(hometax-housingsavings-probe, 2026-07-18)" },
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
  { group: "그밖의소득공제", ntsCode: "8410", label: "투자조합출자 소계", ytsCol: "OTO_IU_ETC", valueKey: "useAmt", rule: "value", status: "확정", send: false, note: "투자조합출자 소계 OUT(개별 8415~8423 합). 대조 Σ PEN_SAVE_SUB_AMT. 실측확정(2026-07-18)" },
  // 신용카드 등 — CALC_PROC_CARD(JSON) 가~아를 CARD_{코드} 가상컬럼으로 주입 (route.injectCardVals).
  //   NTS 8430(카드소계)에 총공제 반환 → YTS 최종공제금액(=OTO_CARD_ETC)과 대조. (2026-07-12 실측확정)
  { group: "그밖의소득공제(신용카드)", ntsCode: "8431", label: "신용카드",       ytsCol: "CARD_8431", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "그밖의소득공제(신용카드)", ntsCode: "8432", label: "직불·선불카드",  ytsCol: "CARD_8432", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "그밖의소득공제(신용카드)", ntsCode: "8433", label: "현금영수증",     ytsCol: "CARD_8433", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "그밖의소득공제(신용카드)", ntsCode: "8435", label: "전통시장",       ytsCol: "CARD_8435", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "그밖의소득공제(신용카드)", ntsCode: "8434", label: "대중교통",       ytsCol: "CARD_8434", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "그밖의소득공제(신용카드)", ntsCode: "8461", label: "도서공연-신용",  ytsCol: "CARD_8461", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "그밖의소득공제(신용카드)", ntsCode: "8462", label: "도서공연-직불",  ytsCol: "CARD_8462", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "그밖의소득공제(신용카드)", ntsCode: "8463", label: "도서공연-현금",  ytsCol: "CARD_8463", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "그밖의소득공제", ntsCode: "8452", label: "우리사주출연금 소득공제",       ytsCol: "OTO_SU",                 valueKey: "useAmt", rule: "value", status: "확정", send: false, note: "코드 화면실측(2026-07-17)" },
  { group: "그밖의소득공제", ntsCode: "8451", label: "장기집합투자증권저축",          ytsCol: "OTO_LONG_STOCK_SAVING",   valueKey: "useAmt", rule: "value", status: "확정", send: false, note: "코드 화면실측(2026-07-17)" },
  { group: "그밖의소득공제", ntsCode: "8501", label: "청년형 장기집합투자증권저축",     ytsCol: "OTO_YM_LONG_STOCK_SAVING", valueKey: "useAmt", rule: "value", status: "확정", send: false, note: "코드 화면실측(2026-07-17)" },
  { group: "그밖의소득공제", ntsCode: "8453", label: "고용유지중소기업근로자소득공제",  ytsCol: "OTO_EMPL_MTN_WAGE_CUT",  valueKey: "useAmt", rule: "value", status: "확정", send: false, note: "임금삭감액 기준. 코드 화면실측(2026-07-17)" },

  // ── 세액감면 (useAmt) ──────────────────────────────────────────────────────
  { group: "세액감면", ntsCode: "8601", label: "세액감면-소득세법",       ytsCol: "RT_IT_LAW",         valueKey: "useAmt", rule: "value", status: "추정", send: false },
  { group: "세액감면", ntsCode: "8602", label: "세액감면-조특법(30조제외)", ytsCol: "RT_R_LAW",         valueKey: "useAmt", rule: "value", status: "추정", send: false },
  { group: "세액감면", ntsCode: "8604", label: "조특법30조-100%",         ytsCol: "RT_R_LAW_CLAUS30",  valueKey: "useAmt", rule: "value", status: "추정", send: false, note: "감면율(100/90/70/50)별 4코드 분할 — 단일컬럼, 재확인" },
  { group: "세액감면", ntsCode: "8605", label: "조특법30조-50%",          ytsCol: "RT_R_LAW_CLAUS30",  valueKey: "useAmt", rule: "value", status: "추정", send: false, note: "감면율별 4코드 분할" },
  { group: "세액감면", ntsCode: "8608", label: "조특법30조-90%",          ytsCol: "RT_R_LAW_CLAUS30",  valueKey: "useAmt", rule: "value", status: "추정", send: false, note: "감면율별 4코드 분할" },
  // ★ 8916(조특법30조-70% 추정)은 NTS 중간계산코드(차감소득금액류)로 실측 판명(2026-07-15) → 제거.
  //    조특법30조 4분할(8604/8605/8608) 전체 status:추정 — send:true 전 프로브로 실입력코드 재확정 필수.
  { group: "세액감면", ntsCode: "8606", label: "세액감면-조세조약",       ytsCol: "RT_TAX_TREATY",     valueKey: "useAmt", rule: "value", status: "추정", send: false },

  // ── 세액공제: 자녀·출산입양 (인원) ─────────────────────────────────────────
  { group: "세액공제", ntsCode: "8790", label: "혼인세액공제",     ytsCol: "RT_MRRG",             valueKey: "useAmt", rule: "flag",  status: "확정", send: true, note: "혼인공제는 국세청 미검산(입력 ddcAmt 그대로 인정). buildCompareBody 특수전송(incDdcNfpCnt=1 + ddcAmt=RT_MRRG) → 결정세액에만 반영. tab 미부여=항목대조 제외(고정 50만·대조실익 없음). 2026-07-16 실측" },
  { group: "세액공제", ntsCode: "8763", label: "자녀세액공제",  ytsCol: "RT_HWC_CNT",     resultCol: "RT_HWC_AMT",     valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, note: "★총인원(RT_HWC_CNT) 필수 전송. 8004~8009(유형별)만으론 8763=0 → 유형별+총인원 둘 다 있어야 산출(8~20세 조건이라 국세청이 직계비속 수만으론 미판단). 2026-07-17 실측 정정" },
  // ── 출산·입양(8761) = 소계형(카드8430·의료8726 동형): 순번별 8764~8766(개별 IN)을 국세청이 합산해 8761(소계 OUT)로 회신 ──
  //   ★8761 자체엔 값 전송 안 함 — 총인원(RT_PER_CHI_CNT) 전송은 국세청이 무시하는 잉여(2026-07-17 실측). 8761은 SUBTOTAL_CODES(소계코드)로만 존재.
  //   순번별 (PAY_WRK_FMLY.PER_CHI_YN 3/5/7 = 첫째/둘째/셋째, 모두 FMLY_RELN 550-050). 8761 소계 OUT ↔ YTS RT_PER_CHI_AMT 대조.
  { group: "세액공제", ntsCode: "8764", label: "출산입양-첫째",     ytsCol: "FAM_8764", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, outCode: "8761", note: "PER_CHI_YN=3(30만). OUT은 소계 8761에 합산" },
  { group: "세액공제", ntsCode: "8765", label: "출산입양-둘째",     ytsCol: "FAM_8765", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, outCode: "8761", note: "PER_CHI_YN=5(50만). OUT은 소계 8761에 합산" },
  { group: "세액공제", ntsCode: "8766", label: "출산입양-셋째이상", ytsCol: "FAM_8766", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true, outCode: "8761", note: "PER_CHI_YN=7(70만). OUT은 소계 8761에 합산" },

  // ── 세액공제: 보험료 (전송=공제대상금액 SPCL_*) ────────────────────────────
  { group: "세액공제", ntsCode: "8710", label: "보장성보험료",        ytsCol: "SPCL_IF_GRT_INSU_AMT",      resultCol: "RT_IF_GRT_INSU_AMT",      valueKey: "useAmt", rule: "value", status: "확정", send: true, note: "공제대상금액(SPCL_IF_GRT_INSU_AMT, 100만 capped) 전송 → NTS self OUT ddcAmt=12% ↔ RT_IF_GRT_INSU_AMT 원단위 일치. 지출총액 컬럼 없음, 한도 정액이라 공제대상 전송이 정답(2026-07-17 실측확정)" },
  { group: "세액공제", ntsCode: "8711", label: "장애인전용 보장성보험료", ytsCol: "SPCL_IF_HDC_PERS_INSU_AMT", resultCol: "RT_IF_HDC_PERS_INSU_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, note: "공제대상금액 전송 → NTS self OUT ddcAmt=15% ↔ RT_IF_HDC_PERS_INSU_AMT 일치(X202600325=66,229). 8710과 독립 self, X2026 대상 3명(2026-07-17 실측확정)" },

  // ── 세액공제: 교육비 = 소계형(8735). ★국세청 서버는 구분(8730~34) 무시하고 ddcTrgtAmt×15%를 8735로 합산 ──
  //   한도(초중고300만/대학900만)는 국세청 화면이 적용해 ddcTrgtAmt(공제대상)를 만들고, 서버는 그대로 신뢰(재한도 없음).
  //   YTS는 구분별 한도후 값이 없고 한도후 총액(SPCL_EDU_AMT)만 있어, 대표코드 8730 한 칸에 총액을 ddcTrgtAmt로 몰아 전송.
  //   8735 는 결과전용(직접입력 무시) → SUBTOTAL_CODES 로만 표현. useAmt·ddcLmtAmt·인원은 서버 무시(2026-07-17 실측확정).
  { group: "세액공제", ntsCode: "8730", label: "교육비(공제대상 총액)", ytsCol: "SPCL_EDU_AMT", valueKey: "ddcTrgtAmt", rule: "value", status: "확정", send: true, outCode: "8735", note: "국세청 8730(본인칸)에 교육비 공제대상 총액(SPCL_EDU_AMT, 한도적용후) 전송 → 서버 ×15% → 8735 소계 ↔ RT_EDU_AMT 대조. 8731~34(구분별)는 한도후 데이터 없어 미사용(서버 계산 구분 무관)" },
  
  // ── 세액공제: 기타 ─────────────────────────────────────────────────────────
  // ── 기타세액공제(납세조합·주택차입금이자·외국납부) = self형(결과 ddcAmt). 원천=PAY_WRK_MAIN, useAmt 대상금액 전송 ──
  //   국세청 코드·필드·결과key 실측확정(2026-07-17, docs/hometax-capture + edu-rules-probe). ★X2026 대상자 0이라 원단위 미검증(첫 대상자 시 확인).
  { group: "세액공제", ntsCode: "8753", label: "납세조합공제",        ytsCol: "ETX_8753", resultCol: "RT_PTU", valueKey: "useAmt", rule: "value", status: "확정", send: true, note: "PAY_WRK_MAIN.ASSO_SUB_TAX_AMT(대상금액,'공제세액'名이나 실제 대상) → self ddcAmt ↔ RT_PTU. ddcLmtAmt 불필요(서버 자체계산)" },
  { group: "세액공제", ntsCode: "8752", label: "주택차입금이자상환액", ytsCol: "ETX_8752", resultCol: "RT_HBA", valueKey: "useAmt", rule: "value", status: "확정", send: true, note: "PAY_WRK_MAIN.HOUSE_ALR(이자상환액,대상) → self ddcAmt(=30%) ↔ RT_HBA. 부수 8906 농특세20%" },
  { group: "세액공제", ntsCode: "8751", label: "외국납부_국외납부세액",  ytsCol: "ETX_8751", resultCol: "RT_FCG", valueKey: "useAmt", rule: "value", status: "확정", send: true, note: "PAY_WRK_MAIN.FRGN_PAY_TAX(국외납부세액,대상) → self ddcAmt ↔ RT_FCG. ★8754(국외총급여) 동반 필수(없으면 결과0, 한도=산출세액×국외소득/총급여)" },
  { group: "세액공제", ntsCode: "8754", label: "외국납부_국외총급여",   ytsCol: "ETX_8754", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "—", note: "외국납부세액공제 한도계산용 동반입력. 자체 결과 없음. PAY_WRK_MAIN.FRGN_TOT_PAY_AMT" },
  { group: "세액공제", ntsCode: "8750", label: "월세액",           ytsCol: "RENT_8750",           resultCol: "RT_HOUSE_RENT_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, tab: "기타", note: "PAY_WRK_MAIN.HOUSE_RENT(원본 지급총액) 주입 — NTS가 한도·공제율 자체계산(2026-07-15 실측확정)" },


  // ── 세액공제: 의료비 — CALC_PROC_MEDI(JSON) 대상자별 "지출금액"을 MEDI_{코드} 가상컬럼으로 주입 ──
  //   NTS 8726(의료비집계)에 세액공제 총액 반환 → YTS 의료비_공제금액(=RT_MEDI_AMT)과 대조. (2026-07-12 실측확정)
  //   ★지출금액 전송(공제대상금액 아님) — NTS가 3% 최저사용액 차감 자체계산.
  { group: "의료비", ntsCode: "8720", label: "의료비-본인/65세이상/장애인", ytsCol: "MEDI_8720", resultCol: "RT_MEDI_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "의료비", ntsCode: "8721", label: "의료비-그밖의 공제대상자",   ytsCol: "MEDI_8721", resultCol: "RT_MEDI_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "의료비", ntsCode: "8725", label: "의료비-난임시술비",          ytsCol: "MEDI_8725", resultCol: "RT_MEDI_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "의료비", ntsCode: "8729", label: "의료비-미숙아·선천성이상아", ytsCol: "MEDI_8729", resultCol: "RT_MEDI_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },

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
  { group: "연금계좌", ntsCode: "8707", label: "ISA만기-퇴직연금계좌 추가납입", ytsCol: "PEN_8707", resultCol: "RT_ISA_PEN_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8707" },
  { group: "연금계좌", ntsCode: "8708", label: "ISA만기-연금저축계좌 추가납입", ytsCol: "PEN_8708", resultCol: "RT_ISA_PEN_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, outCode: "8708" },

  
]

/** L03 응답 계산흐름 표시용 결과코드 (표시 순서) — 입력 아님, 파싱/추적용 */
export const NTS_RESULT_CODES: { code: string; label: string }[] = [
  { code: "8901", label: "근로소득공제" },
  { code: "8902", label: "근로소득금액" },
  { code: "8903", label: "종합소득 과세표준" },
  { code: "8990", label: "산출세액" },
  { code: "8923", label: "근로소득세액공제" },
  { code: "8999", label: "결정세액" },
  { code: "8998", label: "지방소득세" },
  { code: "8992", label: "차감징수세액" },
]

/** 매핑에서 값을 읽어와야 하는 YTS39 컬럼 목록 (SQL SELECT 생성용, 중복·null 제거).
 *  send 여부와 무관하게 전부 조회해야 "값은 있는데 미전송"을 감지할 수 있다. */
export function mappingSelectCols(): string[] {
  const set = new Set<string>()
  for (const m of MAPPING_2025) if (m.ytsCol) set.add(m.ytsCol)
  return [...set]
}

/** 한 매핑행이 실제로 L03 에 넣을 값. 미전송(send:false)이면 0.
 *  const1=1, flag=원천값>0이면 1, value=원천값 그대로. */
export function mappingSentValue(m: MappingRow, vals: Record<string, number>): number {
  if (!m.send) return 0
  if (m.ntsCode === "8790") return m.ytsCol ? Number(vals[m.ytsCol] ?? 0) : 0   // 혼인공제 특수: ddcAmt 직접전송(=RT_MRRG)
  if (m.rule === "const1") return 1
  const raw = m.ytsCol ? Number(vals[m.ytsCol] ?? 0) : 0
  return m.rule === "flag" ? (raw > 0 ? 1 : 0) : raw
}

/** 상세뷰·미전송감지용 입력 한 행 */
export interface NtsInputRow {
  code:     string
  label:    string
  group:    string
  ytsCol:   string | null
  valueKey: ValueKey
  status:   MappingStatus
  send:     boolean
  /** 원천 YTS 컬럼값 (const1 등 ytsCol 없으면 0) */
  ytsValue: number
  /** 원천 YTS 값이 있음(>0) — const1(본인 등)은 항상 true */
  hasValue: boolean
  /** 실제 L03 body 에 넣은 값 (미전송이면 0) */
  sent:     number
  note?:    string
}

/** YTS 값 레코드(컬럼명→값) → 전 매핑행의 입력상태(0 포함) */
export function computeInputs(vals: Record<string, number>): NtsInputRow[] {
  return MAPPING_2025.map(m => {
    const raw = m.ytsCol ? Number(vals[m.ytsCol] ?? 0) : 0
    return {
      code:     m.ntsCode,
      label:    m.label,
      group:    m.group,
      ytsCol:   m.ytsCol,
      valueKey: m.valueKey,
      status:   m.status,
      send:     m.send,
      ytsValue: raw,
      hasValue: m.rule === "const1" ? true : raw > 0,
      sent:     mappingSentValue(m, vals),
      note:     m.note,
    }
  })
}
