import { ytsDb } from "@/lib/db/oracle"
import { pensionNtsCode, pensionTypeRank, PENSION_CODE_LABEL, PENSION_CLS_LIST } from "@/features/hometax-calc/mapping/pension"
import { exhaustInfo } from "@/features/hometax-calc/lib/exhaust"
import { calcMethodLabel, workStatusLabel } from "@/features/hometax-calc/lib/personInfo"

export interface PensionLine { code: string; label: string; useAmt: number; ytsDdc: number; rank: number }
export interface PensionListItem {
  calcNo: string; nm: string; totPayAmt: number; penDdc: number
  exhausted: boolean; exhaustLabel: string | null
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  lines: PensionLine[]
}

// 연금계좌 납입건(PAY_WRK_PEN_SAVE_SPEC, 매핑코드만)의 종류별 라인 = 납입액 + 세액공제액.
// ★국세청이 항목별 self ddcAmt(8701~8708) 반환(2026-07-15 실측확정) → 항목별 1:1 대조.
//   YTS 항목별 세액공제액 = 계좌별 PEN_SAVE_SUB_AMT 를 NTS 코드로 합산(=세액공제액, 한도·세율 반영).
//   (개별합 == 국세청 8706 총합 == Σ RT_RSIGN_PEN_* 전건 원단위 일치.)
export async function getPensionItems(year: string): Promise<PensionListItem[]> {
  const prefix = `X${year}%`
  const clsIn = PENSION_CLS_LIST.map((_, i) => `:${i + 2}`).join(", ")

  const rows = await ytsDb.query<{
    CALC_NO: string; NM: string; TOT_PAY_AMT: number; EXHAUSTED_POINT: string | null
    CALC_METHOD: string | null; CALC_PROC_TOTAL: string | null
    EMP_NO: string | null; KEEP_PS: string | null
    PEN_SAVE_CLS: string; PEN_SAVE_PMT_AMT: number; PEN_SAVE_SUB_AMT: number
  }>(`
    SELECT c.CALC_NO,
           SUBSTR(f.NM, 1, 4) AS NM,
           c.TOT_PAY_AMT, c.EXHAUSTED_POINT,
           c.CALC_METHOD, c.CALC_PROC_TOTAL,
           m.EMP_NO, m.KEEP_PS,
           p.PEN_SAVE_CLS, p.PEN_SAVE_PMT_AMT, p.PEN_SAVE_SUB_AMT
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
    LEFT JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
    JOIN YTS39.PAY_WRK_PEN_SAVE_SPEC p ON p.CALC_NO = c.CALC_NO
    WHERE c.CALC_NO LIKE :1
      AND p.PEN_SAVE_CLS IN (${clsIn})
    ORDER BY c.CALC_NO
  `, [prefix, ...PENSION_CLS_LIST])

  const map = new Map<string, PensionListItem>()

  for (const r of rows) {
    const code = pensionNtsCode(r.PEN_SAVE_CLS)
    if (!code) continue
    let item = map.get(r.CALC_NO)
    if (!item) {
      const ex = exhaustInfo(r.EXHAUSTED_POINT)
      item = {
        calcNo: r.CALC_NO, nm: r.NM, totPayAmt: Number(r.TOT_PAY_AMT), penDdc: 0,
        exhausted: ex.exhausted, exhaustLabel: ex.exhaustLabel,
        empNo: r.EMP_NO ?? "-", calcType: calcMethodLabel(r.CALC_METHOD), workStatus: workStatusLabel(r.KEEP_PS),
        calcProcTotal: r.CALC_PROC_TOTAL,
        lines: [],
      }
      map.set(r.CALC_NO, item)
    }
    let line = item.lines.find(l => l.code === code)
    if (!line) {
      line = { code, label: PENSION_CODE_LABEL[code] ?? code, useAmt: 0, ytsDdc: 0, rank: pensionTypeRank(r.PEN_SAVE_CLS) }
      item.lines.push(line)
    }
    line.useAmt += Number(r.PEN_SAVE_PMT_AMT ?? 0)
    line.ytsDdc += Number(r.PEN_SAVE_SUB_AMT ?? 0)   // 계좌별 세액공제액 → 항목별 합산
  }

  const items = [...map.values()]
  for (const it of items) {
    it.lines.sort((a, b) => a.rank - b.rank)
    it.penDdc = it.lines.reduce((s, l) => s + l.ytsDdc, 0)   // 연금계좌 세액공제 총합 = 항목별 합
  }
  return items
}
