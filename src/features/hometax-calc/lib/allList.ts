import { ytsDb } from "@/lib/db/oracle"
import { exhaustInfo } from "@/features/hometax-calc/lib/exhaust"
import { calcMethodLabel, workStatusLabel } from "@/features/hometax-calc/lib/personInfo"

export interface AllListItem {
  calcNo: string; nm: string
  totPayAmt: number; prodTaxAmt: number; resIncmTax: number; effctvTaxRate: number
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  exhausted: boolean; exhaustLabel: string | null
  // 중간 계(NTS 대조용) — 산출/결정만으론 못 잡는 단계별 차이 진단. NTS 코드: 특별8920·그밖의8921·차감소득8916·감면계8924·세액공제계8923
  spclSubSum: number; otoSum: number; biaAmt: number; taxCut: number; rtSum: number
}

// 전체 비교(종합) 대상 = 해당 연도 전 직원. 산출·결정세액 대조 + 인력정보(사번/표준특별/계속퇴사/계산과정).
export async function getAllItems(year: string): Promise<AllListItem[]> {
  const rows = await ytsDb.query<{
    CALC_NO: string; NM: string
    TOT_PAY_AMT: number; PROD_TAX_AMT: number; RES_INCM_TAX: number; EFFCTV_TAX_RATE: number
    EMP_NO: string | null; KEEP_PS: string | null; CALC_METHOD: string | null
    CALC_PROC_TOTAL: string | null; EXHAUSTED_POINT: string | null
    SPCL_SUB_AMT_SUM: number; OTO_SUM: number; BIA_AMT: number; TAX_CUT: number; RT_SUM: number
  }>(`
    SELECT c.CALC_NO,
           SUBSTR(f.NM, 1, 4) AS NM,
           c.TOT_PAY_AMT, c.PROD_TAX_AMT, c.RES_INCM_TAX, c.EFFCTV_TAX_RATE,
           c.CALC_METHOD, c.CALC_PROC_TOTAL, c.EXHAUSTED_POINT,
           c.SPCL_SUB_AMT_SUM, c.OTO_SUM, c.BIA_AMT, c.TAX_CUT, c.RT_SUM,
           m.EMP_NO, m.KEEP_PS
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
    JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
    WHERE m.YY = :1
    ORDER BY c.CALC_NO
  `, [year])

  return rows.map(r => {
    const ex = exhaustInfo(r.EXHAUSTED_POINT)
    return {
      calcNo:        r.CALC_NO,
      nm:            r.NM,
      totPayAmt:     Number(r.TOT_PAY_AMT),
      prodTaxAmt:    Number(r.PROD_TAX_AMT),
      resIncmTax:    Number(r.RES_INCM_TAX),
      effctvTaxRate: Number(r.EFFCTV_TAX_RATE),
      empNo:         r.EMP_NO ?? "-",
      calcType:      calcMethodLabel(r.CALC_METHOD),
      workStatus:    workStatusLabel(r.KEEP_PS),
      calcProcTotal: r.CALC_PROC_TOTAL,
      exhausted:     ex.exhausted, exhaustLabel: ex.exhaustLabel,
      spclSubSum:    Number(r.SPCL_SUB_AMT_SUM ?? 0),
      otoSum:        Number(r.OTO_SUM ?? 0),
      biaAmt:        Number(r.BIA_AMT ?? 0),
      taxCut:        Number(r.TAX_CUT ?? 0),
      rtSum:         Number(r.RT_SUM ?? 0),
    }
  })
}
