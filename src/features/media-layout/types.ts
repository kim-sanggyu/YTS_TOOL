// ── 전산매체 레이아웃 ─────────────────────────────────────────

export interface TaxLayoutRow {
  구분:  string
  코드:  string   // 항목 코드 (A1, C5 …)
  항목:  string
  값:    string
  타입?: string   // x | 9
  길이?: number
  sect: string    // HEAD | BODY_N | FOOT
}

// ── Java 소스 파싱 결과 ────────────────────────────────────────
// (java-layout-parser.ts 의 출력 타입 — 공유 타입으로 여기서 정의)

export interface JavaField {
  record:      string   // 레코드 구분 (A-K)
  no:          string   // 소스 내 항목코드 주석 (A1, C64ⓐ …) — 비교 단계에서 의미 없음
  name:        string   // 항목명 (소스 주석 기준)
  dtype:       string   // x | 9
  len:         number   // 필드 길이
  cum:         number   // 레코드 내 누적 길이
  lineNo:      number   // 소스 파일 행 번호
  raw:         string   // 원본 makeStr() 표현식
  sect:        string   // HEAD | BODY_N | FOOTER (파서 추정)
  bodyIter?:   number   // 반복 회차 (BODY 필드만)
}

// ── 비교 행 ───────────────────────────────────────────────────
// 전산매체(기준) ↔ Java 소스 1:1 매치 행.
// tax 쪽은 순서 고정. java 쪽은 D/I 조작으로 조정.
// 매치 확정 후 matchedTaxCode 에 전산매체 항목코드(A1, C5…)가 저장됨.

export interface CompareRow {
  seq:              number
  tax:              TaxLayoutRow | null   // null = D 로 tax 슬롯을 비운 자리
  java:             JavaField    | null   // null = I 로 삽입된 빈 슬롯
  cmd:              "D" | "I" | "M" | null
  editedRaw?:       string                // M: 사용자가 수정한 makeStr 표현식
  matchedTaxCode?:  string                // 확정된 전산매체 항목코드
}
