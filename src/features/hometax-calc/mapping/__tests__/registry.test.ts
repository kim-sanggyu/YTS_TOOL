import { describe, it, expect } from "vitest"
import { getYearConfig, availableYears } from "../registry"
import { PROFILE_2025 } from "../ntsProfile"
import {
  MAPPING_2025, COVERAGE_2025, PROC_LABEL_CODE_2025, NTS_RESULT_CODES, MARRIAGE_CREDIT,
  computeInputs as computeInputs2025, mappingSelectCols as mappingSelectCols2025, coverageOf as coverageOf2025,
} from "../2025"
import { computeInputs, mappingSelectCols, mappingSentValue, coverageOf } from "../engine"

// ① 리팩터(엔진 추출 + 연도 registry) 동작보존 잠금.
//   2025 데이터를 registry/engine 경유로 읽어도 기존 2025.ts 바인딩과 완전히 동일해야 한다.
describe("mapping registry — 2025 동작보존", () => {
  it("getYearConfig('2025')는 2025 데이터/프로파일을 그대로 참조한다", () => {
    const cfg = getYearConfig("2025")
    expect(cfg.mapping).toBe(MAPPING_2025)
    expect(cfg.coverage).toBe(COVERAGE_2025)
    expect(cfg.procLabelCode).toBe(PROC_LABEL_CODE_2025)
    expect(cfg.ntsResultCodes).toBe(NTS_RESULT_CODES)
    expect(cfg.marriageCredit).toBe(MARRIAGE_CREDIT)
    expect(cfg.profile).toBe(PROFILE_2025)
  })

  it("2025 프로파일은 국세청 실측 엔드포인트와 일치한다", () => {
    expect(PROFILE_2025.dropdownId).toBe("a_1905120000")
    expect(PROFILE_2025.actionId).toBe("ATEYSEAA001L03")
    expect(PROFILE_2025.l03Url).toContain("actionId=ATEYSEAA001L03")
  })

  it("미등록 연도는 던진다(조용한 오작동 방지)", () => {
    expect(() => getYearConfig("1999")).toThrow()
  })

  it("availableYears는 등록된 연도만 반환", () => {
    expect(availableYears()).toContain("2025")
  })
})

describe("engine ≡ 2025.ts 래퍼 (연도 파라미터화 동치)", () => {
  const vals: Record<string, number> = {
    TOT_PAY_AMT: 50_000_000,
    FAM_MRRG: 1,            // 혼인공제 자격 → 8790 원본 500,000 전송 경로
    NP_INSU_OBJ_AMT: 2_400_000,
    CARD_8431: 1_000_000,
    ADD_SUB_OAT_CNT: 1,
  }

  it("mappingSelectCols 동일", () => {
    expect(mappingSelectCols(MAPPING_2025)).toEqual(mappingSelectCols2025())
  })

  it("coverageOf 동일", () => {
    for (const code of ["8900", "8431", "8730", "8790", "9999"]) {
      expect(coverageOf(code, COVERAGE_2025)).toEqual(coverageOf2025(code))
    }
  })

  it("computeInputs 동일", () => {
    expect(computeInputs(vals, MAPPING_2025, MARRIAGE_CREDIT)).toEqual(computeInputs2025(vals))
  })

  it("mappingSentValue: 혼인공제(8790) 자격자면 원본 정액 전송", () => {
    const row8790 = MAPPING_2025.find(m => m.ntsCode === "8790")!
    expect(mappingSentValue(row8790, vals, MARRIAGE_CREDIT)).toBe(500_000)
    expect(mappingSentValue(row8790, { FAM_MRRG: 0 }, MARRIAGE_CREDIT)).toBe(0)
  })
})
