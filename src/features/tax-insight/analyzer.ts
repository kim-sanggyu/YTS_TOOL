import type { CalcRow, CardData, MediData, InputData, Finding, AnalysisResult, AnalysisSummary } from "./types"
import { parseCardData } from "./parsers/card"
import { parseMediData } from "./parsers/medi"
import { parseInputData } from "./parsers/input"

// ─── 유틸 ────────────────────────────────────────────────────────────────────
const fmt  = (n: number) => Math.round(n).toLocaleString("ko-KR") + "원"
const fmtM = (n: number) => (n / 10000).toFixed(0) + "만원"
const n    = (v: number | null | undefined) => v ?? 0

// CALC_PROC_TOTAL 끝부분에서 성명·사번 추출
// 예: "※ 이춘성님(00089, X202600133)"
function parseName(text: string): { name: string; empNo: string } {
  const m = text.match(/※\s+(.+?)님\((\d+),\s*[A-Z]\d+\)/)
  return m ? { name: m[1], empNo: m[2] } : { name: "-", empNo: "-" }
}

// CALC_METHOD에서 표준/특별 세액 파싱
function parseCalcMethod(method: string): {
  calcMode: "standard" | "special"
  standardTax: number
  specialTax: number
} {
  const isStd = method.includes("표준세액공제 적용 세액")
  if (isStd) {
    const m = method.match(/표준세액공제 적용 세액\s+([\d,]+)\s+\(특별적용時\s+([\d,]+)\)/)
    return { calcMode: "standard", standardTax: parseInt(m?.[1]?.replace(/,/g,"") ?? "0"), specialTax: parseInt(m?.[2]?.replace(/,/g,"") ?? "0") }
  }
  const m = method.match(/특별소득.*?세액공제 적용 세액\s+([\d,]+)\s+\(표준적용時\s+([\d,]+)\)/)
  return { calcMode: "special", specialTax: parseInt(m?.[1]?.replace(/,/g,"") ?? "0"), standardTax: parseInt(m?.[2]?.replace(/,/g,"") ?? "0") }
}

// 연금계좌 합산 한도·공제율
function pensionLimit(totPayAmt: number) { return totPayAmt > 55_000_000 ? 9_000_000 : 6_000_000 }
function pensionRate (totPayAmt: number) { return totPayAmt > 55_000_000 ? 0.12 : 0.15 }

// InputData에서 연금계좌 실제 납입 합계
function totalPensionInput(inp: InputData | null): number {
  if (!inp) return 0
  return n(inp["562-010"]) + n(inp["562-020"]) + n(inp["562-025"]) + n(inp["562-040"])
}

