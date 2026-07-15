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
  note?:     string
}

export const MAPPING_2025: MappingRow[] = [
  // ── 총급여 / 기납부 (계산 기본입력) ─────────────────────────────────────────
  { group: "기본입력", ntsCode: "8900", label: "총급여",       ytsCol: "TOT_PAY_AMT",   valueKey: "useAmt", rule: "value",  status: "확정", send: true },
  { group: "기본입력", ntsCode: "8991", label: "기납부세액",   ytsCol: "PAYM_INCM_TAX", valueKey: "useAmt", rule: "value",  status: "확정", send: true },

  // ── 인적공제 (인원, incDdcNfpCnt) ──────────────────────────────────────────
  { group: "인적공제", ntsCode: "8001", label: "기본공제-본인",     ytsCol: null,                  resultCol: "BASC_SUB_SELF_AMT",  valueKey: "incDdcNfpCnt", rule: "const1", status: "확정", send: true },
  { group: "인적공제", ntsCode: "8002", label: "기본공제-배우자",   ytsCol: "BASC_SUB_MATE_AMT",   valueKey: "incDdcNfpCnt", rule: "flag",   status: "확정", send: true },
  { group: "인적공제", ntsCode: "8003", label: "기본공제-부양가족", ytsCol: "BASC_SUB_FAMILY_CNT", valueKey: "incDdcNfpCnt", rule: "value",  status: "확정", send: true },
  { group: "인적공제", ntsCode: "8101", label: "추가공제-경로우대", ytsCol: "ADD_SUB_OAT_CNT",     valueKey: "incDdcNfpCnt", rule: "value",  status: "확정", send: true },
  { group: "인적공제", ntsCode: "8102", label: "추가공제-장애인",   ytsCol: "ADD_SUB_HDC_PERS_CNT",valueKey: "incDdcNfpCnt", rule: "value",  status: "확정", send: true },
  { group: "인적공제", ntsCode: "8103", label: "추가공제-부녀자",   ytsCol: "ADD_SUB_LADY_AMT",    valueKey: "incDdcNfpCnt", rule: "flag",   status: "확정", send: true },
  { group: "인적공제", ntsCode: "8104", label: "추가공제-한부모",   ytsCol: "ADD_SUB_SNGL_PRNT_AMT",valueKey: "incDdcNfpCnt", rule: "flag",  status: "확정", send: true },

  // ── 연금보험료공제 (소득공제, useAmt) ──────────────────────────────────────
  { group: "연금보험료", ntsCode: "8201", label: "국민연금",       ytsCol: "NP_INSU_AMT",        valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "연금보험료", ntsCode: "8205", label: "공무원연금",     ytsCol: "ETC_PEN_PUBL_AMT",   valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "연금보험료", ntsCode: "8208", label: "군인연금",       ytsCol: "ETC_PEN_MLTARY_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "연금보험료", ntsCode: "8211", label: "사립학교교직원연금", ytsCol: "ETC_PEN_SCHL_AMT",valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "연금보험료", ntsCode: "8215", label: "별정우체국연금", ytsCol: "ETC_PEN_POST_AMT",   valueKey: "useAmt", rule: "value", status: "확정", send: false },

  // ── 특별소득공제 (useAmt) ──────────────────────────────────────────────────
  { group: "특별소득공제", ntsCode: "8301", label: "건강보험료",   ytsCol: "SPCL_IF_HLTH_INSU_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8305", label: "고용보험료",   ytsCol: "SPCL_IF_EMP_INSU_AMT",  valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "특별소득공제", ntsCode: "8311", label: "주택임차차입 원리금-대출기관", ytsCol: "SP_HOUSE_RALR_LENDER_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "특별소득공제", ntsCode: "8312", label: "주택임차차입 원리금-거주자",   ytsCol: "SP_HOUSE_RALR_HABT_AMT",   valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "특별소득공제", ntsCode: "8321", label: "장기주택저당 11이전(15미만)",  ytsCol: "SP_LH_LRSF1_AMT",  valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "특별소득공제", ntsCode: "8322", label: "장기주택저당 11이전(15~29)",   ytsCol: "SP_LH_LRSF2_AMT",  valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "특별소득공제", ntsCode: "8323", label: "장기주택저당 11이전(30이상)",  ytsCol: "SP_LH_LRSF3_AMT",  valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "특별소득공제", ntsCode: "8324", label: "장기주택저당 12이후 고정or비거치", ytsCol: "SP_LH_LRSF10_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "특별소득공제", ntsCode: "8325", label: "장기주택저당 12이후 그밖",       ytsCol: "SP_LH_LRSF20_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "특별소득공제", ntsCode: "8326", label: "장기주택저당 15이후 고정and비거치", ytsCol: "SP_LH_LRSF30_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "특별소득공제", ntsCode: "8327", label: "장기주택저당 15이후 고정or비거치", ytsCol: "SP_LH_LRSF40_AMT", valueKey: "useAmt", rule: "value", status: "추정", send: false, note: "8327/8328 라벨 중복표기 — 실측 재확인" },
  { group: "특별소득공제", ntsCode: "8328", label: "장기주택저당 15이후 그밖",       ytsCol: "SP_LH_LRSF50_AMT", valueKey: "useAmt", rule: "value", status: "추정", send: false, note: "8327/8328 라벨 중복표기 — 실측 재확인" },
  { group: "특별소득공제", ntsCode: "8329", label: "장기주택저당 15이후(10~15)",     ytsCol: "SP_LH_LRSF60_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: false },

  // ── 그밖의 소득공제 (useAmt) ───────────────────────────────────────────────
  { group: "그밖의소득공제", ntsCode: "8401", label: "개인연금저축",            ytsCol: "OTO_PPF",                 valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "그밖의소득공제", ntsCode: "8402", label: "소기업소상공인(노란우산)", ytsCol: "OTO_SM_ETPR_AMT",        valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "그밖의소득공제", ntsCode: "8403", label: "주택마련-청약저축",        ytsCol: "OTO_HOUSE_LOAN_SBSC_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "그밖의소득공제", ntsCode: "8404", label: "주택마련-근로자주택마련",  ytsCol: "OTO_HOUSE_LOAN_WRK_AMT",  valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "그밖의소득공제", ntsCode: "8406", label: "주택청약종합저축(14이전)", ytsCol: "OTO_HOUSE_LOAN_ALL_AMT",  valueKey: "useAmt", rule: "value", status: "추정", send: false, note: "8406/8407 가입연도 분할 — 단일컬럼이라 분리 불가, 재확인" },
  { group: "그밖의소득공제", ntsCode: "8407", label: "주택청약종합저축(15이후)", ytsCol: "OTO_HOUSE_LOAN_ALL_AMT",  valueKey: "useAmt", rule: "value", status: "추정", send: false, note: "8406/8407 가입연도 분할 — 단일컬럼이라 분리 불가, 재확인" },
  { group: "그밖의소득공제", ntsCode: "8415", label: "투자조합출자(귀속-2 조합)", ytsCol: "OTO_IU_ETC",             valueKey: "useAmt", rule: "value", status: "추정", send: false, note: "투자조합 다코드 분할 — 단일컬럼, 재확인" },
  { group: "그밖의소득공제", ntsCode: "8416", label: "투자조합출자(귀속-2 벤처)", ytsCol: "OTO_IU_ETC",             valueKey: "useAmt", rule: "value", status: "추정", send: false, note: "투자조합 다코드 분할" },
  { group: "그밖의소득공제", ntsCode: "8417", label: "투자조합출자(귀속-1 조합)", ytsCol: "OTO_IU_ETC",             valueKey: "useAmt", rule: "value", status: "추정", send: false, note: "투자조합 다코드 분할" },
  { group: "그밖의소득공제", ntsCode: "8418", label: "투자조합출자(귀속-1 벤처)", ytsCol: "OTO_IU_ETC",             valueKey: "useAmt", rule: "value", status: "추정", send: false, note: "투자조합 다코드 분할" },
  { group: "그밖의소득공제", ntsCode: "8419", label: "투자조합출자(당해 조합)",   ytsCol: "OTO_IU_ETC",             valueKey: "useAmt", rule: "value", status: "확정", send: false, note: "당해분 확정 / 과년도 분할은 추정" },
  { group: "그밖의소득공제", ntsCode: "8420", label: "투자조합출자(당해 벤처)",   ytsCol: "OTO_IU_ETC",             valueKey: "useAmt", rule: "value", status: "추정", send: false, note: "투자조합 다코드 분할" },
  // 신용카드 등 — CALC_PROC_CARD(JSON) 가~아를 CARD_{코드} 가상컬럼으로 주입 (route.injectCardVals).
  //   NTS 8430(카드소계)에 총공제 반환 → YTS 최종공제금액(=OTO_CARD_ETC)과 대조. (2026-07-12 실측확정)
  { group: "신용카드", ntsCode: "8431", label: "신용카드",       ytsCol: "CARD_8431", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "신용카드", ntsCode: "8432", label: "직불·선불카드",  ytsCol: "CARD_8432", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "신용카드", ntsCode: "8433", label: "현금영수증",     ytsCol: "CARD_8433", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "신용카드", ntsCode: "8435", label: "전통시장",       ytsCol: "CARD_8435", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "신용카드", ntsCode: "8434", label: "대중교통",       ytsCol: "CARD_8434", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "신용카드", ntsCode: "8461", label: "도서공연-신용",  ytsCol: "CARD_8461", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "신용카드", ntsCode: "8462", label: "도서공연-직불",  ytsCol: "CARD_8462", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "신용카드", ntsCode: "8463", label: "도서공연-현금",  ytsCol: "CARD_8463", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "그밖의소득공제", ntsCode: "8450", label: "목돈안드는전세 이자상환",  ytsCol: null,                      valueKey: "useAmt", rule: "value", status: "미확보", send: false, note: "YTS39 대응컬럼 미확인" },
  { group: "그밖의소득공제", ntsCode: "8451", label: "장기집합투자증권저축",     ytsCol: "OTO_LONG_STOCK_SAVING",   valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "그밖의소득공제", ntsCode: "8452", label: "우리사주조합 출연금",       ytsCol: "OTO_SU",                 valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "그밖의소득공제", ntsCode: "8453", label: "고용유지중소기업 근로자",   ytsCol: "OTO_EMPL_MTN_WAGE_CUT",  valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "그밖의소득공제", ntsCode: "8501", label: "청년형 장기집합투자증권저축", ytsCol: "OTO_YM_LONG_STOCK_SAVING", valueKey: "useAmt", rule: "value", status: "확정", send: false },

  // ── 세액감면 (useAmt) ──────────────────────────────────────────────────────
  { group: "세액감면", ntsCode: "8601", label: "세액감면-소득세법",       ytsCol: "RT_IT_LAW",         valueKey: "useAmt", rule: "value", status: "추정", send: false },
  { group: "세액감면", ntsCode: "8602", label: "세액감면-조특법(30조제외)", ytsCol: "RT_R_LAW",         valueKey: "useAmt", rule: "value", status: "확정", send: false },
  { group: "세액감면", ntsCode: "8604", label: "조특법30조-100%",         ytsCol: "RT_R_LAW_CLAUS30",  valueKey: "useAmt", rule: "value", status: "추정", send: false, note: "감면율(100/90/70/50)별 4코드 분할 — 단일컬럼, 재확인" },
  { group: "세액감면", ntsCode: "8605", label: "조특법30조-50%",          ytsCol: "RT_R_LAW_CLAUS30",  valueKey: "useAmt", rule: "value", status: "추정", send: false, note: "감면율별 4코드 분할" },
  { group: "세액감면", ntsCode: "8608", label: "조특법30조-90%",          ytsCol: "RT_R_LAW_CLAUS30",  valueKey: "useAmt", rule: "value", status: "추정", send: false, note: "감면율별 4코드 분할" },
  // ★ 8916(조특법30조-70% 추정)은 NTS 중간계산코드(차감소득금액류)로 실측 판명(2026-07-15) → 제거.
  //    조특법30조 4분할(8604/8605/8608) 전체 status:추정 — send:true 전 프로브로 실입력코드 재확정 필수.
  { group: "세액감면", ntsCode: "8606", label: "세액감면-조세조약",       ytsCol: "RT_TAX_TREATY",     valueKey: "useAmt", rule: "value", status: "확정", send: false },

  // ── 세액공제: 자녀·출산입양 (인원) ─────────────────────────────────────────
  { group: "세액공제", ntsCode: "8763", label: "자녀세액공제",  ytsCol: "RT_HWC_CNT",     resultCol: "RT_HWC_AMT",     valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8761", label: "출산·입양",     ytsCol: "RT_PER_CHI_CNT", resultCol: "RT_PER_CHI_AMT", valueKey: "incDdcNfpCnt", rule: "value", status: "확정", send: true },

  // ── 세액공제: 보험료 (전송=공제대상금액 SPCL_*) ────────────────────────────
  { group: "세액공제", ntsCode: "8710", label: "보장성보험료",        ytsCol: "SPCL_IF_GRT_INSU_AMT",      resultCol: "RT_IF_GRT_INSU_AMT",      valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8711", label: "장애인전용 보장성보험료", ytsCol: "SPCL_IF_HDC_PERS_INSU_AMT", resultCol: "RT_IF_HDC_PERS_INSU_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: false },

  // ── 세액공제: 의료비 — CALC_PROC_MEDI(JSON) 대상자별 "지출금액"을 MEDI_{코드} 가상컬럼으로 주입 ──
  //   NTS 8726(의료비집계)에 세액공제 총액 반환 → YTS 의료비_공제금액(=RT_MEDI_AMT)과 대조. (2026-07-12 실측확정)
  //   ★지출금액 전송(공제대상금액 아님) — NTS가 3% 최저사용액 차감 자체계산.
  { group: "의료비", ntsCode: "8720", label: "의료비-본인/65세이상/장애인", ytsCol: "MEDI_8720", resultCol: "RT_MEDI_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "의료비", ntsCode: "8721", label: "의료비-그밖의 공제대상자",   ytsCol: "MEDI_8721", resultCol: "RT_MEDI_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "의료비", ntsCode: "8725", label: "의료비-난임시술비",          ytsCol: "MEDI_8725", resultCol: "RT_MEDI_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "의료비", ntsCode: "8729", label: "의료비-미숙아·선천성이상아", ytsCol: "MEDI_8729", resultCol: "RT_MEDI_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },

  // ── 세액공제: 교육비 (ddcTrgtAmt, 구분별 분할) ─────────────────────────────
  { group: "세액공제", ntsCode: "8730", label: "교육비-소득자 본인", ytsCol: "SPCL_EDU_AMT", resultCol: "RT_EDU_AMT", valueKey: "ddcTrgtAmt", rule: "value", status: "추정", send: false, note: "8730~8734 구분별 분할 — YTS 단일 공제대상컬럼이라 분리 불가" },
  { group: "세액공제", ntsCode: "8731", label: "교육비-미취학아동",  ytsCol: "SPCL_EDU_AMT", resultCol: "RT_EDU_AMT", valueKey: "ddcTrgtAmt", rule: "value", status: "추정", send: false, note: "교육비 구분별 분할 필요" },
  { group: "세액공제", ntsCode: "8732", label: "교육비-초중고",      ytsCol: "SPCL_EDU_AMT", resultCol: "RT_EDU_AMT", valueKey: "ddcTrgtAmt", rule: "value", status: "추정", send: false, note: "교육비 구분별 분할 필요" },
  { group: "세액공제", ntsCode: "8733", label: "교육비-대학교",      ytsCol: "SPCL_EDU_AMT", resultCol: "RT_EDU_AMT", valueKey: "ddcTrgtAmt", rule: "value", status: "추정", send: false, note: "교육비 구분별 분할 필요" },
  { group: "세액공제", ntsCode: "8734", label: "교육비-장애인",      ytsCol: "SPCL_EDU_AMT", resultCol: "RT_EDU_AMT", valueKey: "ddcTrgtAmt", rule: "value", status: "추정", send: false, note: "교육비 구분별 분할 필요" },

  // ── 세액공제: 기부금 당해분 (PAY_WRK_GIFT → GIFT_{코드} 가상컬럼으로 주입) ──
  { group: "세액공제", ntsCode: "8740", label: "정치자금기부금-10만이하",    ytsCol: "GIFT_8740", valueKey: "useAmt", rule: "value", status: "확정", send: true,  note: "route에서 10만 경계 분리" },
  { group: "세액공제", ntsCode: "8741", label: "정치자금기부금-10만초과",    ytsCol: "GIFT_8741", valueKey: "useAmt", rule: "value", status: "확정", send: false, note: "NTS 내부 분리 코드 — 8740에 전체 금액 전송하면 NTS가 자동 분리, 별도 전송 시 이중계산" },
  { group: "세액공제", ntsCode: "8783", label: "고향사랑기부금(일반)",       ytsCol: "GIFT_8783", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8784", label: "고향사랑기부금(특별재난)",   ytsCol: "GIFT_8784", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8743", label: "특례(법정)기부금",           ytsCol: "GIFT_8743", resultCol: "RT_DON_LAW",    valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8744", label: "우리사주조합 기부금",        ytsCol: "GIFT_8744", resultCol: "RT_STOCK_URSM", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8746", label: "일반기부금-종교단체",        ytsCol: "GIFT_8746", resultCol: "RT_PSA_RELGN",  valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8747", label: "일반기부금-종교단체 외",     ytsCol: "GIFT_8747", resultCol: "RT_PSA",         valueKey: "useAmt", rule: "value", status: "확정", send: true },
  // ── 세액공제: 기부금 이월분 (PAY_WRK_GIFT_ADJ → GIFT_{코드} 가상컬럼으로 주입) ──
  { group: "세액공제", ntsCode: "8811", label: "특례기부금 이월(-1년)",       ytsCol: "GIFT_8811", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8812", label: "특례기부금 이월(-2년)",       ytsCol: "GIFT_8812", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8813", label: "특례기부금 이월(-3년)",       ytsCol: "GIFT_8813", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8814", label: "특례기부금 이월(-4년)",       ytsCol: "GIFT_8814", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8815", label: "특례기부금 이월(-5년)",       ytsCol: "GIFT_8815", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8821", label: "일반기부금(종교) 이월(-1년)",  ytsCol: "GIFT_8821", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8822", label: "일반기부금(종교) 이월(-2년)",  ytsCol: "GIFT_8822", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8823", label: "일반기부금(종교) 이월(-3년)",  ytsCol: "GIFT_8823", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8824", label: "일반기부금(종교) 이월(-4년)",  ytsCol: "GIFT_8824", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8825", label: "일반기부금(종교) 이월(-5년)",  ytsCol: "GIFT_8825", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8831", label: "일반기부금(종교외) 이월(-1년)", ytsCol: "GIFT_8831", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8832", label: "일반기부금(종교외) 이월(-2년)", ytsCol: "GIFT_8832", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8833", label: "일반기부금(종교외) 이월(-3년)", ytsCol: "GIFT_8833", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8834", label: "일반기부금(종교외) 이월(-4년)", ytsCol: "GIFT_8834", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "세액공제", ntsCode: "8835", label: "일반기부금(종교외) 이월(-5년)", ytsCol: "GIFT_8835", valueKey: "useAmt", rule: "value", status: "확정", send: true },

  // ── 세액공제: 연금계좌 — PAY_WRK_PEN_SAVE_SPEC 납입액(PEN_SAVE_PMT_AMT)을 PEN_{코드} 가상컬럼으로 주입 ──
  //   PEN_SAVE_CLS→코드 매핑(mapping/pension.ts). NTS 8706(연금계좌 총합)에 세액공제 반환. (2026-07-12 실측확정)
  //   ★납입액 전송(공제대상 아님) — NTS가 한도·공제율 자체계산. ISA도 전환액 원본이라 ×10 불필요.
  { group: "연금계좌", ntsCode: "8701", label: "연금계좌-과학기술인",   ytsCol: "PEN_8701", resultCol: "RT_RSIGN_PEN_TECH_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "연금계좌", ntsCode: "8702", label: "연금계좌-IRP퇴직급여",  ytsCol: "PEN_8702", resultCol: "RT_RSIGN_PEN_RET_AMT",  valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "연금계좌", ntsCode: "8703", label: "연금계좌-연금저축",     ytsCol: "PEN_8703", resultCol: "RT_RSIGN_PEN_PF_AMT",   valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "연금계좌", ntsCode: "8707", label: "ISA만기-퇴직연금계좌 추가납입", ytsCol: "PEN_8707", resultCol: "RT_ISA_PEN_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },
  { group: "연금계좌", ntsCode: "8708", label: "ISA만기-연금저축계좌 추가납입", ytsCol: "PEN_8708", resultCol: "RT_ISA_PEN_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true },

  // ── 세액공제: 기타 ─────────────────────────────────────────────────────────
  { group: "세액공제", ntsCode: "8790", label: "결혼세액공제",     ytsCol: "RT_MRRG",             valueKey: "useAmt", rule: "flag",  status: "확정", send: false, note: "체크박스 고정 50만 — 전송방식(flag/useAmt) 실측 재확인" },
  { group: "세액공제", ntsCode: "8750", label: "월세액",           ytsCol: "RENT_8750",           resultCol: "RT_HOUSE_RENT_AMT", valueKey: "useAmt", rule: "value", status: "확정", send: true, tab: "기타", note: "PAY_WRK_MAIN.HOUSE_RENT(원본 지급총액) 주입 — NTS가 한도·공제율 자체계산(2026-07-15 실측확정)" },
  { group: "세액공제", ntsCode: "8753", label: "납세조합공제",     ytsCol: "RT_PTU",              valueKey: "useAmt", rule: "value", status: "확정", send: false, note: "대상금액 컬럼 미확인 — 공제액 컬럼 사용" },
  { group: "세액공제", ntsCode: "8752", label: "주택차입금 이자세액", ytsCol: "RT_HBA",            valueKey: "useAmt", rule: "value", status: "확정", send: false, note: "대상금액 컬럼 미확인" },
  { group: "세액공제", ntsCode: "8751", label: "외국납부세액",     ytsCol: "RT_FCG",              valueKey: "useAmt", rule: "value", status: "확정", send: false },
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
