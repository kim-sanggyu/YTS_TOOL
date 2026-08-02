/**
 * 매핑 내부 정합성 검사 — 파생매핑 ↔ MAPPING 코드셋 대조 (순수함수).
 *
 * ▶ 배경: amtClusCd(8xxx) 코드가 두 곳에 병렬 관리된다.
 *   - MAPPING_YYYY (2025.ts 등): 전 항목 코드 총람(전송/대조 기준).
 *   - 파생매핑 (gift/card/medi/pension/investment/personal): 카테고리·연차·JSON키 등
 *     "구조"를 담으며 그 안에 amtClusCd 를 소유. MAPPING 과 겹치는 건 오직 "코드 문자열".
 *   개정 때 한쪽만 고치면 조용히 어긋난다(2026-07-16 8741 잉여행 사례). 이 함수가 그 어긋남을 잡는다.
 *
 * ▶ 설계: 강한 통합(코드 단일화)은 파생매핑 고유 구조를 흡수 못 해 불가능(2026-07-31 종이검증).
 *   대신 "두 코드셋이 일치하는가"만 감시. 완전 통합의 실익(코드 문자열 중복 제거)을 이 함수 하나로 대체.
 *
 * ▶ 공유: 이 함수를 vitest(회귀 자동차단)와 현황탭 버튼(화면 즉시확인)이 함께 쓴다(로직 두 벌 방지).
 */

import type { MappingRow } from "./types"
import { GIFT_CODES } from "./gift"
import { CARD_CATS, CARD_SUBTOTAL_CODE } from "./card"
import { MEDI_CATS, MEDI_SUBTOTAL_CODE } from "./medi"
import { PENSION_TYPES, PENSION_SUBTOTAL_CODE } from "./pension"
import { INVESTMENT_TYPES, INVESTMENT_SUBTOTAL_CODE } from "./investment"
import { PERSONAL_ROWS } from "./personal"
import { makeYearVerdict, outCodeOf, SUBTOTAL_CODES, FLOW_CODES } from "@/features/hometax-calc/lib/ddcVerdict"

/**
 * 파생매핑은 알지만 MAPPING 행이 없어도 정상인 코드(정상 예외).
 * 국세청이 결과로만 반환하는 소계/총합 등 "전송행이 애초에 불필요"한 코드가 여기 온다.
 * ※ 실측(probe) 후에만 추가한다. 근거 주석 필수.
 */
export const CONSISTENCY_WHITELIST = new Set<string>([
  // 8706 = 연금계좌 세액공제 "총합"(국세청 OUT 결과전용). 연금은 항목별(8701~8708) self 대조라
  //   총합은 항목별 합으로 자체계산(pensionList.ts) → 8706 수신값을 대조에 안 씀. MAPPING IN 전송행이
  //   없는 게 정상. 카드8430·의료8726·투자8410은 MAPPING outCode/ntsCode 로 등장해 안 뜨나, 연금만
  //   MAPPING 에 없어 뜨는 비대칭이라 명시적 예외로 통과시킨다. (2026-07-31 실측확정)
  "8706",
])

interface DerivedSource {
  name: string
  /** 이 파생매핑이 참조하는 amtClusCd 전부 */
  codes: string[]
  /**
   * 역방향(MAPPING→파생) 대조가 가능한 소스만 지정하는 group 판정.
   * group 이 파생 소스와 1:1 로 떨어지는 카드/의료/기부금/연금만 역방향 검사한다.
   * (투자조합·인적공제는 group 이 다른 항목과 섞여 정방향만.)
   */
  group?: (group: string) => boolean
}

const dedupe = (codes: string[]): string[] => [...new Set(codes)]

/** 파생매핑 6곳의 코드셋을 소스별로 수집. */
function derivedSources(): DerivedSource[] {
  return [
    { name: "기부금(gift)",     codes: [...GIFT_CODES],                                                        group: g => g === "기부금" },
    { name: "신용카드(card)",   codes: [...CARD_CATS.map(c => c.code), CARD_SUBTOTAL_CODE],                    group: g => g.includes("신용카드") },
    { name: "의료비(medi)",     codes: [...MEDI_CATS.map(c => c.code), MEDI_SUBTOTAL_CODE],                    group: g => g === "의료비" },
    { name: "연금계좌(pension)", codes: dedupe([...Object.values(PENSION_TYPES).map(p => p.code), PENSION_SUBTOTAL_CODE]), group: g => g === "연금계좌" },
    { name: "투자조합(investment)", codes: [...INVESTMENT_TYPES.flatMap(t => Object.values(t.codes)), INVESTMENT_SUBTOTAL_CODE] },
    { name: "인적공제(personal)", codes: PERSONAL_ROWS.map(r => r.code) },
  ]
}

