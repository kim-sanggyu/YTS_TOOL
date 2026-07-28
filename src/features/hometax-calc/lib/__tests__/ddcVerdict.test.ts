import { describe, test, expect } from "vitest"
import { ddcVerdict, diffCodesOf, SUBTOTAL_OF, type DdcCells } from "../ddcVerdict"

// ────────────────────────────────────────────────────────────
// ddcVerdict / diffCodesOf — 코드별 대조 판정 단일원천.
//   드로어 ③표·리스트 배지·차이만보기가 전부 이 함수를 쓴다(화면 간 판정 분기 금지).
//   같은 res·code 면 어느 호출자든 같은 결론 → "한 화면 자기모순"(리스트 ✓/드로어 ✗) 구조적 차단.
// ────────────────────────────────────────────────────────────

const cells = (nts: Record<string, number>, yts: Record<string, number>): DdcCells =>
  ({ ntsMap: nts, ytsDdcMap: yts })

describe("ddcVerdict — 기본 대조 (비기부 매핑코드 8002=배우자)", () => {
  test("YTS=NTS 둘 다 값 → match", () => {
    expect(ddcVerdict(cells({ "8002": 1_500_000 }, { "8002": 1_500_000 }), "8002")).toBe("match")
  })
  test("YTS≠NTS 둘 다 값 → diff", () => {
    expect(ddcVerdict(cells({ "8002": 1_500_000 }, { "8002": 1_400_000 }), "8002")).toBe("diff")
  })
  test("YTS 없음(비기부코드) → 대조점 아님(null)", () => {
    // 비기부코드는 undefined 를 0 으로 보지 않는다(부양가족 유형별 등 per-code 미추적 → 거짓양성 방지)
    expect(ddcVerdict(cells({ "8002": 1_500_000 }, {}), "8002")).toBeNull()
  })
  test("둘 다 0/없음 → 대조 없음(null)", () => {
    expect(ddcVerdict(cells({ "8002": 0 }, { "8002": 0 }), "8002")).toBeNull()
    expect(ddcVerdict(cells({}, {}), "8002")).toBeNull()
  })
})

describe("ddcVerdict — 판정대상 제외 규칙", () => {
  test("계산흐름 코드(FLOW)는 ③ 항목대조에서 제외 — 8900 총급여", () => {
    expect(ddcVerdict(cells({ "8900": 50_000_000 }, { "8900": 50_000_000 }), "8900")).toBeNull()
  })
  test("매핑 밖 코드(국세청 내부코드)는 null — 9999", () => {
    expect(ddcVerdict(cells({ "9999": 123 }, { "9999": 456 }), "9999")).toBeNull()
  })
  test("소계 멤버 코드는 소계행이 담당 → 개별은 null", () => {
    const member = [...SUBTOTAL_OF.keys()][0]   // 예: 카드/의료 개별 멤버
    expect(member).toBeDefined()
    expect(ddcVerdict(cells({ [member]: 100 }, { [member]: 90 }), member)).toBeNull()
  })
})

describe("ddcVerdict — 기부코드 특례(YTS 없어도 0 으로 대조)", () => {
  test("고향특별 8784: YTS 없음(0)인데 국세청 자체생성 1 → diff (에코 아닌 실차이 포착)", () => {
    expect(ddcVerdict(cells({ "8784": 1 }, {}), "8784")).toBe("diff")
  })
  test("기부코드도 둘 다 0 이면 대조 없음(null)", () => {
    expect(ddcVerdict(cells({ "8784": 0 }, {}), "8784")).toBeNull()
  })
})

describe("★기부금 이월 8746 오탐 회귀 (2026-07-28, Y202500150/398)", () => {
  // 종교기부가 전액 이월인 사람: 국세청은 당해 8746=0, 이월 8821=X 로 회신(선입선출).
  // YTS 도 코드별로 8821 에만 공제 → giftDdc 가 8821 만 채우고 8746 은 미배정해야 한다.
  test("수정 후: 8746 미배정 → 대조점 아님(null), 8821 은 일치", () => {
    const res = cells({ "8746": 0, "8821": 1_915_680 }, { "8821": 1_915_680 })
    expect(ddcVerdict(res, "8746")).toBeNull()    // 드로어에 ✗ 안 뜸(리스트에도 없음 → 모순 해소)
    expect(ddcVerdict(res, "8821")).toBe("match")
  })
  test("옛 결함 조합 재현: 8746 에 총액이 얹히면 diff 오탐 — resultCol 제외가 이 입력을 만들지 않는다", () => {
    // resultCol(RT_PSA_RELGN, 당해+이월 총액)이 8746 에 얹히던 옛 상태. 판정함수 자체는 정상 diff.
    // 근본수정은 runCompareForCalcNo(기부금 resultCol 제외)에서 이 입력 자체를 봉쇄 → 이 조합이 재현되면 회귀.
    const buggy = cells({ "8746": 0, "8821": 1_915_680 }, { "8746": 1_915_680, "8821": 1_915_680 })
    expect(ddcVerdict(buggy, "8746")).toBe("diff")
  })
})

describe("diffCodesOf — 코드집합 중 diff 만(중복제거·null 스킵)", () => {
  test("diff 코드만 추려낸다", () => {
    const res = cells({ "8002": 100, "8746": 50, "8103": 30 }, { "8002": 90, "8746": 50, "8103": 30 })
    // 8002=diff, 8746=match, 8103=match
    expect(diffCodesOf(res, ["8002", "8746", "8103"])).toEqual(["8002"])
  })
  test("null 코드·중복 코드는 스킵", () => {
    const res = cells({ "8002": 100 }, { "8002": 90 })
    expect(diffCodesOf(res, [null, "8002", "8002", null])).toEqual(["8002"])
  })
  test("차이 없으면 빈 배열", () => {
    const res = cells({ "8002": 100 }, { "8002": 100 })
    expect(diffCodesOf(res, ["8002"])).toEqual([])
  })
})
