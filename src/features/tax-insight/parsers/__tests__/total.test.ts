import { describe, test, expect } from "vitest"
import { parseTotalContext } from "../total"

// ────────────────────────────────────────────────────────────
// parseTotalContext 는 CALC_PROC_TOTAL 에서 "소진 감지 + 세대 구분"만 파싱한다.
//   (금액·입력값은 PAY_WRK_CALC/PAY_WRK_MAIN 컬럼 직접 사용 → 여기서 안 다룸)
// 아래 샘플은 실제 CALC_PROC_TOTAL 포맷을 축약한 것. 세법 개정 후 포맷이
// 바뀌면 이 테스트가 먼저 깨져서 알려준다.
// ────────────────────────────────────────────────────────────

// 소득소진 — 근로소득 잔액 0, 소진지점: 본인
const SAMPLE_INCOME_EXHAUSTED = `
  ▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣
   근로소득 잔액이 '0'이 되었습니다. 더 이상 공제하지 않습니다.
  ▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣

 ※ (자동)특별소득ㆍ세액공제 적용 세액 0 (표준적용時 0), 소진지점: 본인
`

// 세액소진(월세액)
const SAMPLE_TAX_EXHAUSTED_RENT = `
  ㆍ  1,877,233 (산출세액)

  ▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣
   [월세액] 항목에서 산출세액이 모두 소진되었습니다.
   이후 항목은 더 이상 공제하지 않습니다.
  ▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣▣
`

// 세액소진(의료비) + 이후 건너뛴 항목(표기생략/계산식생략)
const SAMPLE_TAX_EXHAUSTED_MEDI = `
  ㆍ    674,327 (산출세액)

   [의료비] 항목에서 산출세액이 모두 소진되었습니다.

  (잔액)          0 -           0 (교육비                        ) ※표기생략(산출세액 잔액 0)
  (잔액)          0 -           0 (기부금(종교단체外)             ) ※계산식생략(산출세액 잔액 0)
`

// ────────────────────────────────────────────────────────────

describe("parseTotalContext — 소득 소진", () => {
  test("소득소진 감지 + 소진지점 파싱", () => {
    const ctx = parseTotalContext(SAMPLE_INCOME_EXHAUSTED)
    expect(ctx.incomeExhausted).toBe(true)
    expect(ctx.incomeExhaustPoint).toBe("본인")
    expect(ctx.taxExhausted).toBe(false)
  })
})

describe("parseTotalContext — 세액 소진", () => {
  test("세액소진(월세액): taxExhausted=true, 소진지점=월세액, 소득소진 아님", () => {
    const ctx = parseTotalContext(SAMPLE_TAX_EXHAUSTED_RENT)
    expect(ctx.taxExhausted).toBe(true)
    expect(ctx.taxExhaustPoint).toBe("월세액")
    expect(ctx.incomeExhausted).toBe(false)
  })

  test("세액소진(의료비): 소진지점=의료비", () => {
    const ctx = parseTotalContext(SAMPLE_TAX_EXHAUSTED_MEDI)
    expect(ctx.taxExhausted).toBe(true)
    expect(ctx.taxExhaustPoint).toBe("의료비")
  })
})

describe("parseTotalContext — 세액소진 후 건너뛴 항목", () => {
  test("표기생략/계산식생략 줄에서 항목명 추출(중첩 괄호 처리)", () => {
    const ctx = parseTotalContext(SAMPLE_TAX_EXHAUSTED_MEDI)
    expect(ctx.taxExhaustedSkipped).toEqual(["교육비", "기부금(종교단체外)"])
  })

  test("건너뛴 항목 없으면 빈 배열", () => {
    const ctx = parseTotalContext(SAMPLE_TAX_EXHAUSTED_RENT)
    expect(ctx.taxExhaustedSkipped).toEqual([])
  })
})

describe("parseTotalContext — 세대 구분(isHouseHolder)", () => {
  test("세대주 → true", () => {
    const ctx = parseTotalContext("※ 김철수님(부양가족 3명, 세대주)")
    expect(ctx.isHouseHolder).toBe(true)
  })

  test("세대주배우자 → true", () => {
    const ctx = parseTotalContext("※ 이영희님(세대주배우자)")
    expect(ctx.isHouseHolder).toBe(true)
  })

  test("세대원 → false", () => {
    const ctx = parseTotalContext("※ 박민수님(세대원)")
    expect(ctx.isHouseHolder).toBe(false)
  })

  test("세대 구분 없음 → null (DB 폴백)", () => {
    const ctx = parseTotalContext("※ 홍길동님(부양가족 없음)")
    expect(ctx.isHouseHolder).toBeNull()
    expect(parseTotalContext("푸터에 사람 정보 없음").isHouseHolder).toBeNull()
  })
})

describe("parseTotalContext — 소진 없음/빈 입력", () => {
  test("정상 케이스: 소진 없음", () => {
    const ctx = parseTotalContext("ㆍ  5,000,000 (산출세액)")
    expect(ctx.incomeExhausted).toBe(false)
    expect(ctx.taxExhausted).toBe(false)
    expect(ctx.taxExhaustedSkipped).toEqual([])
    expect(ctx.isHouseHolder).toBeNull()
  })

  test("빈 문자열: 모두 기본값", () => {
    const ctx = parseTotalContext("")
    expect(ctx.incomeExhausted).toBe(false)
    expect(ctx.incomeExhaustPoint).toBe("")
    expect(ctx.taxExhausted).toBe(false)
    expect(ctx.taxExhaustPoint).toBe("")
  })
})
