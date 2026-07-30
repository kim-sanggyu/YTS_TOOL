import { describe, it, expect } from "vitest"
import { checkMappingConsistency, CONSISTENCY_WHITELIST } from "../consistency"
import { MAPPING_2025 } from "../2025"
import { MAPPING_2026 } from "../2026"

// 파생매핑(gift/card/medi/pension/investment/personal) ↔ MAPPING 코드셋 baseline 잠금.
//   ★현재 드리프트 0(2026-07-31 실측). 개정 때 한쪽만 고쳐 어긋나면 이 테스트가 CI 에서 차단한다.
//   어긋남을 의도한 개정이면 근거와 함께 MAPPING/파생매핑을 함께 고치거나 whitelist 를 갱신할 것.
describe("매핑 내부 정합성 — 파생매핑 ↔ MAPPING", () => {
  it("2025: 어긋남 없음(드리프트 0)", () => {
    const r = checkMappingConsistency(MAPPING_2025)
    expect(r.issues).toEqual([])
    expect(r.ok).toBe(true)
  })

  it("2026: 어긋남 없음(드리프트 0)", () => {
    const r = checkMappingConsistency(MAPPING_2026)
    expect(r.issues).toEqual([])
    expect(r.ok).toBe(true)
  })

  // whitelist 는 "OUT 결과전용이라 MAPPING IN행이 없는 게 정상"인 코드만. 무분별 확장 방지 잠금.
  it("whitelist 는 8706(연금계좌 총합) 하나뿐", () => {
    expect([...CONSISTENCY_WHITELIST]).toEqual(["8706"])
  })
})
