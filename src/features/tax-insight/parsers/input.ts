import type { InputData } from "../types"

export const INPUT_KEY_LABEL: Record<string, string> = {
  // 인적공제
  "SELF":                       "본인",
  "MATE":                       "배우자",
  "FAMILY":                     "부양가족 인원",
  "OAT":                        "경로우대 인원",
  "HDC":                        "장애인 인원",
  "LADY":                       "부녀자",
  "SNGL":                       "한부모",
  "CHLD":                       "자녀 세액공제 인원",
  "CHLD3":                      "출산·입양 첫째",
  "CHLD5":                      "출산·입양 둘째",
  "CHLD7":                      "출산·입양 셋째이상",
  "MRRG":                       "결혼세액공제",

  // 사회보험
  "NP_INSU_OBJ_AMT":            "국민연금 납부액",
  "SPCL_IF_HLTH_INSU_OBJ_AMT": "건강보험료",
  "SPCL_IF_EMP_INSU_OBJ_AMT":  "고용보험료",
  "PNINT_SUM":                  "주택임차차입금원리금상환액",

  // 신용카드
  "CARD_entered":               "신용카드등 총 사용액",
  "OTO_CARD_ETC":               "신용카드등 소득공제액",

  // 보험·의료·교육
  "GRT_INSU":                   "보장성보험료 납입액",
  "HDC_PERS_INSU":              "장애인전용보험료 납입액",
  "MEDI_entered":               "의료비 총 입력액",
  "SPCL_MEDI_AMT":              "의료비 공제대상금액",
  "RT_MEDI_AMT":                "의료비 세액공제액",
  "EDU_SUM":                    "교육비",

  // 기부금
  "SORT_CLS_10_SUM":            "기부금_특례",
  "SORT_CLS_21_SUM":            "기부금_정치자금(10만원이하)",
  "SORT_CLS_22_SUM":            "기부금_정치자금(10만원초과)",
  "SORT_CLS_30_SUM":            "기부금_고향사랑",
  "SORT_CLS_40_SUM":            "기부금_우리사주",
  "SORT_CLS_50_SUM":            "기부금_일반(종교단체외)",
  "SORT_CLS_60_SUM":            "기부금_일반(종교단체)",

  // 월세
  "HOUSE_RENT":                 "월세 납입액",

  // 세대 구분
  "HOUSEHOLD_MEMBER":           "세대원 여부 (1=세대원)",

  // 연금계좌 (562 코드)
  "562-010":                    "IRP(근로자퇴직급여보장법)",
  "562-020":                    "과학기술인공제회",
  "562-025":                    "확정기여퇴직연금(DC)",
  "562-030":                    "개인연금저축",
  "562-040":                    "연금저축",
  "562-050":                    "청약저축",
  "562-060":                    "주택청약종합저축",
  "562-070":                    "장기주택마련저축",
  "562-080":                    "근로자주택마련저축",
  "562-090":                    "장기주식형저축공제",
  "562-100":                    "장기집합투자증권저축",
  "562-110":                    "중소기업창업투자조합 출자",
  "562-120":                    "ISA계좌_연금구분_개인연금",
  "562-130":                    "ISA계좌_연금구분_퇴직연금",
  "562-140":                    "청년형장기집합투자증권저축",
  "562-ISA":                    "ISA 만기시 연금계좌 납입액",
}

export function parseInputData(json: string | null | undefined): InputData | null {
  if (!json || json === "null") return null
  try { return JSON.parse(json) as InputData } catch { return null }
}
