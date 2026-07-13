// ── 세액소진 판정·라벨 (EXHAUSTED_POINT) ──────────────────────────────────────
// 소진자는 산출세액이 앞 항목에서 바닥나 뒤 세액공제가 0으로 처리됨 → 개별 항목 YTS-NTS 비교가
// 무의미(거짓 불일치/거짓 일치). 판정은 그대로 두고 "소진" 표시만 해 차이 원인을 암시한다.
const EXHAUST_LABEL: Record<string, string> = {
  BASC_SUB_SELF_AMT:   "소득소진(본인)",
  BASC_SUB_FAMILY_AMT: "소득소진(부양가족)",
  NP_INSU_AMT:         "소득소진(국민연금)",
  RT_BASE_SUB_AMT:     "세액소진(표준세액공제)",
  RT_HOUSE_RENT_AMT:   "세액소진(월세)",
  RT_MEDI_AMT:         "세액소진(의료비)",
  RT_IF_GRT_INSU_AMT:  "세액소진(보험료)",
  RT_EDU_AMT:          "세액소진(교육비)",
  RT_HWC_AMT:          "세액소진(자녀)",
  RT_PER_CHI_AMT:      "세액소진(출산·입양)",
  RT_RSIGN_PEN_PF_AMT: "세액소진(연금저축)",
  RT_HL:               "세액소진(고향사랑)",
}

export function exhaustInfo(point: string | null): { exhausted: boolean; exhaustLabel: string | null } {
  if (!point || point === "NOT_EXHAUSTED") return { exhausted: false, exhaustLabel: null }
  return { exhausted: true, exhaustLabel: EXHAUST_LABEL[point] ?? (point.startsWith("RT_") ? "세액소진" : "소득소진") }
}
