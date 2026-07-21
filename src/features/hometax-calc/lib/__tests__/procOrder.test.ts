import { describe, test, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { PROC_ROW_RE, procCodeOrder } from "../procOrder"
import { PROC_LABEL_CODE_2025 } from "@/features/hometax-calc/mapping/2025"

// ────────────────────────────────────────────────────────────
// 계산과정(CALC_PROC_TOTAL) 순서 도출 골든테스트
//   실행과정 ③표(NTS 원본 IN/OUT)는 procCodeOrder 순서로 정렬된다.
//   계산과정은 세액계산 SW가 찍는 고정 65줄 템플릿 → 이 순서가 흔들리면(세법개정·라벨변경)
//   즉시 감지. 픽스처는 실 데이터(Y202500248) 원문.
// ────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url))
const sample = readFileSync(join(here, "fixtures", "calcProcTotal.sample.txt"), "utf8")

describe("PROC_ROW_RE — 내부 괄호 라벨 캡처", () => {
  test("일반 라벨", () => {
    const m = PROC_ROW_RE.exec("  (잔액)  75,218,057 -   1,500,000 (본인                                 ) min(...)")
    expect(m?.[2].trim()).toBe("본인")
    expect(m?.[1]).toBe("1,500,000")
  })
  test("내부 괄호 라벨(대출기관) — 구 정규식이 잘렸던 케이스", () => {
    const m = PROC_ROW_RE.exec("  (잔액)  63,593,307 -   2,673,033 (주택임차차입금원리금상환액(대출기관) ) min(...)")
    expect(m?.[2].trim()).toBe("주택임차차입금원리금상환액(대출기관)")
  })
  test("내부 괄호 라벨(조특법(30조제외))", () => {
    const m = PROC_ROW_RE.exec("  (잔액)   7,988,442 -           0 (조특법(30조제외)                     ) ")
    expect(m?.[2].trim()).toBe("조특법(30조제외)")
  })
})

describe("procCodeOrder — 계산과정 등장순(픽스처 골든)", () => {
  const order = procCodeOrder(sample)

  test("소득공제~세액공제 앞부분이 계산과정 순서와 정확히 일치", () => {
    // 본인→…→국민연금→공무원/군인/사학/우체국→건보/고용→주택임차/장기저당→그밖의소득공제…
    expect(order.slice(0, 25)).toEqual([
      "8001", "8002", "8003", "8101", "8102", "8103", "8104",           // 인적
      "8201", "8205", "8208", "8211", "8215",                           // 연금보험료
      "8301", "8305",                                                   // 건보/고용
      "8311", "8312",                                                   // 주택임차
      "8321", "8322", "8323", "8324", "8325", "8326", "8327", "8328", "8329", // 장기주택저당 9
    ])
  })

  test("소계형은 소계코드로 등장(카드8430·의료8726·교육8735·출산8761)", () => {
    expect(order).toContain("8430")  // 신용카드등
    expect(order).toContain("8726")  // 의료비
    expect(order).toContain("8735")  // 교육비
    expect(order).toContain("8761")  // 출산입양
  })

  test("혼인세액공제 8790 이 순서에 잡힘(구 라벨 '결혼세액공제' 불일치 버그 수정 확인)", () => {
    expect(order).toContain("8790")
    // 근로소득세액(8700) 바로 뒤, 자녀(8763) 앞
    expect(order.indexOf("8790")).toBe(order.indexOf("8700") + 1)
    expect(order.indexOf("8790")).toBeLessThan(order.indexOf("8763"))
  })

  test("중복 코드는 첫 등장만(고향사랑 8783 이 이하/일반 두 줄이나 1회)", () => {
    expect(order.filter(c => c === "8783").length).toBe(1)
  })
})

describe("PROC_LABEL_CODE_2025 — 사전 무결성", () => {
  test("모든 값이 8xxx 4자리 코드", () => {
    for (const code of Object.values(PROC_LABEL_CODE_2025)) {
      expect(code).toMatch(/^8\d{3}$/)
    }
  })
  test("픽스처의 모든 (잔액) 라벨이 사전에 등록됨(미등록=세법개정 신호)", () => {
    const unmapped: string[] = []
    for (const line of sample.split("\n")) {
      const m = PROC_ROW_RE.exec(line)
      if (!m) continue
      const label = m[2].trim()
      if (!(label in PROC_LABEL_CODE_2025)) unmapped.push(label)
    }
    expect(unmapped).toEqual([])
  })
})
