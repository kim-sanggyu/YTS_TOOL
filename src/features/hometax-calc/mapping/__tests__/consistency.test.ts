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

  // ③ 유형서명 검증 — 유형(relationTypeOf)이 요구하는 IN/OUT 존재여부와 어긋난 배선 감지.
  //   오탐0은 위 2025/2026 issues===[] 가 이미 잠금(③ 포함 전 검사 통과). 여기선 "위반을 실제로 잡는가"를 잠근다.
  it("③ 유형서명: 집계코드(N:1·)에 send:true면 위반 감지 (A5-class 오배선)", () => {
    const broken = MAPPING_2025.map(m => (m.ntsCode === "8003" ? { ...m, send: true } : m))
    const r = checkMappingConsistency(broken)
    expect(r.ok).toBe(false)
    expect(r.issues.some(i => i.code === "8003" && i.direction === "유형서명")).toBe(true)
  })

  // whitelist 는 "OUT 결과전용이라 MAPPING IN행이 없는 게 정상"인 코드만. 무분별 확장 방지 잠금.
  it("whitelist 는 8706(연금계좌 총합) 하나뿐", () => {
    expect([...CONSISTENCY_WHITELIST]).toEqual(["8706"])
  })
})
