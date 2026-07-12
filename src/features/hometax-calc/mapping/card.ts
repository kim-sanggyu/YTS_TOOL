/**
 * 신용카드 CALC_PROC_CARD(JSON) 항목 ↔ NTS amtClusCd 매핑 (단일 원천).
 *
 * ▶ 데이터 원천: PAY_WRK_CALC.CALC_PROC_CARD (YTS 계산엔진이 산출한 계산과정 스냅샷).
 *   가~아 = 카테고리별 사용액(전송값, useAmt) / 최종공제금액 = YTS 카드소득공제(비교 기준, = OTO_CARD_ETC).
 *
 * ▶ 계약(2026-07-12 프로브 실측 — 같은 귀속연도 3명 원단위 일치):
 *   - 보낼 값 : 가~아 사용액 → 아래 code 에 useAmt 로
 *   - 받는 값 : NTS 가 8430(카드 소계)에 총공제액 반환 → YTS 최종공제금액과 대조
 *   - ★주의  : 반드시 같은 귀속연도끼리 비교(과거연도→2025계산기는 소비증가분 특례만큼 차이).
 */

export interface CardCat {
  key:   string   // CALC_PROC_CARD JSON 키 (가~아)
  label: string
  code:  string   // NTS amtClusCd
  rank:  number   // 화면 표시 순서
}

/** 가~아 → NTS 코드 (표시 순서 = 일반사용 → 전통·대중 → 도서공연) */
export const CARD_CATS: CardCat[] = [
  { key: "가", label: "신용카드",        code: "8431", rank: 1 },
  { key: "나", label: "직불·선불카드",   code: "8432", rank: 2 },
  { key: "다", label: "현금영수증",      code: "8433", rank: 3 },
  { key: "사", label: "전통시장",        code: "8435", rank: 4 },
  { key: "아", label: "대중교통",        code: "8434", rank: 5 },
  { key: "라", label: "도서공연(신용)",  code: "8461", rank: 6 },
  { key: "마", label: "도서공연(직불)",  code: "8462", rank: 7 },
  { key: "바", label: "도서공연(현금)",  code: "8463", rank: 8 },
]

/** NTS 카드 총공제 반환 코드 (비교 기준) */
export const CARD_SUBTOTAL_CODE = "8430"

export interface CardParsed {
  /** 카테고리 key(가~아) → 사용액 */
  catAmts:  Record<string, number>
  /** YTS 최종 카드소득공제 (= OTO_CARD_ETC) */
  finalDdc: number
}

/** CALC_PROC_CARD JSON 문자열 → 카테고리별 사용액 + 최종공제금액. 없으면 null. */
export function parseCardProc(json: string | null | undefined): CardParsed | null {
  if (!json || json === "null") return null
  try {
    const c = JSON.parse(json) as Record<string, number>
    const catAmts: Record<string, number> = {}
    for (const cat of CARD_CATS) catAmts[cat.key] = Number(c[cat.key] ?? 0)
    return { catAmts, finalDdc: Number(c["최종공제금액"] ?? 0) }
  } catch {
    return null
  }
}
