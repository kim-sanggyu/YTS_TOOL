/**
 * 연금계좌 세액공제 — PAY_WRK_PEN_SAVE_SPEC.PEN_SAVE_CLS(YTS 공통코드) ↔ NTS amtClusCd 매핑.
 *
 * ▶ 데이터 원천: PAY_WRK_PEN_SAVE_SPEC (연금저축 명세, 계좌·구분별 행).
 *   - PEN_SAVE_CLS      = 저축 구분코드(562-*)
 *   - PEN_SAVE_PMT_AMT  = 납입액(한도 적용 전 진짜 입력액, NTS 로 보낼 값)  ← ISA 는 전환액 원본(×10 불필요)
 *   - PEN_SAVE_SUB_AMT  = 공제대상액(한도 적용후)
 *
 * ▶ 계약(2026-07-12 프로브 실측 — X2026 5명 원단위 일치, 컬럼+×10 대신 이 방식 채택):
 *   - 보낼 값 : PEN_SAVE_PMT_AMT 를 코드별 합산해 8701/8702/8703/8707/8708 에 useAmt 로.
 *   - 받는 값 : NTS 8706(연금계좌 세액공제 총합) → YTS Σ(RT_RSIGN_PEN_*) 와 대조.
 *   - ※ 이 테이블엔 청약저축·장기집합투자 등 비(非)연금계좌 코드도 있어, 아래 매핑된 코드만 사용.
 */

export interface PensionType {
  label: string
  code:  string   // NTS amtClusCd
  rank:  number
}

/** PEN_SAVE_CLS(562-*) → NTS 연금계좌 코드 (연금계좌 세액공제 대상만) */
export const PENSION_TYPES: Record<string, PensionType> = {
  "562-020": { label: "과학기술인공제회",       code: "8701", rank: 1 },
  "562-010": { label: "근로자퇴직급여보장법",   code: "8702", rank: 2 },
  "562-025": { label: "확정기여퇴직연금",       code: "8702", rank: 3 },
  "562-040": { label: "연금저축",               code: "8703", rank: 4 },
  "562-130": { label: "ISA 퇴직연금계좌",       code: "8707", rank: 5 },
  "562-120": { label: "ISA 개인연금계좌",       code: "8708", rank: 6 },
}

/** NTS 코드별 표시 라벨 (목록 세부행 집계용) */
export const PENSION_CODE_LABEL: Record<string, string> = {
  "8701": "과학기술인",
  "8702": "퇴직연금(IRP)",
  "8703": "연금저축",
  "8707": "ISA-퇴직연금",
  "8708": "ISA-개인연금",
}

/** NTS 연금계좌 세액공제 총합 반환 코드 (비교 기준) */
export const PENSION_SUBTOTAL_CODE = "8706"

/** 연금계좌 세액공제로 취급하는 PEN_SAVE_CLS 목록 (SQL 필터·리스트 조회용) */
export const PENSION_CLS_LIST = Object.keys(PENSION_TYPES)

export function pensionNtsCode(cls: string): string | null {
  return PENSION_TYPES[cls]?.code ?? null
}
export function pensionTypeRank(cls: string): number {
  return PENSION_TYPES[cls]?.rank ?? 99
}
