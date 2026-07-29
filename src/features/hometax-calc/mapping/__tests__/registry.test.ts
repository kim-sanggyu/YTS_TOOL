import { describe, it, expect } from "vitest"
import { getYearConfig, availableYears } from "../registry"
import { PROFILE_2025, PROFILE_2026 } from "../ntsProfile"
import {
  MAPPING_2025, COVERAGE_2025, PROC_LABEL_CODE_2025, NTS_RESULT_CODES, MARRIAGE_CREDIT,
  computeInputs as computeInputs2025, mappingSelectCols as mappingSelectCols2025, coverageOf as coverageOf2025,
} from "../2025"
import {
  MAPPING_2026, COVERAGE_2026, PROC_LABEL_CODE_2026, NTS_RESULT_CODES_2026, MARRIAGE_CREDIT_2026,
} from "../2026"
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

// ② 2026 배선 잠금.
//   2026 = 전송 프로파일만 바뀌고 매핑 데이터는 2025 물리복사(near-copy). detailRowExtra 병합이 유일한 엔진 확장.
describe("mapping registry — 2026 배선", () => {
  it("getYearConfig('2026')는 2026 데이터/프로파일을 그대로 참조한다", () => {
    const cfg = getYearConfig("2026")
    expect(cfg.mapping).toBe(MAPPING_2026)
    expect(cfg.coverage).toBe(COVERAGE_2026)
    expect(cfg.procLabelCode).toBe(PROC_LABEL_CODE_2026)
    expect(cfg.ntsResultCodes).toBe(NTS_RESULT_CODES_2026)
    expect(cfg.marriageCredit).toBe(MARRIAGE_CREDIT_2026)
    expect(cfg.profile).toBe(PROFILE_2026)
  })

  it("2026 프로파일은 국세청 실측 엔드포인트(2026-07-29 캡처)와 일치한다", () => {
    expect(PROFILE_2026.dropdownId).toBe("a_1905130000")
    expect(PROFILE_2026.actionId).toBe("ATEYSEDA001L01")
    expect(PROFILE_2026.screenId).toBe("UTEYSEJ0E001")
    expect(PROFILE_2026.l03Url).toContain("actionId=ATEYSEDA001L01")
    expect(PROFILE_2026.l03Url).toContain("screenId=UTEYSEJ0E001")
  })

  it("★C 불변식: detailRowExtra 는 2026만 있고 2025는 없다(2025 동작 불변 보증)", () => {
    expect(PROFILE_2025.detailRowExtra).toBeUndefined()
    expect(PROFILE_2026.detailRowExtra).toEqual({ ereClCd: "01", yrsSrvcClCd: "01", statusValue: "R", ddcRtnId: "" })
  })

  it("availableYears는 2025·2026 둘 다 반환", () => {
    expect(availableYears()).toEqual(expect.arrayContaining(["2025", "2026"]))
  })

  // near-copy 트립와이어: 지금 2026 은 2025 의 순수 복사(같은 코드셋·같은 send 집합).
  //   ★2026 개정으로 코드를 의도적으로 추가·변경하면 이 테스트를 함께 갱신한다(무심결 divergence 차단).
  it("2026 매핑은 2025 와 동일한 코드셋·send 집합(순수 복사)", () => {
    const sig = (rows: typeof MAPPING_2025) => rows.map(m => `${m.ntsCode}:${m.send ? 1 : 0}`).sort()
    expect(sig(MAPPING_2026)).toEqual(sig(MAPPING_2025))
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
