/**
 * 의료비 CALC_PROC_MEDI(JSON) 항목 ↔ NTS amtClusCd 매핑 (단일 원천).
 *
 * ▶ 데이터 원천: PAY_WRK_CALC.CALC_PROC_MEDI (YTS 계산엔진 산출 스냅샷).
 *   대상자별 "지출금액"(전송값, useAmt) / 의료비_공제금액 = YTS 세액공제(비교 기준, = RT_MEDI_AMT).
 *
 * ▶ 계약(2026-07-12 프로브 실측 — 같은 귀속연도 3명 원단위 일치):
 *   - 보낼 값 : 대상자별 "지출금액" → 아래 code 에 useAmt 로 (★공제대상금액 아님!)
 *               NTS 가 3% 최저사용액 차감을 자체계산하므로 지출금액(차감 전)을 보내야 맞음.
 *   - 받는 값 : NTS 8726(의료비 세액공제 총액) → YTS 의료비_공제금액과 대조.
 *   - 실손    : YTS 지출금액이 이미 실손보험금 차감 후 값(NTS 실손 별도입력 없음).
 *   - ★주의  : 반드시 같은 귀속연도끼리 비교.
 */

export interface MediCat {
  key:   string   // CALC_PROC_MEDI 지출금액 JSON 키
  label: string
  code:  string   // NTS amtClusCd
  rank:  number
}

/** 대상자별 지출금액 키 → NTS 코드 */
export const MEDI_CATS: MediCat[] = [
  { key: "본인등배려자",   label: "본인·65세·장애인",    code: "8720", rank: 1 },
  { key: "그밖의부양가족", label: "그 밖의 공제대상자",  code: "8721", rank: 2 },
  { key: "난임시술비",     label: "난임시술비",          code: "8725", rank: 3 },
  { key: "미숙아등이상아", label: "미숙아·선천성이상아", code: "8729", rank: 4 },
]

/** NTS 의료비 세액공제 총액 반환 코드 (비교 기준) */
export const MEDI_SUBTOTAL_CODE = "8726"

export interface MediParsed {
  /** 대상자 key → 지출금액 */
  catAmts:  Record<string, number>
  /** YTS 최종 의료비 세액공제 (= RT_MEDI_AMT) */
  finalDdc: number
}

/** CALC_PROC_MEDI JSON 문자열 → 대상자별 지출금액 + 최종공제금액. 없으면 null. */
export function parseMediProc(json: string | null | undefined): MediParsed | null {
  if (!json || json === "null") return null
  try {
    const m = JSON.parse(json) as Record<string, number>
    const catAmts: Record<string, number> = {}
    for (const cat of MEDI_CATS) catAmts[cat.key] = Number(m[cat.key] ?? 0)
    return { catAmts, finalDdc: Number(m["의료비_공제금액"] ?? 0) }
  } catch {
    return null
  }
}
