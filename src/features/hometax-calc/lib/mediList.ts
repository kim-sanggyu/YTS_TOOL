import { ytsDb } from "@/lib/db/oracle"
import { MEDI_CATS, parseMediProc } from "@/features/hometax-calc/mapping/medi"
import { getMediSelfAggByYear } from "@/features/hometax-calc/lib/mediSelfAggregate"
import { exhaustInfo } from "@/features/hometax-calc/lib/exhaust"
import { calcMethodLabel, workStatusLabel } from "@/features/hometax-calc/lib/personInfo"

// useAmt = CALC_PROC_MEDI(YTS 엔진 산출, NTS 전송값) / selfAmt = 검증도구 자체집계(원천 독립 재집계).
// 대조a: 둘이 같으면 집계 로직 무결(사각 메움). [[project_medi_edu_source_verification]]
export interface MediLine { code: string; label: string; useAmt: number; selfAmt: number }
export interface MediListItem {
  calcNo: string; nm: string; totPayAmt: number; mediDdc: number
  exhausted: boolean; exhaustLabel: string | null
  empNo: string; calcType: string; workStatus: string
  calcProcTotal: string | null   // 목록에선 항상 null — CLOB은 팝업/드로어에서 lazy 로드
  hasProc: boolean               // 계산과정 존재 여부(버튼 활성화용)
  selfAggMismatch: boolean        // 자체집계 vs CALC_PROC 4항목 중 하나라도 불일치(목록 배지용)
  lines: MediLine[]
}

// 의료비공제 발생 건(CALC_PROC_MEDI 존재 + RT_MEDI_AMT>0)의 대상자별 지출금액 라인.
// YTS 의료비 세액공제(비교 기준) = RT_MEDI_AMT(=의료비_공제금액), NTS 8726(의료비집계)과 대조.
export async function getMediItems(year: string, calcNo?: string): Promise<MediListItem[]> {
  const [rows, selfMap] = await Promise.all([
    ytsDb.query<{
      CALC_NO: string; NM: string; TOT_PAY_AMT: number; EXHAUSTED_POINT: string | null
      RT_MEDI_AMT: number; CALC_PROC_MEDI: string | null
      CALC_METHOD: string | null; HAS_PROC: number
      EMP_NO: string | null; KEEP_PS: string | null
    }>(`
      SELECT c.CALC_NO,
             SUBSTR(f.NM, 1, 4) AS NM,
             c.TOT_PAY_AMT, c.EXHAUSTED_POINT,
             NVL(c.RT_MEDI_AMT, 0) AS RT_MEDI_AMT,
             c.CALC_PROC_MEDI, c.CALC_METHOD,
             CASE WHEN c.CALC_PROC_TOTAL IS NOT NULL THEN 1 ELSE 0 END AS HAS_PROC,
             m.EMP_NO, m.KEEP_PS
      FROM YTS39.PAY_WRK_CALC c
      JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
      JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
      WHERE m.YY = :1
        AND c.CALC_PROC_MEDI IS NOT NULL
        AND NVL(c.RT_MEDI_AMT, 0) > 0
        ${calcNo ? "AND c.CALC_NO = :2" : ""}
      ORDER BY c.CALC_NO
    `, calcNo ? [year, calcNo] : [year]),
    getMediSelfAggByYear(year),   // 원천 독립 재집계(대조a용) — 1쿼리 배치
  ])

  return rows.map(r => {
    const parsed = parseMediProc(r.CALC_PROC_MEDI)
    const agg = selfMap.get(r.CALC_NO)
    const lines: MediLine[] = MEDI_CATS
      .map(cat => ({
        code:    cat.code,
        label:   cat.label,
        useAmt:  Number(parsed?.catAmts[cat.key] ?? 0),
        selfAmt: Number(agg?.[cat.selfKey] ?? 0),
      }))
      .filter(l => l.useAmt > 0 || l.selfAmt > 0)   // 한쪽만 있어도(불일치) 노출
    const selfAggMismatch = lines.some(l => l.useAmt !== l.selfAmt)
    const ex = exhaustInfo(r.EXHAUSTED_POINT)
    return {
      calcNo:    r.CALC_NO,
      nm:        r.NM,
      totPayAmt: Number(r.TOT_PAY_AMT),
      mediDdc:   Number(r.RT_MEDI_AMT),   // YTS 의료비 세액공제 (비교 기준)
      exhausted: ex.exhausted, exhaustLabel: ex.exhaustLabel,
      empNo:     r.EMP_NO ?? "-",
      calcType:  calcMethodLabel(r.CALC_METHOD),
      workStatus: workStatusLabel(r.KEEP_PS),
      calcProcTotal: null,
      hasProc:   Number(r.HAS_PROC) === 1,
      selfAggMismatch,
      lines,
    }
  })
}
