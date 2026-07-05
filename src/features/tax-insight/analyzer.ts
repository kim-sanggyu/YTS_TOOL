import type { CalcRow, CardData, MediData, Finding, AnalysisResult, AnalysisSummary } from "./types"
import { parseCardData } from "./parsers/card"
import { parseMediData } from "./parsers/medi"
import { parseTotalContext } from "./parsers/total"

// ─── 유틸 ────────────────────────────────────────────────────────────────────
const fmt  = (n: number) => Math.round(n).toLocaleString("ko-KR") + "원"
const fmtM = (n: number) => (n / 10000).toFixed(0) + "만원"
const n    = (v: number | null | undefined) => v ?? 0

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

// ─── 메인 분석 ───────────────────────────────────────────────────────────────
export function analyze(row: CalcRow): AnalysisResult {
  const card  = parseCardData(row.CALC_PROC_CARD)
  const medi  = parseMediData(row.CALC_PROC_MEDI)
  const total = parseTotalContext(row.CALC_PROC_TOTAL)

  const { calcMode, standardTax, specialTax } = parseCalcMethod(row.CALC_METHOD)
  const isStd         = calcMode === "standard"
  // 세대주·세대주배우자 → 주택마련저축 공제 가능
  // CALC_PROC_TOTAL 푸터에 세대 구분이 있으면 우선 사용, 없으면 HOUSE_HLDR_YN DB 폴백
  const isHouseHolder = total.isHouseHolder !== null ? total.isHouseHolder : row.HOUSE_HLDR_YN !== "2"
  const limit         = pensionLimit(row.TOT_PAY_AMT)
  const rate          = pensionRate(row.TOT_PAY_AMT)

  // 주택 400만원 한도 소진: 원리금상환액 공제액 합계가 한도를 채운 경우
  const 주택한도소진 = n(row.SP_HOUSE_RALR_LENDER_AMT) + n(row.SP_HOUSE_RALR_HABT_AMT) >= 4_000_000

  const summary: AnalysisSummary = {
    name:          row.NAME ?? "-",
    calcNo:        row.CALC_NO,
    totPayAmt:     row.TOT_PAY_AMT,
    resIncmTax:    row.RES_INCM_TAX,
    effctvTaxRate: row.EFFCTV_TAX_RATE,
    prodTaxAmt:    row.PROD_TAX_AMT,
    calcMode, standardTax, specialTax,
  }

  const analysis:      Finding[] = []
  const opportunities: Finding[] = []

  // ═══════════════════════════════════════════════════════════
  // ANALYSIS — 세액계산 결과 분석
  // ═══════════════════════════════════════════════════════════

  // ── 1. 표준세액공제 방식 ────────────────────────────────────
  if (isStd) {
    const notApplied: { label: string; amt: number }[] = []

    const hlthInput = n(row.MAIN_HLTH_INSU_AMT)
    const empInput  = n(row.MAIN_EMP_INSU_AMT)
    if (hlthInput > 0) notApplied.push({ label: "건강보험료",  amt: hlthInput })
    if (empInput  > 0) notApplied.push({ label: "고용보험료",  amt: empInput })

    const houseRent = n(row.MAIN_HOUSE_RENT)
    if (houseRent > 0) notApplied.push({ label: "월세액", amt: houseRent })

    const grtInsu = n(row.SPCL_IF_GRT_INSU_AMT)
    if (grtInsu > 0) notApplied.push({ label: "보장성보험료", amt: grtInsu })

    const mediAmt = n(row.SPCL_MEDI_AMT)
    if (mediAmt > 0) notApplied.push({ label: "의료비", amt: mediAmt })

    const eduAmt = n(row.SPCL_EDU_AMT)
    if (eduAmt > 0) notApplied.push({ label: "교육비", amt: eduAmt })

    const itemList = notApplied.map(({ label, amt }) => `${label} ${fmt(amt)}`).join(", ")
    analysis.push({
      type: "ANALYSIS",
      title: "표준세액공제 방식",
      description: notApplied.length > 0
        ? `표준세액공제 방식으로 계산되어 ${itemList}은(는) 공제되지 않습니다.`
        : "표준세액공제 방식으로 계산되었습니다.",
    })
  }

  // ── 2. 근로소득 조기 소진 ──────────────────────────────────
  if (total.incomeExhausted) {
    const label  = total.incomeExhaustPoint
    const missed: { label: string; amt: number }[] = []

    const hlth = n(row.MAIN_HLTH_INSU_AMT)
    const emp  = n(row.MAIN_EMP_INSU_AMT)
    if (hlth > 0 && n(row.SPCL_IF_HLTH_INSU_AMT) === 0) missed.push({ label: "건강보험료", amt: hlth })
    if (emp  > 0 && n(row.SPCL_IF_EMP_INSU_AMT)  === 0) missed.push({ label: "고용보험료", amt: emp })

    const lender = n(row.MAIN_HOUSE_RALR_LENDER)
    const habt   = n(row.MAIN_HOUSE_RALR_HABT)
    if (lender > 0 && n(row.SP_HOUSE_RALR_LENDER_AMT) === 0) missed.push({ label: "원리금상환액(대출기관)", amt: lender })
    if (habt   > 0 && n(row.SP_HOUSE_RALR_HABT_AMT)   === 0) missed.push({ label: "원리금상환액(거주자)",   amt: habt })

    const sbsc = n(row.MAIN_HOUSE_LOAN_SBSC)
    const all  = n(row.MAIN_HOUSE_LOAN_ALL)
    const wrk  = n(row.MAIN_HOUSE_LOAN_WRK)
    if (sbsc > 0) missed.push({ label: "청약저축",         amt: sbsc })
    if (all  > 0) missed.push({ label: "주택청약종합저축",   amt: all })
    if (wrk  > 0) missed.push({ label: "근로자주택마련저축", amt: wrk })

    const missedStr = missed.length > 0
      ? ` ${missed.map(({ label: l, amt }) => `${l} ${fmt(amt)}`).join(", ")}이(가) 공제되지 않습니다.`
      : " 이후 공제 항목이 모두 적용되지 않습니다."

    analysis.push({
      type: "ANALYSIS",
      title: label ? `근로소득 조기 소진 — ${label} 단계` : "근로소득 조기 소진",
      description: `${label ? `${label} 공제 후 ` : ""}근로소득금액이 0이 됩니다. 이로 인해${missedStr}`,
    })
  }

  // ── 3. 세액 전액 소진 ───────────────────────────────────────
  if (total.taxExhausted) {
    const label   = total.taxExhaustPoint
    const skipped = total.taxExhaustedSkipped

    const missedStr = skipped.length > 0
      ? ` ${skipped.join(", ")}이(가) 공제되지 않습니다.`
      : " 이후 세액공제 항목이 모두 적용되지 않습니다."

    analysis.push({
      type: "ANALYSIS",
      title: label ? `세액 전액 소진 — '${label}' 항목 공제 시` : "세액 전액 소진",
      description: `${label ? `${label} 공제 후 ` : ""}산출세액이 모두 소진됩니다. 이로 인해${missedStr}`,
    })
  }

  // ── 4. 주택마련저축 — 세대원으로 미공제 ────────────────────
  const 청약Input    = n(row.MAIN_HOUSE_LOAN_SBSC)
  const 주택청약Input = n(row.MAIN_HOUSE_LOAN_ALL)
  const 근로자Input   = n(row.MAIN_HOUSE_LOAN_WRK)
  const savingsTotal  = 청약Input + 주택청약Input + 근로자Input

  if (savingsTotal > 0) {
    const savingsItems = [
      청약Input    > 0 ? `청약저축 ${fmt(청약Input)}` : "",
      주택청약Input > 0 ? `주택청약종합저축 ${fmt(주택청약Input)}` : "",
      근로자Input   > 0 ? `근로자주택마련저축 ${fmt(근로자Input)}` : "",
    ].filter(Boolean).join(", ")

    if (!isHouseHolder) {
      analysis.push({
        type: "ANALYSIS",
        title: "주택마련저축 — 세대원으로 미공제",
        description: `${savingsItems}을 납입하셨지만 세대원은 주택마련저축 소득공제 대상이 아닙니다. 세대주만 공제 가능합니다.`,
        amount: savingsTotal,
      })
    } else if (주택한도소진) {
      analysis.push({
        type: "ANALYSIS",
        title: "주택마련저축 — 400만원 한도 소진으로 미공제",
        description: `${savingsItems}을 납입하셨지만, 주택임차차입금원리금상환액이 주택 관련 공제 400만원 한도를 모두 소진하여 추가 공제가 적용되지 않습니다.`,
        amount: savingsTotal,
      })
    }
  }

  // ── 5. 원리금상환액 — 미공제 ────────────────────────────────
  const lenderInput    = n(row.MAIN_HOUSE_RALR_LENDER)
  const habitInput     = n(row.MAIN_HOUSE_RALR_HABT)
  const lenderDeducted = n(row.SP_HOUSE_RALR_LENDER_AMT)
  const habitDeducted  = n(row.SP_HOUSE_RALR_HABT_AMT)

  const ralrMissedItems = [
    lenderInput > 0 && lenderDeducted === 0 ? `원리금상환액(대출기관) ${fmt(lenderInput)}` : "",
    habitInput  > 0 && habitDeducted  === 0 ? `원리금상환액(거주자) ${fmt(habitInput)}`   : "",
  ].filter(Boolean)

  if (ralrMissedItems.length > 0 && !total.incomeExhausted) {
    const ralrMissedAmt = (lenderInput > 0 && lenderDeducted === 0 ? lenderInput : 0)
                        + (habitInput  > 0 && habitDeducted  === 0 ? habitInput  : 0)
    analysis.push({
      type: "ANALYSIS",
      title: "주택임차차입금원리금상환액 — 미공제",
      description: `${ralrMissedItems.join(", ")}을 입력하셨지만 공제가 적용되지 않았습니다.`,
      amount: ralrMissedAmt,
    })
  }

  // ── 6. 신용카드 — 최저사용금액 미달 ────────────────────────
  if (card && card.총사용액 > 0 && card.최종공제금액 === 0) {
    const shortage = card.최저사용금액 - card.총사용액
    analysis.push({
      type: "ANALYSIS",
      title: "신용카드 — 최저사용금액 미달",
      description: `신용카드·체크카드·현금영수증 합산 ${fmt(card.총사용액)} 사용하셨지만, 공제 시작 기준인 총급여×25%(${fmt(card.최저사용금액)})에 ${fmt(shortage)} 부족해 공제가 적용되지 않았습니다.`,
      amount: shortage,
    })
  }

  // ── 7. 의료비 — 최저한도 미달 ───────────────────────────────
  if (!isStd && medi) {
    const mediInput = medi.의료비지출금액
    if (mediInput > 0 && medi.의료비_공제금액 === 0) {
      const shortage = medi.의료비최저사용액 - mediInput
      if (shortage > 0) {
        analysis.push({
          type: "ANALYSIS",
          title: "의료비 — 최저한도 미달",
          description: `의료비 ${fmt(mediInput)} 지출하셨지만, 공제 기준인 총급여의 3%(${fmt(medi.의료비최저사용액)})에 ${fmt(shortage)} 부족합니다.`,
          amount: shortage,
        })
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // OPPORTUNITY — 절세 기회
  // ═══════════════════════════════════════════════════════════
  if (row.PROD_TAX_AMT > 0) {

    // ── 1. 연금계좌 추가 납입 여지 ──────────────────────────────
    const pensionInputTotal = n(row.RSIGN_PEN_RET_AMT) + n(row.RSIGN_PEN_PF_AMT) + n(row.RSIGN_PEN_TECH_AMT) + n(row.ISA_PEN_AMT)
    const irpInput     = n(row.RSIGN_PEN_RET_AMT)
    const pensionInput = n(row.RSIGN_PEN_PF_AMT)

    if (pensionInputTotal < limit) {
      const canAdd  = limit - pensionInputTotal
      const saving  = Math.round(canAdd * rate)
      const current = pensionInputTotal > 0 ? `현재 ${fmtM(pensionInputTotal)} 납입 중, ` : "현재 미납입, "
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
    if (n(row.ADD_SUB_HDC_PERS_CNT) > 0 && n(row.SPCL_IF_HDC_PERS_INSU_AMT) === 0) {
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

    // ── 5. 의료비 최저한도 근접 — 가족 의료비 합산 검토 ─────────
    if (!isStd && medi && medi.의료비지출금액 > 0 && medi.의료비_공제금액 === 0) {
      const shortage = medi.의료비최저사용액 - medi.의료비지출금액
      if (shortage > 0 && shortage <= 1_000_000) {
        opportunities.push({
          type: "OPPORTUNITY",
          title: "의료비 최저한도 근접 — 가족 의료비 합산 검토",
          description: `올해 의료비 ${fmt(medi.의료비지출금액)}이 최저한도(총급여×3%)에 ${fmt(shortage)} 부족해 공제가 적용되지 않았습니다. 소득이 있어 기본공제 대상자가 아닌 가족(배우자·부모 등)의 의료비도 본인 연말정산에 합산할 수 있습니다.`,
          amount: shortage,
        })
      }
    }

    // ── 6. 고향사랑기부금 미활용 ────────────────────────────────
    if (n(row.SPCL_HL_AMT) + n(row.SPCL_HOME_LOVE) === 0) {
      opportunities.push({
        type: "OPPORTUNITY",
        title: "고향사랑기부금 미활용",
        description: "10만원 기부 시 세액공제 90,909원(90.9%) + 답례품(기부액의 30%)을 받을 수 있습니다. 실질 비용 9,091원으로 절세와 지역사회 기여를 동시에 할 수 있습니다.",
        amount: 90_909,
      })
    }

  }

  return { summary, analysis, opportunities, procTotal: row.CALC_PROC_TOTAL }
}
