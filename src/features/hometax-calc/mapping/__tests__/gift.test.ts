import { describe, test, expect } from "vitest"
import { giftCarryDiff, giftNtsCode, GIFT_TYPES } from "../gift"

// ────────────────────────────────────────────────────────────
// giftNtsCode(giftCls, diff) 골든테스트
//   diff = 국세청 귀속연도 − GIFT_YY (당해=0, 이월 N년차=N)
//   → NTS amtClusCd 매핑. 세법 개정/코드 이관 시 이 표가 흔들리면 즉시 감지.
//
// 실제 버그(8d26403)는 diff 계산부(giftList.ts:59 offset)에서 났고,
// 그 diff를 코드로 바꾸는 이 매핑은 순수함수라 여기서 결정적으로 잠근다.
// ▶ 다음 스텝: giftList.ts 의 offset(diff = ntsBase − GIFT_YY) 순수 추출 후 테스트.
// ────────────────────────────────────────────────────────────

describe("giftCarryDiff — 이월 연차 계산 (offset 버그 지점, 8d26403)", () => {
  // 공식: giftYy===dataYear ? 0 : ntsBase−giftYy
  //   - 당해 판정은 dataYear(YTS), 이월 연차는 ntsBase(국세청) 기준.
  //   - 이 함수의 현재 동작을 그대로 잠근다(behavior-preserving 추출).

  test("정상연도(dataYear=ntsBase=2026): 당해 0, 이월 1~5", () => {
    expect(giftCarryDiff(2026, 2026, 2026)).toBe(0) // 당해
    expect(giftCarryDiff(2025, 2026, 2026)).toBe(1) // 1년 이월
    expect(giftCarryDiff(2024, 2026, 2026)).toBe(2)
    expect(giftCarryDiff(2021, 2026, 2026)).toBe(5) // 5년 이월(특례/일반 마지막 연차)
    expect(giftCarryDiff(2020, 2026, 2026)).toBe(6) // 범위 초과 → giftNtsCode 에서 null
  })

  test("전환기 offset(dataYear=2026, ntsBase=2025): 국세청 귀속연도 기준으로 밀림", () => {
    expect(giftCarryDiff(2026, 2026, 2025)).toBe(0) // GIFT_YY=dataYear → 당해
    expect(giftCarryDiff(2025, 2026, 2025)).toBe(0) // ntsBase−yy = 0 (국세청 당해)
    expect(giftCarryDiff(2024, 2026, 2025)).toBe(1) // 국세청 기준 1년 이월
    expect(giftCarryDiff(2020, 2026, 2025)).toBe(5)
  })

  test("diff 산출값이 giftNtsCode 와 그대로 연결된다 (특례 이월 파이프라인)", () => {
    // 정상연도 특례기부금 2021 귀속 → 5년 이월 → 8815
    const diff = giftCarryDiff(2021, 2026, 2026)
    expect(giftNtsCode("548-010", diff)).toBe("8815")
  })
})

describe("giftNtsCode — 당해(diff 0) → base 코드", () => {
  test("각 유형의 당해 코드", () => {
    expect(giftNtsCode("548-020", 0)).toBe("8740") // 정치자금
    expect(giftNtsCode("548-100", 0)).toBe("8783") // 고향(일반)
    expect(giftNtsCode("548-110", 0)).toBe("8784") // 고향(특별)
    expect(giftNtsCode("548-010", 0)).toBe("8743") // 특례기부금
    expect(giftNtsCode("548-080", 0)).toBe("8744") // 우리사주
    expect(giftNtsCode("548-060", 0)).toBe("8747") // 일반(종교외)
    expect(giftNtsCode("548-070", 0)).toBe("8746") // 일반(종교)
  })
})

describe("giftNtsCode — 이월(diff 1~5) → carry 코드", () => {
  test("특례기부금 이월 1~5년차", () => {
    expect(giftNtsCode("548-010", 1)).toBe("8811")
    expect(giftNtsCode("548-010", 2)).toBe("8812")
    expect(giftNtsCode("548-010", 3)).toBe("8813")
    expect(giftNtsCode("548-010", 4)).toBe("8814")
    expect(giftNtsCode("548-010", 5)).toBe("8815")
  })

  test("일반(종교) 이월 1~5년차", () => {
    expect(giftNtsCode("548-070", 1)).toBe("8821")
    expect(giftNtsCode("548-070", 5)).toBe("8825")
  })

  test("일반(종교외) 이월 1~5년차", () => {
    expect(giftNtsCode("548-060", 1)).toBe("8831")
    expect(giftNtsCode("548-060", 5)).toBe("8835")
  })
})

describe("giftNtsCode — 매핑 없음 → null", () => {
  test("이월 범위 초과(diff 6)", () => {
    expect(giftNtsCode("548-010", 6)).toBeNull()
  })

  test("carry 없는 유형에 이월 요청", () => {
    expect(giftNtsCode("548-020", 1)).toBeNull() // 정치자금
    expect(giftNtsCode("548-080", 1)).toBeNull() // 우리사주
    expect(giftNtsCode("548-100", 1)).toBeNull() // 고향(일반)
  })

  test("음수 diff 방어", () => {
    expect(giftNtsCode("548-010", -1)).toBeNull()
  })

  test("알 수 없는 GIFT_CLS", () => {
    expect(giftNtsCode("999-999", 0)).toBeNull()
    expect(giftNtsCode("", 0)).toBeNull()
  })
})

describe("giftNtsCode — 표 일관성(carry 정의 유형은 base≠carry, 5년차)", () => {
  test("carry 있는 유형은 정확히 5개 연차", () => {
    for (const [cls, t] of Object.entries(GIFT_TYPES)) {
      if (!t.carry) continue
      expect(t.carry).toHaveLength(5)
      // base 는 이월 코드와 겹치지 않아야
      expect(t.carry).not.toContain(t.base)
      // 마지막 연차까지 매핑되고 그 다음은 null
      expect(giftNtsCode(cls, t.carry.length)).toBe(t.carry[t.carry.length - 1])
      expect(giftNtsCode(cls, t.carry.length + 1)).toBeNull()
    }
  })
})
