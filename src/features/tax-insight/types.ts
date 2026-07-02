export type TaxFilterType    = 'all' | 'zero' | 'nonzero'
export type CalcFilterType   = 'all' | 'standard' | 'special'
export type WorkFilterType   = 'all' | 'continue' | 'midleave'
export type ReviewFilterType = 'all' | 'houserent' | 'insurance' | 'housingsavings' | 'ralr' | 'card' | 'medi' | 'incomeexhausted' | 'taxexhausted'

export interface CalcListItem {
  calcNo: string
  name: string
  resIncmTax: number
  subIncmTax: number
  totPayAmt: number
}

export interface CardData {
  가: number
  나: number
  다: number
  일반사용계: number
  라: number
  마: number
  바: number
  문화체육계: number
  사: number
  아: number
  총사용액: number
  총급여: number
  최저사용금액: number
  공제제외금액: number
  공제가능금액: number
  공제한도: number
  일반공제금액: number
  전통추가1: number
  교통추가2: number
  문화추가3: number
  추가공제금액: number
  최종공제금액: number
  비고_MEMO: string
  총급여_MEMO: string
}

export interface MediItem {
  NM: string
  FMLY_RELN: string
  COMM_NM: string
  MEDI_FLAG: string
  MEDI_AMT: number
  MEDI_HDC_MC_AMT: number
  MEDI_BONIN: number
}

export interface MediData {
  난임시술비: number
  미숙아등이상아: number
  본인등배려자: number
  그밖의부양가족: number
  의료비지출금액: number
  의료비지출금액_MEMO: string
  의료비최저사용액: number
  난임시술비_공제대상: number
  미숙아등이상아_공제대상: number
  본인등배려자_공제대상: number
  그밖의부양가족_공제대상: number
  의료비_공제대상금액: number
  의료비_공제금액: number
  medi_data: string
}

export interface CalcRow {
  CALC_NO: string
  TOT_PAY_AMT: number
  NTAX_SUM: number
  PAYM_INCM_TAX: number
  PAYM_INHABT_TAX: number
  WORK_AMT: number
  BASC_SUB_SELF_AMT: number
  BASC_SUB_MATE_AMT: number
  BASC_SUB_FAMILY_CNT: number
  BASC_SUB_FAMILY_AMT: number
  ADD_SUB_OAT_CNT: number
  ADD_SUB_OAT_AMT: number
  ADD_SUB_HDC_PERS_CNT: number
  ADD_SUB_HDC_PERS_AMT: number
  ADD_SUB_LADY_AMT: number
  ADD_SUB_SNGL_PRNT_AMT: number
  NP_INSU_OBJ_AMT: number
  NP_INSU_AMT: number
  SPCL_IF_HLTH_INSU_AMT: number
  SPCL_IF_EMP_INSU_AMT: number
  SP_HOUSE_RALR_LENDER_AMT: number
  SP_HOUSE_RALR_HABT_AMT: number
  OTO_CARD_ETC: number
  OTO_SUM: number
  TOT_PTB: number
  PROD_TAX_AMT: number
  TAX_CUT: number
  RT_WIA: number
  RT_MRRG: number
  RT_HWC_CNT: number
  RT_HWC_AMT: number
  RT_PER_CHI_CNT: number
  RT_PER_CHI_AMT: number
  SPCL_IF_GRT_INSU_AMT: number
  RT_IF_GRT_INSU_AMT: number
  SPCL_IF_HDC_PERS_INSU_AMT: number
  RT_IF_HDC_PERS_INSU_AMT: number
  SPCL_MEDI_AMT: number
  RT_MEDI_AMT: number
  SPCL_EDU_AMT: number
  RT_EDU_AMT: number
  RT_BASE_SUB_AMT: number
  SP_HOUSE_RENT_AMT: number
  RT_HOUSE_RENT_AMT: number
  SPCL_PSA: number
  RT_PSA: number
  SPCL_PSA_RELGN_AMT: number
  RT_PSA_RELGN: number
  SPCL_HL_AMT: number
  RT_HL: number
  SPCL_HOME_LOVE: number
  RT_HOME_LOVE: number
  RSIGN_PEN_TECH_AMT: number
  RT_RSIGN_PEN_TECH_AMT: number
  RSIGN_PEN_RET_AMT: number
  RT_RSIGN_PEN_RET_AMT: number
  RSIGN_PEN_PF_AMT: number
  RT_RSIGN_PEN_PF_AMT: number
  ISA_PEN_AMT: number
  RT_ISA_PEN_AMT: number
  RT_SUM: number
  RES_INCM_TAX: number
  RES_INHABT_TAX: number
  EFFCTV_TAX_RATE: number
  SUB_INCM_TAX: number
  SUB_INHABT_TAX: number
  EXHAUSTED_POINT: string
  CALC_METHOD: string
  CALC_PROC_TOTAL: string
  CALC_PROC_CARD: string | null
  CALC_PROC_MEDI: string | null
  CALC_PROC_INPUT: string | null
  // PAY_WRK_MAIN
  KEEP_PS: string
  HOUSE_HLDR_YN: string
  BEL_FRM_DT: string
  BEL_TO_DT: string
  CONF_YN: string
  REL_WRKR_YN: string
  HABT_CLS: string
  HOME_CLS: string
  MEDI_ISA_AMT: number | null
  MEDI_CA_AMT: number | null
  EDU_SELF_AMT: number | null
  EDU_ENT_PREV_AMT: number | null
  EDU_INFC_AMT: number | null
  EDU_UNV_STUD_AMT: number | null
  EDU_HDC_PERS_AMT: number | null
  MAIN_HOUSE_RENT: number | null
  MAIN_HLTH_INSU_AMT: number | null
  MAIN_EMP_INSU_AMT: number | null
  MAIN_HOUSE_LOAN_SBSC: number | null
  MAIN_HOUSE_LOAN_ALL: number | null
  MAIN_HOUSE_LOAN_WRK: number | null
  MAIN_HOUSE_RALR_LENDER: number | null
  MAIN_HOUSE_RALR_HABT: number | null
}

