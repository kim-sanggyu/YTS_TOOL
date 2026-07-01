// 연말정산 대상 연도 — 매년 변경
export const CALC_YEAR = "X2026"
export const CALC_NO_PATTERN = `${CALC_YEAR}%`

// 조회 가능 연도 목록 (연도 → CALC_NO 패턴)
export const YEAR_PATTERN: Record<string, string> = {
  "2026": "X2026%",
}
export const AVAILABLE_YEARS = Object.keys(YEAR_PATTERN)
