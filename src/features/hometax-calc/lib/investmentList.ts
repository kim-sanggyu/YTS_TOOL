import { ytsDb } from "@/lib/db/oracle"
import { investmentCode, investmentLabel } from "@/features/hometax-calc/mapping/investment"
import { exhaustInfo } from "@/features/hometax-calc/lib/exhaust"
import { calcMethodLabel, workStatusLabel } from "@/features/hometax-calc/lib/personInfo"
import type { HousingListItem, HousingLine } from "@/features/hometax-calc/lib/housingList"

// 투자조합출자(그밖의소득공제) 그룹 — PAY_WRK_PEN_SAVE_SPEC.INVST_CLS(2벤처/1조합1/3조합2)×INVST_YY 로 연도/종류 분리.
//   전송 사용액 = ΣPEN_SAVE_PMT_AMT(납입) → 화면 표시, 대조 공제액 = ΣPEN_SAVE_SUB_AMT ↔ NTS ntsMap[code].
//   code = investmentCode(INVST_CLS, INVST_YY - ntsYear). 라이브 캡처 실측확정(2026-07-18).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getInvestmentItems(year: string, ntsYear: string): Promise<HousingListItem[]> {
  const base    = Number(year)   // 오프셋 기준=YTS 당해(dataYear). INVST_YY-base 로 연차, 라벨도 실제 투자연도(INVST_YY) 표시

  const rows = await ytsDb.query<{
    CALC_NO: string; NM: string; TOT_PAY_AMT: number; EXHAUSTED_POINT: string | null
    CALC_METHOD: string | null; CALC_PROC_TOTAL: string | null; EMP_NO: string | null; KEEP_PS: string | null
    INVST_CLS: string; INVST_YY: string; PEN_SAVE_PMT_AMT: number; PEN_SAVE_SUB_AMT: number
  }>(`
    SELECT c.CALC_NO,
           SUBSTR(f.NM, 1, 4) AS NM,
           c.TOT_PAY_AMT, c.EXHAUSTED_POINT, c.CALC_METHOD, c.CALC_PROC_TOTAL,
           m.EMP_NO, m.KEEP_PS,
           p.INVST_CLS, p.INVST_YY, p.PEN_SAVE_PMT_AMT, p.PEN_SAVE_SUB_AMT
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
    JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
    JOIN YTS39.PAY_WRK_PEN_SAVE_SPEC p ON p.CALC_NO = c.CALC_NO AND p.PEN_SAVE_CLS = '562-110' AND p.INVST_CLS IN ('1','2','3')
    WHERE m.YY = :1
    ORDER BY c.CALC_NO
  `, [year])

  const map = new Map<string, HousingListItem>()
  for (const r of rows) {
    const code = investmentCode(String(r.INVST_CLS), Number(r.INVST_YY) - base)
    if (!code) continue
    let item = map.get(r.CALC_NO)
    if (!item) {
      const ex = exhaustInfo(r.EXHAUSTED_POINT)
      item = {
        calcNo: r.CALC_NO, nm: r.NM, totPayAmt: Number(r.TOT_PAY_AMT),
        exhausted: ex.exhausted, exhaustLabel: ex.exhaustLabel,
        empNo: r.EMP_NO ?? "-", calcType: calcMethodLabel(r.CALC_METHOD), workStatus: workStatusLabel(r.KEEP_PS),
        calcProcTotal: r.CALC_PROC_TOTAL, lines: [],
      }
      map.set(r.CALC_NO, item)
    }
    let line = item.lines.find(l => l.code === code)
    if (!line) {
      line = { code, label: investmentLabel(code, base) ?? code, kind: "소득공제", ytsDdc: 0, ytsInput: 0 } as HousingLine
      item.lines.push(line)
    }
    line.ytsInput = (line.ytsInput ?? 0) + Number(r.PEN_SAVE_PMT_AMT ?? 0)
    line.ytsDdc  += Number(r.PEN_SAVE_SUB_AMT ?? 0)
  }

  const items = [...map.values()]
  for (const it of items) {
    it.lines = it.lines.filter(l => (l.ytsInput ?? 0) > 0 || l.ytsDdc > 0).sort((a, b) => a.code.localeCompare(b.code))
  }
  return items.filter(it => it.lines.length > 0)
}
