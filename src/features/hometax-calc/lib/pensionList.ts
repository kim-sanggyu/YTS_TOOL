import { ytsDb } from "@/lib/db/oracle"
import { pensionNtsCode, pensionTypeRank, PENSION_CODE_LABEL, PENSION_CLS_LIST } from "@/features/hometax-calc/mapping/pension"
import { exhaustInfo } from "@/features/hometax-calc/lib/exhaust"
import { calcMethodLabel, workStatusLabel } from "@/features/hometax-calc/lib/personInfo"

export interface PensionLine { code: string; label: string; useAmt: number; rank: number }
export interface PensionListItem {
  calcNo: string; nm: string; totPayAmt: number; penDdc: number
  exhausted: boolean; exhaustLabel: string | null
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  lines: PensionLine[]
}

// 연금계좌 납입건(PAY_WRK_PEN_SAVE_SPEC, 매핑코드만)의 종류별 납입액 라인.
// YTS 세액공제(비교 기준) = Σ(RT_RSIGN_PEN_*), NTS 8706(연금계좌 총합)과 대조.
export async function getPensionItems(year: string): Promise<PensionListItem[]> {
  const prefix = `X${year}%`
  const clsIn = PENSION_CLS_LIST.map((_, i) => `:${i + 2}`).join(", ")

  const rows = await ytsDb.query<{
    CALC_NO: string; NM: string; TOT_PAY_AMT: number; PEN_TAX: number; EXHAUSTED_POINT: string | null
    CALC_METHOD: string | null; CALC_PROC_TOTAL: string | null
    EMP_NO: string | null; KEEP_PS: string | null
    PEN_SAVE_CLS: string; PEN_SAVE_PMT_AMT: number
  }>(`
    SELECT c.CALC_NO,
           SUBSTR(f.NM, 1, 4) AS NM,
           c.TOT_PAY_AMT, c.EXHAUSTED_POINT,
           NVL(c.RT_RSIGN_PEN_TECH_AMT,0)+NVL(c.RT_RSIGN_PEN_RET_AMT,0)
             +NVL(c.RT_RSIGN_PEN_PF_AMT,0)+NVL(c.RT_ISA_PEN_AMT,0) AS PEN_TAX,
           c.CALC_METHOD, c.CALC_PROC_TOTAL,
           m.EMP_NO, m.KEEP_PS,
           p.PEN_SAVE_CLS, p.PEN_SAVE_PMT_AMT
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
        calcNo: r.CALC_NO, nm: r.NM, totPayAmt: Number(r.TOT_PAY_AMT), penDdc: Number(r.PEN_TAX),
        exhausted: ex.exhausted, exhaustLabel: ex.exhaustLabel,
        empNo: r.EMP_NO ?? "-", calcType: calcMethodLabel(r.CALC_METHOD), workStatus: workStatusLabel(r.KEEP_PS),
        calcProcTotal: r.CALC_PROC_TOTAL,
        lines: [],
      }
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
  return items
}
