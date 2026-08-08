import { describe, it, expect } from "vitest"
import { checkTabCoverage, TAB_COVERAGE_WHITELIST } from "../tabCoverage"
import { MAPPING_2025, type MappingRow } from "../2025"
import { MAPPING_2026 } from "../2026"

// 탭 커버리지 baseline 잠금 — 드로어 ③표가 판정 가능한 코드가 전용 탭·whitelist 어디에도 없으면 사각.
//   ★현재 예상 밖 사각 0(2026-08-08 감사). 매핑에 코드가 늘어 어느 탭도 안 집는 코드가 생기면 이 테스트가 차단한다.
//   의도된 사각(원천확정값 등)이면 근거와 함께 TAB_COVERAGE_WHITELIST 에 등록할 것.
describe("탭 커버리지 — 드로어 판정대상 ⊆ 전용 탭 ∪ whitelist", () => {
  it("2025: 예상 밖 사각 없음", () => {
    const r = checkTabCoverage(MAPPING_2025)
    expect(r.gaps).toEqual([])
    expect(r.ok).toBe(true)
  })

  it("2026: 예상 밖 사각 없음", () => {
    const r = checkTabCoverage(MAPPING_2026)
    expect(r.gaps).toEqual([])
    expect(r.ok).toBe(true)
  })

  // whitelist = "판정 가능하나 전용 탭에 안 실리는 게 정상"인 코드만. 무분별 확장 방지 잠금.
  //   A(연금·건강고용보험료 7) + B(본인 1) + C(8700·8705 다른축 커버 2) = 10.
  it("whitelist 는 알려진 10개 사각으로 고정", () => {
    expect([...TAB_COVERAGE_WHITELIST.keys()]).toEqual([
      "8201", "8205", "8208", "8211", "8215", "8301", "8305", "8001", "8700", "8705",
    ])
  })

  // whitelist 코드가 실제로 전용 탭 밖이라 whitelisted 로 잡히는지(=whitelist 가 죽은 항목 아님) 잠금.
  it("whitelist 10개는 실제로 탭 우주 밖(whitelisted 로 분류)", () => {
    const r = checkTabCoverage(MAPPING_2025)
    expect(r.whitelisted.map(w => w.code).sort()).toEqual([...TAB_COVERAGE_WHITELIST.keys()].sort())
  })

  // 감지력: 전용 탭·whitelist 어디에도 없는 self 코드가 생기면 사각으로 잡는가.
  it("감지력: 고아 self 코드(전용탭·whitelist 밖)를 사각으로 포착", () => {
    const orphan: MappingRow = {
      group: "테스트", ntsCode: "8899", label: "고아코드", ytsCol: "RT_FOO", resultCol: "RT_FOO",
      valueKey: "useAmt", rule: "value", status: "진행", send: true,
    }
    const r = checkTabCoverage([...MAPPING_2025, orphan])
    expect(r.ok).toBe(false)
    expect(r.gaps.some(g => g.code === "8899")).toBe(true)
  })
})
