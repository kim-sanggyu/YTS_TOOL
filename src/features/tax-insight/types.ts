export type TaxFilterType    = 'all' | 'zero' | 'nonzero'
export type CalcFilterType   = 'all' | 'standard' | 'special'
export type WorkFilterType   = 'all' | 'continue' | 'midleave'
export type ReviewFilterType = 'all' | 'standardcontinue' | 'housingsavings' | 'housingsavings400' | 'ralr' | 'card' | 'medi' | 'incomeexhausted' | 'taxexhausted' | 'manyinput'

export interface CalcListItem {
  calcNo: string
  name: string
  resIncmTax: number
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
  NAME: string
  TOT_PAY_AMT: number
  ADD_SUB_HDC_PERS_CNT: number
  SPCL_IF_HLTH_INSU_AMT: number
  SPCL_IF_EMP_INSU_AMT: number
  SP_HOUSE_RALR_LENDER_AMT: number
  SP_HOUSE_RALR_HABT_AMT: number
  PROD_TAX_AMT: number
  SPCL_IF_GRT_INSU_AMT: number
  SPCL_IF_HDC_PERS_INSU_AMT: number
  SPCL_MEDI_AMT: number
  SPCL_EDU_AMT: number
  SPCL_HL_AMT: number
  SPCL_HOME_LOVE: number
  RSIGN_PEN_TECH_AMT: number
  RSIGN_PEN_RET_AMT: number
  RSIGN_PEN_PF_AMT: number
  ISA_PEN_AMT: number
  RES_INCM_TAX: number
  EFFCTV_TAX_RATE: number
  CALC_METHOD: string
  CALC_PROC_TOTAL: string
  CALC_PROC_CARD: string | null
  CALC_PROC_MEDI: string | null
  // PAY_WRK_MAIN
  HOUSE_HLDR_YN: string
  MAIN_HOUSE_RENT: number | null
  MAIN_HLTH_INSU_AMT: number | null
  MAIN_EMP_INSU_AMT: number | null
  MAIN_HOUSE_LOAN_SBSC: number | null
  MAIN_HOUSE_LOAN_ALL: number | null
  MAIN_HOUSE_LOAN_WRK: number | null
  MAIN_HOUSE_RALR_LENDER: number | null
  MAIN_HOUSE_RALR_HABT: number | null
}

export type FindingType = 'ANALYSIS' | 'OPPORTUNITY'

export interface Finding {
  type: FindingType
  title: string
  description: string
  amount?: number
}

export interface AnalysisSummary {
  name: string
  calcNo: string
  totPayAmt: number
  resIncmTax: number
  effctvTaxRate: number
  prodTaxAmt: number
  calcMode: 'standard' | 'special'
  standardTax: number
  specialTax: number
}

export interface AnalysisResult {
  summary: AnalysisSummary
  analysis: Finding[]
  opportunities: Finding[]
  procTotal: string
}
