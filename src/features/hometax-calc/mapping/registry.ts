/**
 * 연도별 매핑·프로파일 라우팅 (단일 원천). 엔진(runHometaxCalc·runCompareForCalcNo 등)은
 * MAPPING_2025 를 직접 참조하지 말고 getYearConfig(year) 로 연도 설정을 받는다.
 *
 * ▶ 새 연도 추가 = mapping/2026.ts(데이터) + PROFILE_2026(ntsProfile.ts) 만들어 CONFIGS 에 등록.
 *   엔진 코드는 건드리지 않는다(C 방식: 엔진 단일, 데이터/프로파일만 연도별).
 */
import type { Coverage, MappingRow } from "./types"
import { PROFILE_2025, type NtsProfile } from "./ntsProfile"
import { MAPPING_2025, COVERAGE_2025, PROC_LABEL_CODE_2025, NTS_RESULT_CODES, MARRIAGE_CREDIT } from "./2025"

export interface YearConfig {
  year:           string
  mapping:        MappingRow[]
  coverage:       Record<string, Coverage>
  procLabelCode:  Record<string, string>
  ntsResultCodes: { code: string; label: string }[]
  marriageCredit: number
  profile:        NtsProfile
}

const CONFIGS: Record<string, YearConfig> = {
  "2025": {
    year:           "2025",
    mapping:        MAPPING_2025,
    coverage:       COVERAGE_2025,
    procLabelCode:  PROC_LABEL_CODE_2025,
    ntsResultCodes: NTS_RESULT_CODES,
    marriageCredit: MARRIAGE_CREDIT,
    profile:        PROFILE_2025,
  },
}

/** 국세청 모의계산이 실제 제공되는(=등록된) 귀속연도 목록. */
export function availableYears(): string[] {
  return Object.keys(CONFIGS)
}

/** 귀속연도 → 연도 설정. 미등록 연도는 명시적으로 던져 조용한 오작동을 막는다. */
export function getYearConfig(year: string): YearConfig {
  const cfg = CONFIGS[year]
  if (!cfg) throw new Error(`지원하지 않는 귀속연도: ${year} (등록: ${Object.keys(CONFIGS).join(", ")})`)
  return cfg
}
