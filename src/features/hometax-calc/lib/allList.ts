import { ytsDb } from "@/lib/db/oracle"

export interface AllListItem {
  calcNo: string; nm: string
  totPayAmt: number; prodTaxAmt: number; resIncmTax: number; effctvTaxRate: number
}

// 전체 비교(종합) 대상 = 해당 연도 전 직원. 결정세액/산출세액 대조용 기본값.
export async function getAllItems(year: string): Promise<AllListItem[]> {
  const rows = await ytsDb.query<{
    CALC_NO: string; NM: string
    TOT_PAY_AMT: number; PROD_TAX_AMT: number; RES_INCM_TAX: number; EFFCTV_TAX_RATE: number
  }>(`
    SELECT c.CALC_NO,
           SUBSTR(f.NM, 1, 4) AS NM,
           c.TOT_PAY_AMT, c.PROD_TAX_AMT, c.RES_INCM_TAX, c.EFFCTV_TAX_RATE
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
    WHERE c.CALC_NO LIKE :1
    ORDER BY c.CALC_NO
  `, [`X${year}%`])

  return rows.map(r => ({
    calcNo:        r.CALC_NO,
    nm:            r.NM,
    totPayAmt:     Number(r.TOT_PAY_AMT),
    prodTaxAmt:    Number(r.PROD_TAX_AMT),
    resIncmTax:    Number(r.RES_INCM_TAX),
    effctvTaxRate: Number(r.EFFCTV_TAX_RATE),
  }))
}
