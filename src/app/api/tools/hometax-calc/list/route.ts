import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { ytsDb } from "@/lib/db/oracle"
import { giftNtsCode, giftTypeLabel, giftTypeRank } from "@/features/hometax-calc/mapping/gift"
import { CARD_CATS, parseCardProc } from "@/features/hometax-calc/mapping/card"
import { MEDI_CATS, parseMediProc } from "@/features/hometax-calc/mapping/medi"
import { pensionNtsCode, pensionTypeRank, PENSION_CODE_LABEL, PENSION_CLS_LIST } from "@/features/hometax-calc/mapping/pension"

export const revalidate = 0

// ── 세액소진 판정·라벨 (EXHAUSTED_POINT) ──────────────────────────────────────
// 소진자는 산출세액이 앞 항목에서 바닥나 뒤 세액공제가 0으로 처리됨 → 개별 항목 YTS-NTS 비교가
// 무의미(거짓 불일치/거짓 일치). 판정은 그대로 두고 "소진" 표시만 해 차이 원인을 암시한다.
const EXHAUST_LABEL: Record<string, string> = {
  BASC_SUB_SELF_AMT:   "소득소진(본인)",
  BASC_SUB_FAMILY_AMT: "소득소진(부양가족)",
  NP_INSU_AMT:         "소득소진(국민연금)",
  RT_BASE_SUB_AMT:     "세액소진(표준세액공제)",
  RT_HOUSE_RENT_AMT:   "세액소진(월세)",
  RT_MEDI_AMT:         "세액소진(의료비)",
  RT_IF_GRT_INSU_AMT:  "세액소진(보험료)",
  RT_EDU_AMT:          "세액소진(교육비)",
  RT_HWC_AMT:          "세액소진(자녀)",
  RT_PER_CHI_AMT:      "세액소진(출산·입양)",
  RT_RSIGN_PEN_PF_AMT: "세액소진(연금저축)",
  RT_HL:               "세액소진(고향사랑)",
}
function exhaustInfo(point: string | null): { exhausted: boolean; exhaustLabel: string | null } {
  if (!point || point === "NOT_EXHAUSTED") return { exhausted: false, exhaustLabel: null }
  return { exhausted: true, exhaustLabel: EXHAUST_LABEL[point] ?? (point.startsWith("RT_") ? "세액소진" : "소득소진") }
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증 필요" }, { status: 401 })

  const year   = req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear())
  const type   = req.nextUrl.searchParams.get("type")
  const prefix = `X${year}%`
  const dataYear = Number(year)

  if (type === "gift") {
    // 세액계산된 건(PAY_WRK_CALC 존재)의 기부금 유형×연도별 라인.
    // YTS 공제금액 = GIFT_SUB_AMT, 보낼 대상금액 = GIFT_ABLE_SUB_AMT.
    const rows = await ytsDb.query<{
      CALC_NO: string; NM: string; TOT_PAY_AMT: number; EXHAUSTED_POINT: string | null
      GIFT_CLS: string; GIFT_YY: string
      GIFT_ABLE_SUB_AMT: number; GIFT_SUB_AMT: number
    }>(`
      SELECT c.CALC_NO,
             SUBSTR(f.NM, 1, 4) AS NM,
             c.TOT_PAY_AMT, c.EXHAUSTED_POINT,
             g.GIFT_CLS, g.GIFT_YY,
             g.GIFT_ABLE_SUB_AMT, g.GIFT_SUB_AMT
      FROM YTS39.PAY_WRK_CALC c
      JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
      JOIN YTS39.PAY_WRK_GIFT_ADJ g ON g.CALC_NO = c.CALC_NO
      WHERE c.CALC_NO LIKE :1
      ORDER BY c.CALC_NO
    `, [prefix])

    // CALC_NO 단위로 그룹핑
    interface GiftLine { code: string | null; giftCls: string; label: string; giftYy: string; ytsSub: number; ableSub: number }
    interface GiftItem { calcNo: string; nm: string; totPayAmt: number; giftTax: number; exhausted: boolean; exhaustLabel: string | null; lines: GiftLine[] }
    const map = new Map<string, GiftItem>()

    for (const r of rows) {
      let item = map.get(r.CALC_NO)
      if (!item) {
        const ex = exhaustInfo(r.EXHAUSTED_POINT)
        item = { calcNo: r.CALC_NO, nm: r.NM, totPayAmt: Number(r.TOT_PAY_AMT), giftTax: 0, exhausted: ex.exhausted, exhaustLabel: ex.exhaustLabel, lines: [] }
        map.set(r.CALC_NO, item)
      }
      const diff = dataYear - Number(r.GIFT_YY)
      const sub  = Number(r.GIFT_SUB_AMT ?? 0)
      item.giftTax += sub
      item.lines.push({
        code:    giftNtsCode(r.GIFT_CLS, diff),
        giftCls: r.GIFT_CLS,
        label:   giftTypeLabel(r.GIFT_CLS),
        giftYy:  String(r.GIFT_YY),
        ytsSub:  sub,
        ableSub: Number(r.GIFT_ABLE_SUB_AMT ?? 0),
      })
    }

    // 라인 정렬: 유형 rank → 연도 내림차순(당해 먼저)
    const items = [...map.values()]
    for (const it of items) {
      it.lines.sort((a, b) =>
        giftTypeRank(a.giftCls) - giftTypeRank(b.giftCls) || Number(b.giftYy) - Number(a.giftYy)
      )
    }

    return Response.json({ items })
  }

  if (type === "card") {
    // 카드공제 발생 건(CALC_PROC_CARD 존재 + OTO_CARD_ETC>0)의 가~아 사용액 라인.
    // YTS 카드공제(비교 기준) = OTO_CARD_ETC(=최종공제금액), NTS 8430(카드소계)과 대조.
    const rows = await ytsDb.query<{
      CALC_NO: string; NM: string; TOT_PAY_AMT: number
      OTO_CARD_ETC: number; CALC_PROC_CARD: string | null
    }>(`
      SELECT c.CALC_NO,
             SUBSTR(f.NM, 1, 4) AS NM,
             c.TOT_PAY_AMT,
             NVL(c.OTO_CARD_ETC, 0) AS OTO_CARD_ETC,
             c.CALC_PROC_CARD
      FROM YTS39.PAY_WRK_CALC c
      JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
      WHERE c.CALC_NO LIKE :1
        AND c.CALC_PROC_CARD IS NOT NULL
        AND NVL(c.OTO_CARD_ETC, 0) > 0
      ORDER BY c.CALC_NO
    `, [prefix])

    const items = rows.map(r => {
      const parsed = parseCardProc(r.CALC_PROC_CARD)
      const lines = CARD_CATS
        .map(cat => ({ code: cat.code, label: cat.label, useAmt: Number(parsed?.catAmts[cat.key] ?? 0) }))
        .filter(l => l.useAmt > 0)
      return {
        calcNo:    r.CALC_NO,
        nm:        r.NM,
        totPayAmt: Number(r.TOT_PAY_AMT),
        cardDdc:   Number(r.OTO_CARD_ETC),   // YTS 카드소득공제 (비교 기준)
        lines,
      }
    })

    return Response.json({ items })
  }

  if (type === "medi") {
    // 의료비공제 발생 건(CALC_PROC_MEDI 존재 + RT_MEDI_AMT>0)의 대상자별 지출금액 라인.
    // YTS 의료비 세액공제(비교 기준) = RT_MEDI_AMT(=의료비_공제금액), NTS 8726(의료비집계)과 대조.
    const rows = await ytsDb.query<{
      CALC_NO: string; NM: string; TOT_PAY_AMT: number; EXHAUSTED_POINT: string | null
      RT_MEDI_AMT: number; CALC_PROC_MEDI: string | null
    }>(`
      SELECT c.CALC_NO,
             SUBSTR(f.NM, 1, 4) AS NM,
             c.TOT_PAY_AMT, c.EXHAUSTED_POINT,
             NVL(c.RT_MEDI_AMT, 0) AS RT_MEDI_AMT,
             c.CALC_PROC_MEDI
      FROM YTS39.PAY_WRK_CALC c
      JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
      WHERE c.CALC_NO LIKE :1
        AND c.CALC_PROC_MEDI IS NOT NULL
        AND NVL(c.RT_MEDI_AMT, 0) > 0
      ORDER BY c.CALC_NO
    `, [prefix])

    const items = rows.map(r => {
      const parsed = parseMediProc(r.CALC_PROC_MEDI)
      const lines = MEDI_CATS
        .map(cat => ({ code: cat.code, label: cat.label, useAmt: Number(parsed?.catAmts[cat.key] ?? 0) }))
        .filter(l => l.useAmt > 0)
      const ex = exhaustInfo(r.EXHAUSTED_POINT)
      return {
        calcNo:    r.CALC_NO,
        nm:        r.NM,
        totPayAmt: Number(r.TOT_PAY_AMT),
        mediDdc:   Number(r.RT_MEDI_AMT),   // YTS 의료비 세액공제 (비교 기준)
        exhausted: ex.exhausted, exhaustLabel: ex.exhaustLabel,
        lines,
      }
    })

    return Response.json({ items })
  }

  if (type === "pension") {
    // 연금계좌 납입건(PAY_WRK_PEN_SAVE_SPEC, 매핑코드만)의 종류별 납입액 라인.
    // YTS 세액공제(비교 기준) = Σ(RT_RSIGN_PEN_*), NTS 8706(연금계좌 총합)과 대조.
    const clsIn = PENSION_CLS_LIST.map((_, i) => `:${i + 2}`).join(", ")
    const rows = await ytsDb.query<{
      CALC_NO: string; NM: string; TOT_PAY_AMT: number; PEN_TAX: number; EXHAUSTED_POINT: string | null
      PEN_SAVE_CLS: string; PEN_SAVE_PMT_AMT: number
    }>(`
      SELECT c.CALC_NO,
             SUBSTR(f.NM, 1, 4) AS NM,
             c.TOT_PAY_AMT, c.EXHAUSTED_POINT,
             NVL(c.RT_RSIGN_PEN_TECH_AMT,0)+NVL(c.RT_RSIGN_PEN_RET_AMT,0)
               +NVL(c.RT_RSIGN_PEN_PF_AMT,0)+NVL(c.RT_ISA_PEN_AMT,0) AS PEN_TAX,
             p.PEN_SAVE_CLS, p.PEN_SAVE_PMT_AMT
      FROM YTS39.PAY_WRK_CALC c
      JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
      JOIN YTS39.PAY_WRK_PEN_SAVE_SPEC p ON p.CALC_NO = c.CALC_NO
      WHERE c.CALC_NO LIKE :1
        AND p.PEN_SAVE_CLS IN (${clsIn})
      ORDER BY c.CALC_NO
    `, [prefix, ...PENSION_CLS_LIST])

    interface PenLine { code: string; label: string; useAmt: number; rank: number }
    interface PenItem { calcNo: string; nm: string; totPayAmt: number; penDdc: number; exhausted: boolean; exhaustLabel: string | null; lines: PenLine[] }
    const map = new Map<string, PenItem>()

    for (const r of rows) {
      const code = pensionNtsCode(r.PEN_SAVE_CLS)
      if (!code) continue
      let item = map.get(r.CALC_NO)
      if (!item) {
        const ex = exhaustInfo(r.EXHAUSTED_POINT)
        item = { calcNo: r.CALC_NO, nm: r.NM, totPayAmt: Number(r.TOT_PAY_AMT), penDdc: Number(r.PEN_TAX), exhausted: ex.exhausted, exhaustLabel: ex.exhaustLabel, lines: [] }
        map.set(r.CALC_NO, item)
      }
      let line = item.lines.find(l => l.code === code)
      if (!line) {
        line = { code, label: PENSION_CODE_LABEL[code] ?? code, useAmt: 0, rank: pensionTypeRank(r.PEN_SAVE_CLS) }
        item.lines.push(line)
      }
      line.useAmt += Number(r.PEN_SAVE_PMT_AMT ?? 0)
    }

    const items = [...map.values()]
    for (const it of items) it.lines.sort((a, b) => a.rank - b.rank)
    return Response.json({ items })
  }

  const rows = await ytsDb.query<{
    CALC_NO: string; NM: string
    TOT_PAY_AMT: number; PROD_TAX_AMT: number; RES_INCM_TAX: number; EFFCTV_TAX_RATE: number
  }>(`
    SELECT c.CALC_NO,
           SUBSTR(f.NM, 1, 4) AS NM,
           c.TOT_PAY_AMT,
           c.PROD_TAX_AMT,
           c.RES_INCM_TAX,
           c.EFFCTV_TAX_RATE
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
    WHERE c.CALC_NO LIKE :1
    ORDER BY c.CALC_NO
  `, [prefix])

  return Response.json({
    items: rows.map(r => ({
      calcNo:        r.CALC_NO,
      nm:            r.NM,
      totPayAmt:     Number(r.TOT_PAY_AMT),
      prodTaxAmt:    Number(r.PROD_TAX_AMT),
      resIncmTax:    Number(r.RES_INCM_TAX),
      effctvTaxRate: Number(r.EFFCTV_TAX_RATE),
    })),
  })
}
