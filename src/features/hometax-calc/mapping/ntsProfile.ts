/**
 * 국세청 모의계산 "전송 프로파일" — 연도별로 바뀌는 계약(엔드포인트·세션진입)만 격리.
 *
 * ▶ 2026 실측(2026-07-29 캡처)으로 확인: 코드체계·payload 구조는 2025와 같고,
 *   actionId·screenId·연도 드롭다운 id·detail 행별 필드만 바뀐다. 그 "전송 래퍼"를 여기 모은다.
 *   (매핑 데이터는 mapping/2025.ts·2026.ts, 이 프로파일은 registry.getYearConfig 로 라우팅)
 */

export interface NtsProfile {
  year:       string
  /** '연말정산 자동계산' 연도 드롭다운 항목 element id (세션 진입 클릭용) */
  dropdownId: string
  /** L03 계산 요청 actionId */
  actionId:   string
  /** L03 요청 screenId */
  screenId:   string
  /** 계산(L03) POST URL */
  l03Url:     string
  /** detail 각 행에 병합할 추가 필드(2026부터 attrYr/ereClCd/yrsSrvcClCd/statusValue 등). 없으면 없음. */
  detailRowExtra?: Record<string, string>
}

// 2025 — 현행값(runHometaxCalc.ts 에 하드코딩돼 있던 값을 그대로 이관, 동작 불변).
export const PROFILE_2025: NtsProfile = {
  year:       "2025",
  dropdownId: "a_1905120000",
  actionId:   "ATEYSEAA001L03",
  screenId:   "UTEYSEJF01",
  l03Url:     "https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEAA001L03&screenId=UTEYSEJF01&popupYn=false&realScreenId=",
}