export interface InputData {
  SELF: number; MATE: number; FAMILY: number
  OAT: number; HDC: number; LADY: number; SNGL: number
  NP_INSU_OBJ_AMT: number
  SPCL_IF_HLTH_INSU_OBJ_AMT: number
  SPCL_IF_EMP_INSU_OBJ_AMT: number
  PNINT_SUM: number
  CARD_entered: number; OTO_CARD_ETC: number
  GRT_INSU: number; HDC_PERS_INSU: number
  MEDI_entered: number; RT_MEDI_AMT: number; SPCL_MEDI_AMT: number
  EDU_SUM: number
  SORT_CLS_10_SUM: number; SORT_CLS_21_SUM: number
  SORT_CLS_22_SUM: number; SORT_CLS_30_SUM: number
  SORT_CLS_40_SUM: number; SORT_CLS_50_SUM: number
  SORT_CLS_60_SUM: number
  HOUSE_RENT: number
  CHLD: number; CHLD3: number; CHLD5: number; CHLD7: number
  MRRG: number
  HOUSEHOLD_MEMBER?: number  // 1=세대원, 없음=세대주
  [key: string]: number | undefined
}

export type FindingType = 'WHY_ZERO' | 'OPPORTUNITY' | 'DOING_WELL'

export interface Finding {
  type: FindingType
  title: string
  description: string
  amount?: number
}

export interface AnalysisSummary {
  name: string
  empNo: string
  calcNo: string
  totPayAmt: number
  ntaxSum: number
  resIncmTax: number
  resInhabtTax: number
  effctvTaxRate: number
  subIncmTax: number
  subInhabtTax: number
  prodTaxAmt: number
  calcMode: 'standard' | 'special'
  standardTax: number
  specialTax: number
  keepPs: string
  workMonths: number
  houseHldrYn: string
  confYn: string
  habtCls: string
  homeCls: string
}

export interface AnalysisResult {
  summary: AnalysisSummary
  whyZero: Finding[]
  opportunities: Finding[]
  doingWell: Finding[]
  procTotal: string
}
