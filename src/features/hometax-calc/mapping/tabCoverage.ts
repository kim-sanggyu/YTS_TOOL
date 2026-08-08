/**
 * 탭 커버리지 감사 — 드로어 ③표가 ✗로 판정할 수 있는 코드가 어느 전용 탭 리스트에서 콕 집혀 나오는가 (순수함수).
 *
 * ▶ 배경(자기무결성): 드로어 ③표와 리스트는 같은 단일원천 ddcVerdict 로 판정하나, "판정 가능한 코드"가
 *   어느 탭 리스트에도 안 실리면 그 코드가 ✗여도 사람이 목록에서 못 찾는다(2026-08-01 고길동 세액감면 사례).
 *   전체(all) 탭은 롤업/결정세액 안전망일 뿐 코드별 핀포인트가 아니고, dev 콘솔 경고는 개발모드·런타임 한정.
 *   → "판정대상 코드(J) ⊆ 전용 탭 코드우주(T) ∪ whitelist" 를 정적으로(사람 데이터 없이) 잠근다.
 *
 * ▶ 설계: consistency.ts 와 형제. 매핑만으로 계산되는 순수함수 1개를 vitest(회귀 자동차단)와
 *   현황탭 "탭 커버리지" 버튼(화면 즉시확인)이 함께 쓴다(로직 두 벌 방지).
 *
 * ▶ T(전용 탭 코드우주)는 리스트 파일들의 행 선택 predicate 를 재현한다(consistency.ts 의 derivedSources 와 동형).
 *   ★리스트 파일(housingList/etcList/…)의 행 선택이 바뀌면 여기 tabUniverse 도 함께 동기(안 그러면 오탐/누락).
 */

import type { MappingRow } from "./types"
import { GIFT_CODES } from "./gift"
import { CARD_CATS, CARD_SUBTOTAL_CODE } from "./card"
import { MEDI_CATS, MEDI_SUBTOTAL_CODE } from "./medi"
import { PENSION_TYPES, PENSION_SUBTOTAL_CODE } from "./pension"
import { INVESTMENT_TYPES, INVESTMENT_SUBTOTAL_CODE } from "./investment"
import { PERSONAL_ROWS } from "./personal"
import { makeYearVerdict, SUBTOTAL_CODES, FLOW_CODES, REFERENCE_SUBTOTAL } from "@/features/hometax-calc/lib/ddcVerdict"

/**
 * 판정 가능하지만 어느 전용 탭에도 안 실리는 게 "알려진/수용된" 코드 (정상 예외).
 * ※ 감사(probe) 후에만, 근거 주석과 함께 추가한다.
 */
export const TAB_COVERAGE_WHITELIST = new Map<string, string>([
  // A. 연금보험료·건강고용보험료 — 기타 탭 그룹 자리(ETC_GROUPS PENSION_INS·SPECIAL_INS)가 disabled 스텁(리스트 미구현).
  //    self 1:1 이라 드로어 ③은 판정하나 전용 리스트 탭이 아직 없음. 원천징수 확정값이라 실무 diff 거의 없음(2026-08-08 감사확정).
  ["8201", "국민연금 — 연금보험료 탭 미구현(disabled)"],
  ["8205", "공무원연금 — 연금보험료 탭 미구현(disabled)"],
  ["8208", "군인연금 — 연금보험료 탭 미구현(disabled)"],
  ["8211", "사립학교교직원연금 — 연금보험료 탭 미구현(disabled)"],
  ["8215", "별정우체국연금 — 연금보험료 탭 미구현(disabled)"],
  ["8301", "건강보험료 — 건강고용보험료 탭 미구현(disabled)"],
  ["8305", "고용보험료 — 건강고용보험료 탭 미구현(disabled)"],
  // B. 본인 — 전원 동일(±1 절사 무해)이라 PERSONAL_ROWS 에서 의도적 제외(2026-07-28 상규님 수용).
  ["8001", "기본공제-본인 — 전원 동일 ±1 무해, 의도적 제외"],
  // C. 전용 탭만 없고 다른 축이 커버.
  ["8700", "근로소득세액공제 — ①결과비교 + 전체탭 8923(세액공제계) 롤업이 커버"],
  ["8705", "ISA 연금계좌 추가납입 소계 — 복합멤버 8707/8708 per-code(연금 탭)가 커버"],
])

export interface TabCoverageGap { code: string; label: string }
export interface TabCoverageResult {
  ok: boolean                    // whitelist 밖 사각 없음
  gaps: TabCoverageGap[]         // 예상 밖 사각(전용 탭·whitelist 어디에도 없음) → 조사 필요
  whitelisted: TabCoverageGap[]  // 알려진(수용된) 사각 — 화면 참고용
}

/**
 * 전용 탭이 리스트 라인으로 낼 수 있는 코드 우주(T).
 * 파생매핑 exported set + 기타 탭 그룹(housingList/etcList 등)의 행 선택 predicate 재현.
 */
