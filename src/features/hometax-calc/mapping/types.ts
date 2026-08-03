/**
 * YTS39 ↔ 국세청(NTS) 매핑 공용 타입 — 연도 무관(단일 원천).
 * 데이터(mapping/2025.ts 등)와 로직(mapping/engine.ts)이 공유한다.
 */

export type MappingStatus = "확정" | "추정" | "미확보"
export type ValueKey = "useAmt" | "incDdcNfpCnt" | "ddcTrgtAmt"
export type SendRule = "value" | "flag" | "const1"

export interface MappingRow {
  group:     string
  ntsCode:   string
  label:     string
  ytsCol:    string | null
  resultCol?: string
  valueKey:  ValueKey
  rule:      SendRule
  status:    MappingStatus
  send:      boolean
  /** send:false 지만 값이 다른 코드로 대체 전송돼 실질 "미전송"이 아닌 경우(예 8003 부양가족통합→8004~09 유형별).
   *  ④ 미전송(차이 원인 후보)에서 제외 — 거짓경보 방지. */
  altSent?:  boolean
  /** 전용 비교탭 소속(예 "기타") — 잡다한 단일 세액공제 항목을 한 탭에 모을 때. 미지정=탭 없음. */
  tab?:      string
  /** 국세청 결과(OUT) 코드. 소계형만 명시(카드8430/의료8726/연금8706).
   *  미지정 = 세액공제성 그룹이면 self(ntsCode), 소득공제·입력이면 없음(—). */
  outCode?:  string
  /** 실제 국세청 "입력" 코드가 표시코드(ntsCode)와 다를 때만 지정. L03 전송은 sendCode 로.
   *  현재 사용 행 없음(주택청약종합저축은 2026-07-21 8407 단일화로 sendCode 제거). 숨은 입력코드 재발견 시 대비한 인프라. */
  sendCode?: string
  /** 상대 귀속연도(투자조합출자 등 연도별 코드). 현황탭이 입력연도(ntsYear)+offset 로 "○○○○년" 렌더. 0=당해,-1=직전,-2=2년전 */
  yearOffset?: number
  /** 표시전용 소계 그룹핑: 대조(outCode)는 그대로 두고 ③표 로스터에서만 이 소계코드 뒤 블록으로 묶어 렌더.
   *  부양가족 8004~09→8003(개별 인원 펼침) 등. outCode 와 분리 = 대조 로직 무영향. */
  displaySubtotal?: string
  /** 복합 유형(1:1·N:1) 표식 — self(per-code)이면서 소계 멤버.
   *  = "대조할 YTS per-code 원천이 있다"(투자조합·ISA의 PAY_WRK_PEN_SAVE_SPEC.PEN_SAVE_SUB_AMT).
   *  relationTypeOf 가 이 플래그로 1:1·N:1 을 판정. 계약표: docs/hometax-relation-contract-backlog.md */
  selfComparable?: boolean
  note?:     string
}

export type CoverageVerdict = "안전" | "사각" | "미검증" | "해당없음"
export type CoverageReview  = "검토중" | "확정"
export interface Coverage { verdict: CoverageVerdict; review: CoverageReview }

/** 상세뷰·미전송감지용 입력 한 행 */
export interface NtsInputRow {
  code:     string
  label:    string
  group:    string
  ytsCol:   string | null
  valueKey: ValueKey
  status:   MappingStatus
  send:     boolean
  /** send:false 지만 다른 코드로 대체 전송돼 실질 미전송 아님 → ④ 미전송에서 제외 */
  altSent:  boolean
  /** 원천 YTS 컬럼값 (const1 등 ytsCol 없으면 0) */
  ytsValue: number
  /** 원천 YTS 값이 있음(>0) — const1(본인 등)은 항상 true */
  hasValue: boolean
  /** 실제 L03 body 에 넣은 값 (미전송이면 0) */
  sent:     number
  /** 결과(OUT)를 조회할 코드. 소계형(카드8430/의료8726 등)은 본인 코드가 아닌 소계코드. 미지정=자기 코드 */
  outCode?: string
  note?:    string
}
