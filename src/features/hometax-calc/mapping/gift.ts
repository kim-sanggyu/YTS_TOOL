/**
 * 기부금 GIFT_CLS(YTS 공통코드) ↔ NTS amtClusCd 매핑 + 유형 라벨.
 *
 * ▶ 데이터 원천: PAY_WRK_GIFT_ADJ (세액계산 후 유형×연도별 확정). 컬럼:
 *   - GIFT_ABLE_SUB_AMT = 공제대상금액 (NTS L03 으로 보낼 값, useAmt)
 *   - GIFT_SUB_AMT      = 세액공제액 (YTS 결과, 비교 기준)
 *   - GIFT_YY           = 기부 귀속연도 (당해 = 데이터연도, 이월 = 과거연도)
 *
 * ▶ 당해/이월 코드: diff = 데이터귀속연도 − GIFT_YY.
 *   diff 0 = 당해(base), 1~5 = 이월 N년차(carry[N-1]). 특례·일반기부금만 이월 존재.
 */

export interface GiftType {
  label: string
  base:  string
  carry?: string[]
  rank:  number   // 화면 표시 순서
}

export const GIFT_TYPES: Record<string, GiftType> = {
  "548-020": { label: "정치자금",     base: "8740", rank: 1 },
  "548-100": { label: "고향(일반)",   base: "8783", rank: 2 },
  "548-110": { label: "고향(특별)",   base: "8784", rank: 3 },
  "548-010": { label: "특례기부금",   base: "8743", carry: ["8811", "8812", "8813", "8814", "8815"], rank: 4 },
  "548-080": { label: "우리사주",     base: "8744", rank: 5 },
  "548-060": { label: "일반(종교외)", base: "8747", carry: ["8831", "8832", "8833", "8834", "8835"], rank: 6 },
  "548-070": { label: "일반(종교)",   base: "8746", carry: ["8821", "8822", "8823", "8824", "8825"], rank: 7 },
}

/** (GIFT_CLS, diff=귀속연도−GIFT_YY) → NTS amtClusCd. 매핑 없으면 null. */
export function giftNtsCode(giftCls: string, diff: number): string | null {
  const t = GIFT_TYPES[giftCls]
  if (!t) return null
  if (diff === 0) return t.base
  if (t.carry && diff >= 1 && diff <= t.carry.length) return t.carry[diff - 1]
  return null
}

export function giftTypeLabel(giftCls: string): string {
  return GIFT_TYPES[giftCls]?.label ?? giftCls
}

export function giftTypeRank(giftCls: string): number {
  return GIFT_TYPES[giftCls]?.rank ?? 99
}