// ─── 메인 분석 ───────────────────────────────────────────────────────────────
export function analyze(row: CalcRow): AnalysisResult {
  const card  = parseCardData(row.CALC_PROC_CARD)
  const medi  = parseMediData(row.CALC_PROC_MEDI)
  const inp   = parseInputData(row.CALC_PROC_INPUT)
  const { name, empNo } = parseName(row.CALC_PROC_TOTAL)
  const { calcMode, standardTax, specialTax } = parseCalcMethod(row.CALC_METHOD)
  const isStd   = calcMode === "standard"
  const limit   = pensionLimit(row.TOT_PAY_AMT)
  const rate    = pensionRate(row.TOT_PAY_AMT)
  const diff    = standardTax - specialTax  // 양수면 표준이 유리

  const summary: AnalysisSummary = {
    name, empNo,
    calcNo:        row.CALC_NO,
    totPayAmt:     row.TOT_PAY_AMT,
    ntaxSum:       row.NTAX_SUM,
    resIncmTax:    row.RES_INCM_TAX,
    resInhabtTax:  row.RES_INHABT_TAX,
    effctvTaxRate: row.EFFCTV_TAX_RATE,
    subIncmTax:    row.SUB_INCM_TAX,
    subInhabtTax:  row.SUB_INHABT_TAX,
    prodTaxAmt:    row.PROD_TAX_AMT,
    calcMode, standardTax, specialTax,
  }

  const whyZero:      Finding[] = []
  const opportunities: Finding[] = []
  const doingWell:    Finding[] = []

  // ═══════════════════════════════════════════════════════════
  // WHY_ZERO — 입력했는데 0원이 된 이유
  // ═══════════════════════════════════════════════════════════

  // ── 1. 표준세액공제 방식 → 특별세액공제 항목 미적용 ──────────
  if (isStd) {
    const skipped: { label: string; amt: number; maxSaving?: number }[] = []

    const houseRent = inp ? n(inp.HOUSE_RENT) : row.SP_HOUSE_RENT_AMT
    if (houseRent > 0)
      skipped.push({ label: "월세", amt: houseRent,
        maxSaving: Math.round(Math.min(houseRent, row.TOT_PAY_AMT <= 55_000_000 ? 8_000_000 : 8_000_000) * 0.17) })

    const grtInsu = inp ? n(inp.GRT_INSU) : row.SPCL_IF_GRT_INSU_AMT
    if (grtInsu > 0)
      skipped.push({ label: "보장성보험료", amt: grtInsu,
        maxSaving: Math.round(Math.min(grtInsu, 1_000_000) * 0.12) })

    const mediAmt = inp ? n(inp.MEDI_entered) : row.SPCL_MEDI_AMT
    if (mediAmt > 0)
      skipped.push({ label: "의료비", amt: mediAmt })

    const eduAmt = inp ? n(inp.EDU_SUM) : row.SPCL_EDU_AMT
    if (eduAmt > 0)
      skipped.push({ label: "교육비", amt: eduAmt,
        maxSaving: Math.round(Math.min(eduAmt, 9_000_000) * 0.15) })

    if (skipped.length > 0) {
      const savingNote = specialTax > 0 && specialTax > standardTax
        ? `특별방식 적용 시 세액이 ${fmt(specialTax - standardTax)} 더 많아 표준방식이 유리합니다.`
        : diff > 0
          ? `표준방식이 특별방식보다 ${fmt(diff)} 유리해서 자동 선택됐습니다.`
          : "표준·특별 두 방식의 세액이 동일하여 표준방식이 선택됐습니다."

      skipped.forEach(({ label, amt, maxSaving }) => {
        whyZero.push({
          type: "WHY_ZERO",
          title: `${label} — 입력했지만 공제 미적용`,
          description: `${label} ${fmt(amt)}를 입력하셨지만 ${savingNote} 표준세액공제 방식에서는 ${label} 공제가 적용되지 않습니다.${maxSaving ? ` (특별방식 선택 시 최대 ${fmt(maxSaving)} 공제 가능했으나 표준이 더 유리)` : ""}`,
          amount: amt,
        })
      })
    } else {
      whyZero.push({
        type: "WHY_ZERO",
        title: "표준세액공제 방식 적용",
        description: `${diff > 0 ? `표준방식이 특별방식보다 ${fmt(diff)} 유리해서` : "표준·특별 세액이 동일해서"} 표준세액공제(13만원 정액)가 자동 선택됐습니다. 보험료·의료비·교육비·월세 개별 공제는 적용되지 않습니다.`,
      })
    }
  }

  // ── 2. 연금계좌 한도 초과 납입 ────────────────────────────────
  const pensionInputTotal = inp ? totalPensionInput(inp) : (n(row.RSIGN_PEN_RET_AMT) + n(row.RSIGN_PEN_PF_AMT) + n(row.RSIGN_PEN_TECH_AMT))
  const irpInput     = inp ? n(inp["562-010"]) : n(row.RSIGN_PEN_RET_AMT)
  const pensionInput = inp ? n(inp["562-040"]) : n(row.RSIGN_PEN_PF_AMT)

  if (pensionInputTotal > limit) {
    const over        = pensionInputTotal - limit
    const lostSaving  = Math.round(over * rate)
    const irpNote     = irpInput > 0 ? `IRP ${fmtM(irpInput)}` : ""
    const pensionNote = pensionInput > 0 ? `연금저축 ${fmtM(pensionInput)}` : ""
    const items       = [irpNote, pensionNote].filter(Boolean).join(" + ")
    whyZero.push({
      type: "WHY_ZERO",
      title: "연금계좌 한도 초과 납입 — 일부 공제 불가",
      description: `${items} 합산 ${fmt(pensionInputTotal)} 납입하셨지만 한도 ${fmt(limit)}을 초과한 ${fmt(over)}은 세액공제 효과가 없습니다. 손실 공제액 약 ${fmt(lostSaving)}입니다. 내년에는 합산 ${fmt(limit)} 이내로 조정하세요.`,
      amount: lostSaving,
    })
  }

  // ── 3. 신용카드 최저사용금액 미달 ─────────────────────────────
  if (card && card.총사용액 > 0 && card.최종공제금액 === 0) {
    const shortage = card.최저사용금액 - card.총사용액
    whyZero.push({
      type: "WHY_ZERO",
      title: "신용카드 공제 미적용 — 최저사용금액 미달",
      description: `신용카드·체크카드·현금영수증 합산 ${fmt(card.총사용액)} 사용하셨지만, 공제 시작 기준인 최저사용금액 ${fmt(card.최저사용금액)}(총급여×25%)에 ${fmt(shortage)} 부족합니다. 내년 목표: 연간 ${fmtM(card.최저사용금액)} 이상 사용.`,
      amount: shortage,
    })
  }

  // ── 4. 의료비 최저한도 미달 ───────────────────────────────────
  if (!isStd && medi) {
    const mediInput = inp ? n(inp.MEDI_entered) : medi.의료비지출금액
    if (mediInput > 0 && medi.의료비_공제금액 === 0) {
      const shortage = medi.의료비최저사용액 - medi.의료비지출금액
      if (shortage > 0) {
        whyZero.push({
          type: "WHY_ZERO",
          title: "의료비 공제 미적용 — 최저한도 미달",
          description: `의료비 ${fmt(mediInput)} 지출하셨지만, 공제 기준인 총급여의 3%(${fmt(medi.의료비최저사용액)})에 ${fmt(shortage)} 부족합니다.`,
          amount: shortage,
        })
      }
    }
  }

  // ── 5. 실손보험 차감 후 의료비 없음 ───────────────────────────
  if (medi && medi.의료비지출금액 === 0 && String(medi.의료비지출금액_MEMO ?? "").includes("실손")) {
    whyZero.push({
      type: "WHY_ZERO",
      title: "의료비 0원 — 실손보험금 차감",
      description: "지출 의료비에서 실손보험금을 차감한 결과 공제 대상이 없습니다. 실손 미보장 비급여 항목이 있다면 별도로 확인하세요.",
    })
  }

  // ── 6. 보험료 한도 초과 ───────────────────────────────────────
  const grtInsuInput = inp ? n(inp.GRT_INSU) : n(row.SPCL_IF_GRT_INSU_AMT)
  if (!isStd && grtInsuInput > 1_000_000) {
    const over = grtInsuInput - 1_000_000
    whyZero.push({
      type: "WHY_ZERO",
      title: "보장성보험료 공제 한도 초과",
      description: `보험료 ${fmt(grtInsuInput)} 납입하셨지만 공제 한도 100만원까지만 적용됩니다. 초과분 ${fmt(over)}은 공제 불가합니다.`,
      amount: over,
    })
  }

  // ── 7. 국민연금 잔액 소진으로 일부만 공제 ────────────────────
  if (n(row.NP_INSU_OBJ_AMT) > n(row.NP_INSU_AMT) && n(row.NP_INSU_AMT) > 0) {
    const unpaid = n(row.NP_INSU_OBJ_AMT) - n(row.NP_INSU_AMT)
    whyZero.push({
      type: "WHY_ZERO",
      title: "국민연금 일부만 공제 — 근로소득 소진",
      description: `국민연금 납부액 ${fmt(n(row.NP_INSU_OBJ_AMT))} 중 ${fmt(n(row.NP_INSU_AMT))}만 공제됐습니다. 근로소득금액이 먼저 소진되어 나머지 ${fmt(unpaid)}은 공제되지 않습니다.`,
      amount: unpaid,
    })
  }

  // ── 8. 세대원 → 청약저축류 공제 불가 ────────────────────────
  if (inp && inp.HOUSEHOLD_MEMBER === 1) {
    const 청약 = n(inp["562-050"])
    const 주택청약 = n(inp["562-060"])
    const 근로자주택 = n(inp["562-080"])
    const total = 청약 + 주택청약 + 근로자주택
    if (total > 0) {
      const items = [
        청약 > 0     ? `청약저축 ${fmt(청약)}` : "",
        주택청약 > 0  ? `주택청약종합저축 ${fmt(주택청약)}` : "",
        근로자주택 > 0 ? `근로자주택마련저축 ${fmt(근로자주택)}` : "",
      ].filter(Boolean).join(", ")
      whyZero.push({
        type: "WHY_ZERO",
        title: "청약저축류 공제 불가 — 세대원",
        description: `${items}을 납입하셨지만 세대원은 청약저축·주택청약종합저축·근로자주택마련저축 소득공제 대상이 아닙니다. 세대주만 공제 가능합니다.`,
        amount: total,
      })
    }
  }

  // ── 9. 주택임차차입금 400만원 한도 적용 ──────────────────────
  if (inp) {
    const pnintInput  = n(inp.PNINT_SUM)    // 거주자 원래 입력액
    const lenderDeducted = n(row.SP_HOUSE_RALR_LENDER_AMT)  // 대출기관 공제액
    const habitDeducted  = n(row.SP_HOUSE_RALR_HABT_AMT)    // 거주자 공제액
    const totalDeducted  = lenderDeducted + habitDeducted
    // 거주자 입력액이 공제액보다 크면 한도 초과로 잘린 것
    if (pnintInput > habitDeducted && totalDeducted > 0) {
      const cut = pnintInput - habitDeducted
      whyZero.push({
        type: "WHY_ZERO",
        title: "주택임차차입금 거주자 — 400만원 한도 초과",
        description: `주택임차차입금원리금상환액(거주자) ${fmt(pnintInput)} 중 ${fmt(habitDeducted)}만 공제됐습니다. 대출기관 분(${fmt(lenderDeducted)})과 합산 한도 400만원을 초과한 ${fmt(cut)}은 공제되지 않습니다.`,
        amount: cut,
      })
    }
  }

  // ── 11. 소득 조기 소진 ───────────────────────────────────────
  if (row.EXHAUSTED_POINT && row.EXHAUSTED_POINT !== "NOT_EXHAUSTED") {
    const pointMap: Record<string, string> = {
      NP_INSU_AMT:        "국민연금",
      BASC_SUB_SELF_AMT:  "본인기초공제",
      BASC_SUB_MATE_AMT:  "배우자공제",
      BASC_SUB_FAMILY_AMT:"부양가족공제",
    }
    const label = pointMap[row.EXHAUSTED_POINT] ?? row.EXHAUSTED_POINT
    if (!whyZero.some(f => f.title.includes("국민연금 일부"))) {
      whyZero.push({
        type: "WHY_ZERO",
        title: `근로소득 조기 소진 — ${label} 단계`,
        description: `${label} 공제 후 근로소득금액이 0이 됩니다. 이후 모든 공제 항목은 차감할 소득이 없어 0원 처리됩니다.`,
      })
    }
  }

  // ═══════════════════════════════════════════════════════════
  // OPPORTUNITY — 절세 기회
  // ═══════════════════════════════════════════════════════════
  if (row.PROD_TAX_AMT > 0) {

    // ── 1. 연금계좌 추가 납입 여지 ──────────────────────────────
    if (pensionInputTotal < limit) {
      const canAdd  = limit - pensionInputTotal
      const saving  = Math.round(canAdd * rate)
      const current = pensionInputTotal > 0
        ? `현재 ${fmtM(pensionInputTotal)} 납입 중, ` : "현재 미납입, "
      const detail  = irpInput > 0 || pensionInput > 0
        ? `(IRP ${fmtM(irpInput)} + 연금저축 ${fmtM(pensionInput)})` : ""
      opportunities.push({
        type: "OPPORTUNITY",
        title: "IRP·연금저축 추가 납입 가능",
        description: `${current}${detail} 한도 ${fmt(limit)}까지 ${fmt(canAdd)} 추가 납입 시 세액공제 ${fmt(saving)} 절감 가능합니다. (공제율 ${Math.round(rate * 100)}%)`,
        amount: saving,
      })
    }

    // ── 2. 장애인전용보험 미가입 ─────────────────────────────────
    const hdcInsuInput = inp ? n(inp.HDC_PERS_INSU) : n(row.SPCL_IF_HDC_PERS_INSU_AMT)
    if (n(row.ADD_SUB_HDC_PERS_CNT) > 0 && hdcInsuInput === 0) {
      opportunities.push({
        type: "OPPORTUNITY",
        title: "장애인전용보험 미가입",
        description: `장애인 부양가족 ${row.ADD_SUB_HDC_PERS_CNT}명이 있습니다. 장애인전용보장성보험 가입 시 별도 한도 100만원×15%로 최대 ${fmt(150_000)} 추가 세액공제가 가능합니다. 일반 보험료 공제와 별개 한도입니다.`,
        amount: 150_000,
      })
    }

    // ── 3. 신용카드 전략 — 최저사용금액 미달 ─────────────────────
    if (card && card.총사용액 > 0 && card.최종공제금액 === 0) {
      const shortage = card.최저사용금액 - card.총사용액
      opportunities.push({
        type: "OPPORTUNITY",
        title: "내년 신용카드 사용 전략",
        description: `연간 ${fmt(card.최저사용금액)}(총급여×25%) 이상 사용 시 공제가 시작됩니다. 올해 ${fmt(shortage)} 부족했습니다. 최저사용금액 초과분부터는 체크카드·현금영수증(공제율 30%)을 활용하세요.`,
        amount: shortage,
      })
    }

    // ── 4. 신용카드 비중 과다 — 체크카드 전환 권장 ───────────────
    if (card && card.총사용액 > 0 && card.최종공제금액 > 0) {
      const creditRatio = card.가 / card.총사용액
      if (creditRatio > 0.5) {
        opportunities.push({
          type: "OPPORTUNITY",
          title: "체크카드·현금영수증 전환 권장",
          description: `신용카드 사용 비중이 ${Math.round(creditRatio * 100)}%(${fmt(card.가)})입니다. 최저사용금액(총급여×25%) 초과분부터 체크카드·현금영수증으로 전환하면 공제율이 15%→30%로 2배가 됩니다.`,
        })
      }
    }

    // ── 5. 의료비 최저한도 근접 (100만원 이내) ───────────────────
    if (!isStd && medi && medi.의료비지출금액 > 0 && medi.의료비_공제금액 === 0) {
      const shortage = medi.의료비최저사용액 - medi.의료비지출금액
      if (shortage > 0 && shortage <= 1_000_000) {
        opportunities.push({
          type: "OPPORTUNITY",
          title: "의료비 최저한도 근접 — 내년 적극 챙기기",
          description: `올해 의료비 ${fmt(medi.의료비지출금액)} 중 최저한도(총급여×3%)까지 ${fmt(shortage)} 부족했습니다. 내년에는 미보장 비급여 항목까지 현금영수증·의료비 자료를 꼼꼼히 챙기세요.`,
          amount: shortage,
        })
      }
    }

    // ── 6. 고향사랑기부금 미활용 ────────────────────────────────
    const donHometown = inp ? (n(inp.SORT_CLS_30_SUM)) : (n(row.SPCL_HL_AMT) + n(row.SPCL_HOME_LOVE))
    if (donHometown === 0) {
      opportunities.push({
        type: "OPPORTUNITY",
        title: "고향사랑기부금 미활용",
        description: "10만원 기부 시 세액공제 90,909원(90.9%) + 답례품(기부액의 30%)을 받을 수 있습니다. 실질 비용 9,091원으로 절세와 지역사회 기여를 동시에 할 수 있습니다.",
        amount: 90_909,
      })
    }
  }

  // ═══════════════════════════════════════════════════════════
  // DOING_WELL — 잘 하고 있는 것
  // ═══════════════════════════════════════════════════════════

  // 1. 연금계좌 한도 완전 활용
  if (pensionInputTotal >= limit && row.PROD_TAX_AMT > 0) {
    const deducted = n(row.RT_RSIGN_PEN_RET_AMT) + n(row.RT_RSIGN_PEN_PF_AMT) + n(row.RT_RSIGN_PEN_TECH_AMT)
    doingWell.push({
      type: "DOING_WELL",
      title: "연금계좌 한도 완전 활용",
      description: `IRP·연금저축 합산 한도 ${fmt(limit)}을 꽉 채워 세액공제 ${fmt(deducted)}을 받고 있습니다.`,
      amount: deducted,
    })
  }

  // 2. 장애인전용보험 가입
  if (n(row.ADD_SUB_HDC_PERS_CNT) > 0 && n(row.RT_IF_HDC_PERS_INSU_AMT) > 0) {
    doingWell.push({
      type: "DOING_WELL",
      title: "장애인전용보험 세액공제 적용 중",
      description: `장애인전용보장성보험료 세액공제 ${fmt(n(row.RT_IF_HDC_PERS_INSU_AMT))}을 적용받고 있습니다.`,
      amount: n(row.RT_IF_HDC_PERS_INSU_AMT),
    })
  }

  // 3. 표준/특별 방식 최적 선택
  if (calcMode === "special" && specialTax < standardTax) {
    doingWell.push({
      type: "DOING_WELL",
      title: "특별세액공제 방식 최적 선택",
      description: `표준방식 적용 시 ${fmt(standardTax)}이지만, 특별방식으로 ${fmt(standardTax - specialTax)} 절감한 ${fmt(specialTax)}이 결정됐습니다.`,
      amount: standardTax - specialTax,
    })
  }
  if (calcMode === "standard" && standardTax <= specialTax) {
    doingWell.push({
      type: "DOING_WELL",
      title: "표준세액공제 방식 최적 선택",
      description: specialTax === 0
        ? "표준·특별 모두 결정세액 0원입니다."
        : `특별방식 적용 시 ${fmt(specialTax)}이지만, 표준방식으로 ${fmt(specialTax - standardTax)} 절감됩니다.`,
      amount: specialTax > standardTax ? specialTax - standardTax : 0,
    })
  }

  // 4. 신용카드 공제 활용 중
  if (card && card.최종공제금액 > 0) {
    const 신용비중  = card.총사용액 > 0 ? Math.round(card.가 / card.총사용액 * 100) : 0
    const 체크현금  = card.나 + card.다
    doingWell.push({
      type: "DOING_WELL",
      title: "신용카드 등 소득공제 적용 중",
      description: `총 ${fmt(card.총사용액)} 사용(신용카드 ${신용비중}%, 체크·현금 ${100-신용비중}%)으로 ${fmt(card.최종공제금액)} 소득공제를 받고 있습니다.${체크현금 > card.가 ? " 체크카드·현금영수증 비중이 높아 공제 효율이 좋습니다." : ""}`,
      amount: card.최종공제금액,
    })
  }

  // 5. 고향사랑기부금 활용
  if (n(row.RT_HL) + n(row.RT_HOME_LOVE) > 0) {
    doingWell.push({
      type: "DOING_WELL",
      title: "고향사랑기부금 세액공제 적용 중",
      description: `고향사랑기부금 세액공제 ${fmt(n(row.RT_HL) + n(row.RT_HOME_LOVE))}을 적용받고 있습니다.`,
      amount: n(row.RT_HL) + n(row.RT_HOME_LOVE),
    })
  }

  // 6. 결정세액 0원 — 최선
  if (row.PROD_TAX_AMT === 0) {
    doingWell.push({
      type: "DOING_WELL",
      title: "결정세액 0원 — 현재 최선",
      description: "소득공제 적용 후 과세표준이 0원이 됩니다. 추가 절세 항목을 적용해도 납부세액에 변화가 없습니다.",
    })
  }

  return { summary, whyZero, opportunities, doingWell, procTotal: row.CALC_PROC_TOTAL }
}
