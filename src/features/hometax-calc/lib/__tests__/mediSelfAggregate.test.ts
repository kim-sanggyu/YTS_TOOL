import { describe, test, expect } from "vitest"
import { aggregateMedi, type MediFmlyRaw } from "../mediSelfAggregate"

// ────────────────────────────────────────────────────────────
// aggregateMedi — 원천(FMLY_DTL) → 실손차감 후 4항목(8720/8721/8725/8729) 독립 집계.
//   YTS Java(getFmlyDtlForMedi) 독립 재구현. 이 테스트가 검증도구 자체의 무결성을 잠근다
//   (사각#4: 재집계 함수 버그면 대조가 오탐/미탐). 실측 baseline + 실손차감 경계.
// ────────────────────────────────────────────────────────────

const row = (r: Partial<MediFmlyRaw>): MediFmlyRaw =>
  ({ fmlySeq: 1, fmlyReln: "550-020", amt: 0, hdc: 0, ca: 0, isa: 0, loss: 0, ...r })

describe("aggregateMedi — 실측 baseline (X202600261, 국세청 팝업·CALC_PROC_MEDI 원단위 일치)", () => {
  // 원천 3행: 본인(일반974,240+난임971,690, 실손686,578) / 직계존속 특례630,180 / 직계존속 특례290,660
  const rows: MediFmlyRaw[] = [
    { fmlySeq: 1, fmlyReln: "550-010", amt: 974240, hdc: 0,      ca: 0, isa: 971690, loss: 686578 },
    { fmlySeq: 3, fmlyReln: "550-020", amt: 0,      hdc: 630180, ca: 0, isa: 0,      loss: 0 },
    { fmlySeq: 4, fmlyReln: "550-020", amt: 0,      hdc: 290660, ca: 0, isa: 0,      loss: 0 },
  ]
  const agg = aggregateMedi(rows)

  test("본인등(8720) = 1,208,502", () => expect(agg.bonin).toBe(1_208_502))
  test("그밖의(8721) = 0",         () => expect(agg.other).toBe(0))
  test("난임(8725) = 971,690",     () => expect(agg.nanim).toBe(971_690))
  test("미숙아(8729) = 0",         () => expect(agg.misuk).toBe(0))
  test("총 지출(4항목 합) = 2,180,192", () =>
    expect(agg.bonin + agg.other + agg.misuk + agg.nanim).toBe(2_180_192))

  test("본인 행: 일반 실손차감 후 잔여를 본인등으로 이동 (974,240-686,578=287,662)", () => {
    const self = agg.byFmly.find(f => f.fmlySeq === 1)!
    expect(self.otherAmt).toBe(0)          // 본인은 일반→본인등 이동 후 0
    expect(self.boninAmt).toBe(287_662)    // 287,662 = 974,240 - 686,578
    expect(self.nanimAmt).toBe(971_690)    // 난임은 실손 미도달(일반이 전부 흡수)
  })
})

describe("aggregateMedi — 실손차감 순서 (일반→본인등→미숙아→난임, 행별 독립)", () => {
  test("실손 없음 → 모든 버킷 온전", () => {
    const agg = aggregateMedi([row({ amt: 100, hdc: 200, ca: 300, isa: 400 })])
    expect(agg).toMatchObject({ other: 100, bonin: 200, misuk: 300, nanim: 400 })
  })

  test("실손이 일반보다 크면 일반 소진 후 다음 버킷(본인등)으로 넘어감", () => {
    // loss 150: 일반 100 전부 + 본인등에서 50 → other 0, bonin 200-50=150
    const agg = aggregateMedi([row({ amt: 100, hdc: 200, ca: 300, isa: 400, loss: 150 })])
    expect(agg).toMatchObject({ other: 0, bonin: 150, misuk: 300, nanim: 400 })
  })

  test("실손이 일반+본인등+미숙아까지 소진하고 난임 일부 차감", () => {
    // loss 650: 일반100+본인등200+미숙아300 = 600 소진, 난임 400-50=350
    const agg = aggregateMedi([row({ amt: 100, hdc: 200, ca: 300, isa: 400, loss: 650 })])
    expect(agg).toMatchObject({ other: 0, bonin: 0, misuk: 0, nanim: 350 })
  })

  test("실손이 전체 지출을 초과 → 전 버킷 0", () => {
    const agg = aggregateMedi([row({ amt: 100, hdc: 200, ca: 300, isa: 400, loss: 9999 })])
    expect(agg).toMatchObject({ other: 0, bonin: 0, misuk: 0, nanim: 0 })
  })

  test("실손은 행 간 이월 없음 (한 부양가족 실손이 다른 부양가족에 영향 없음)", () => {
    const agg = aggregateMedi([
      row({ fmlySeq: 1, amt: 100, loss: 999 }),   // 일반 100 전부 흡수 → 0
      row({ fmlySeq: 2, amt: 500, loss: 0 }),     // 영향 없음 → 500
    ])
    expect(agg.other).toBe(500)
  })
})

describe("aggregateMedi — 본인(550-010) 일반의료비 본인등 이동", () => {
  test("본인 일반의료비는 그밖의(8721) 아닌 본인등(8720)으로 집계", () => {
    const agg = aggregateMedi([row({ fmlyReln: "550-010", amt: 300 })])
    expect(agg.other).toBe(0)
    expect(agg.bonin).toBe(300)
  })

  test("비본인(직계존속)의 일반의료비는 그밖의(8721)에 남음", () => {
    const agg = aggregateMedi([row({ fmlyReln: "550-020", amt: 300 })])
    expect(agg.other).toBe(300)
    expect(agg.bonin).toBe(0)
  })

  test("본인의 일반+특례 혼재: 일반 실손차감 잔여를 특례(본인등)에 합산", () => {
    // 일반500, 특례200, 실손300 → 일반 200 잔여 + 특례 200 = bonin 400
    const agg = aggregateMedi([row({ fmlyReln: "550-010", amt: 500, hdc: 200, loss: 300 })])
    expect(agg.other).toBe(0)
    expect(agg.bonin).toBe(400)
  })
})