function tabUniverse(mapping: MappingRow[]): Set<string> {
  const T = new Set<string>()
  const add = (c?: string | null) => { if (c) T.add(c) }

  for (const c of GIFT_CODES) add(c)                                                   // 기부 탭
  CARD_CATS.forEach(c => add(c.code)); add(CARD_SUBTOTAL_CODE)                         // 카드 탭
  MEDI_CATS.forEach(c => add(c.code)); add(MEDI_SUBTOTAL_CODE)                         // 의료 탭
  Object.values(PENSION_TYPES).forEach(p => add(p.code)); add(PENSION_SUBTOTAL_CODE)   // 연금 탭
  INVESTMENT_TYPES.forEach(t => Object.values(t.codes).forEach(add)); add(INVESTMENT_SUBTOTAL_CODE)  // 투자조합(기타>그룹)
  PERSONAL_ROWS.forEach(r => add(r.code))                                             // 인적공제·혼인자녀출산(기타>그룹)

  // 기타 탭 그룹/단일 — 리스트 파일 predicate 와 동기 유지(파일 바뀌면 여기도).
  for (const m of mapping) {
    if (m.tab === "기타" && m.send && m.resultCol) add(m.ntsCode)                       // etcList ETC_ROWS
    if (m.ytsCol?.startsWith("LOAN_") && m.resultCol) add(m.ntsCode)                    // housingList HOUSING_ROWS(주택자금)
    if (["8403", "8404", "8407"].includes(m.ntsCode) && m.resultCol) add(m.ntsCode)    // 주택마련저축
    if (["8451", "8452", "8453", "8501"].includes(m.ntsCode) && m.resultCol) add(m.ntsCode)  // 그밖의소득공제(잡)
    if (["8751", "8752", "8753"].includes(m.ntsCode) && m.resultCol) add(m.ntsCode)    // 기타세액공제
    if (m.group === "세액감면" && m.resultCol) add(m.ntsCode)                           // 세액감면 TAX_CUT_ROWS
    if (["8710", "8711"].includes(m.ntsCode) && m.resultCol) add(m.ntsCode)            // 보험료
  }
  add("8735")   // 교육비(getEducationItems 하드코딩 라인)
  return T
}

/**
 * ddcVerdict 가 실제로 diff/match 로 판정할 수 있는 코드(J).
 *   구조적 제외(FLOW·REFERENCE·순수 소계멤버) + YTS 공제값을 받을 수 없는 코드(동반입력 등, 런타임 항상 null) 제거.
 */
function judgeableCodes(mapping: MappingRow[]): TabCoverageGap[] {
  const { SUBTOTAL_OF, DDC_DOMAIN, COMPOSITE_MEMBERS } = makeYearVerdict(mapping)
  const labelOf = new Map<string, string>()
  mapping.forEach(m => { if (!labelOf.has(m.ntsCode)) labelOf.set(m.ntsCode, m.label) })
  for (const [code, meta] of SUBTOTAL_CODES) if (!labelOf.has(code)) labelOf.set(code, meta.label)

  // yts(=ytsDdcMap[code]) 없으면 ddcVerdict 는 null. YTS 공제값을 받을 수 있는 코드만 실제 판정대상.
  //   = resultCol(self)·selfComparable(복합 per-code)·소계(ytsOut)·기부(giftDdc).
  const canHaveYts = (code: string): boolean =>
    SUBTOTAL_CODES.has(code) || GIFT_CODES.has(code) ||
    mapping.some(m => m.ntsCode === code && (!!m.resultCol || !!m.selfComparable))

  const out: TabCoverageGap[] = []
  const seen = new Set<string>()
  for (const code of DDC_DOMAIN) {
    if (seen.has(code)) continue
    seen.add(code)
    if (FLOW_CODES.has(code)) continue
    if (REFERENCE_SUBTOTAL.has(code)) continue
    if (SUBTOTAL_OF.has(code) && !COMPOSITE_MEMBERS.has(code)) continue   // 순수 소계멤버는 소계행이 대조
    if (!canHaveYts(code)) continue                                       // 동반입력 등 YTS 공제값 없음 → 런타임 항상 null
    out.push({ code, label: labelOf.get(code) ?? "?" })
  }
  return out
}

/**
 * 판정대상(J) 중 전용 탭 코드우주(T)에도 whitelist 에도 없는 코드를 사각으로 보고.
 *   gaps 가 비면 ok:true("예상 밖 사각 없음"). whitelisted 는 알려진 사각(화면 참고).
 */
export function checkTabCoverage(mapping: MappingRow[]): TabCoverageResult {
  const T = tabUniverse(mapping)
  const gaps: TabCoverageGap[] = []
  const whitelisted: TabCoverageGap[] = []
  for (const j of judgeableCodes(mapping)) {
    if (T.has(j.code)) continue
    if (TAB_COVERAGE_WHITELIST.has(j.code)) whitelisted.push(j)
    else gaps.push(j)
  }
  return { ok: gaps.length === 0, gaps, whitelisted }
}