export type ConsistencyDirection = "MAPPING누락" | "파생누락" | "유형서명"

export interface ConsistencyIssue {
  source:    string               // 어느 파생매핑
  code:      string               // 어긋난 amtClusCd
  direction: ConsistencyDirection // MAPPING누락=파생엔 있는데 MAPPING에 없음 / 파생누락=그 반대
  detail:    string
}

export interface ConsistencyResult {
  ok:     boolean
  issues: ConsistencyIssue[]
}

/**
 * 파생매핑 ↔ MAPPING 코드셋 대조. 어긋남이 없으면 ok:true.
 *   ① 정방향(MAPPING누락): 파생매핑이 참조하는 코드가 MAPPING(ntsCode∪outCode∪sendCode)에 없음
 *      → 파생만 고치고 MAPPING 반영을 빠뜨린 사고.
 *   ② 역방향(파생누락): MAPPING 의 파생 group 코드가 파생매핑에 없음(카드/의료/기부금/연금만)
 *      → MAPPING 만 고치고 파생 반영을 빠뜨린 사고.
 *   ③ 유형서명: 각 행의 (전송·self OUT 존재)가 대응관계 유형(relationTypeOf)이 요구하는 서명과 맞는가
 *      → "유형이 속성 존재여부를 결정·검증"(계약의 축소판). 집계에 send:true, self에 OUT 누락 등 배선사고를 잡음.
 */
export function checkMappingConsistency(mapping: MappingRow[]): ConsistencyResult {
  const mappingCodes = new Set<string>()
  for (const row of mapping) {
    mappingCodes.add(row.ntsCode)
    if (row.outCode) mappingCodes.add(row.outCode)
    if (row.sendCode) mappingCodes.add(row.sendCode)
  }

  const issues: ConsistencyIssue[] = []
  const sources = derivedSources()

  // ① 정방향: 파생 코드가 MAPPING 에 존재하는가
  for (const src of sources) {
    for (const code of src.codes) {
      if (CONSISTENCY_WHITELIST.has(code)) continue
      if (!mappingCodes.has(code)) {
        issues.push({
          source: src.name, code, direction: "MAPPING누락",
          detail: `파생매핑 ${src.name}이 참조하는 ${code}가 MAPPING에 없음`,
        })
      }
    }
  }

  // ② 역방향: MAPPING 파생 group 코드가 파생매핑에 존재하는가 (group 1:1 소스만)
  for (const src of sources) {
    if (!src.group) continue
    const srcSet = new Set(src.codes)
    for (const row of mapping) {
      if (!src.group(row.group)) continue
      if (CONSISTENCY_WHITELIST.has(row.ntsCode)) continue
      if (!srcSet.has(row.ntsCode)) {
        issues.push({
          source: src.name, code: row.ntsCode, direction: "파생누락",
          detail: `MAPPING "${row.group}"의 ${row.ntsCode}가 파생매핑 ${src.name}에 없음`,
        })
      }
    }
  }

  // ③ 유형 서명: 각 행의 (전송·self OUT 존재)가 대응관계 유형과 맞는가.
  //    self(1:1)=IN·OUT 둘 다 / 멤버(·N:1)=IN만 / 집계(N:1·)=OUT만 / 입력전용(1:0)=IN만. 어긋나면 배선 사고.
  //    relationTypeOf 는 SUBTOTAL_OF 로 유형을 파생 → 여기선 "그 유형이 요구하는 속성이 실제로 있는지"를 대조(순환 아님).
  //    self OUT = outCodeOf self · 소계코드 · FLOW echo(총급여 8900). (A5의 8003 send:true 오배선이 이 검사에 걸렸을 위반.)
  const { relationTypeOf } = makeYearVerdict(mapping)
  const REL_SIG: Record<string, [inNts: boolean, outSelf: boolean]> = {
    "1:1": [true, true], "·N:1": [true, false], "N:1·": [false, true], "1:0": [true, false],
  }
  const mark = (b: boolean) => (b ? "○" : "✗")
  for (const row of mapping) {
    const rel = relationTypeOf(row)
    const sig = REL_SIG[rel]
    if (!sig) continue   // 1:N·0:1 등 미파생 유형은 스킵
    const inNts   = row.send
    const outSelf = outCodeOf(row) === row.ntsCode || SUBTOTAL_CODES.has(row.ntsCode) || FLOW_CODES.has(row.ntsCode)
    if (inNts !== sig[0] || outSelf !== sig[1]) {
      issues.push({
        source: "유형서명", code: row.ntsCode, direction: "유형서명",
        detail: `${rel} 기대(IN ${mark(sig[0])}·selfOUT ${mark(sig[1])}) ≠ 실제(IN ${mark(inNts)}·selfOUT ${mark(outSelf)})`,
      })
    }
  }

  return { ok: issues.length === 0, issues }
}
