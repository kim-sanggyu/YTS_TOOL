import { ytsDb } from "@/lib/db/oracle"
import { PERSONAL_ROWS, type PersonalKind } from "@/features/hometax-calc/mapping/personal"
import { exhaustInfo } from "@/features/hometax-calc/lib/exhaust"
import { calcMethodLabel, workStatusLabel } from "@/features/hometax-calc/lib/personInfo"

export interface PersonalLine { code: string; label: string; kind: string; ytsDdc: number; ytsInput?: number; birthBreakdown?: string }
export interface PersonalListItem {
  calcNo: string; nm: string; totPayAmt: number
  exhausted: boolean; exhaustLabel: string | null
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  lines: PersonalLine[]
}

// 인적공제 그룹(본인 제외) 사람별 YTS 공제액. 값(>0) 있는 항목만 line 으로.
// kind 지정 시 그 성격(소득공제=인적공제 / 세액공제=혼인·자녀·출산)만 필터.
// NTS 대조값은 화면에서 results.ntsMap[code] 로 조인(코드 전부 이미 send/요청됨).
export async function getPersonalItems(year: string, kind?: PersonalKind): Promise<PersonalListItem[]> {
  const cols      = kind ? PERSONAL_ROWS.filter(r => r.kind === kind) : PERSONAL_ROWS
  const ddcSel    = cols.map(r => `NVL(c.${r.ytsCol}, 0) AS DDC_${r.code}`).join(", ")
  // 전송값(IN): flag 항목은 공제액컬럼>0 을 1명으로 환산, 나머지는 인원/금액 컬럼값 그대로
  const inSel     = cols.map(r => {
    // inputConst: 고정 정액 전송(혼인 500,000 원본) — 컬럼 무시하고 리터럴. 단 자격(공제액>0=ytsCol) 있는 행만 표시되므로 여기선 상수로 충분.
    const expr = r.inputConst != null
      ? `${r.inputConst}`
      : r.inputMode === "flag"
        ? `CASE WHEN NVL(c.${r.inputCol}, 0) > 0 THEN 1 ELSE 0 END`
        : `NVL(c.${r.inputCol}, 0)`
    return `${expr} AS IN_${r.code}`
  }).join(", ")
  const anyPositive = cols.map(r => `NVL(c.${r.ytsCol}, 0) > 0`).join(" OR ")

  // 출산입양(8761) 조회 시 순번별(첫째3/둘째5/셋째7, FMLY_RELN 550-050) 인원 집계 — "전송 사용액" 을 순번별로 표시.
  const hasBirth = cols.some(r => r.code === "8761")
  const birthAgg = (v: string) => `(SELECT NVL(SUM(CASE WHEN PER_CHI_YN='${v}' AND FMLY_RELN='550-050' THEN 1 ELSE 0 END),0)
           FROM YTS39.PAY_WRK_FMLY bf WHERE bf.CALC_NO=c.CALC_NO AND bf.BAS_SUB_YN='Y')`
  const birthSel = hasBirth ? `, ${birthAgg("3")} AS BIRTH1, ${birthAgg("5")} AS BIRTH2, ${birthAgg("7")} AS BIRTH3` : ""

  const rows = await ytsDb.query<Record<string, unknown>>(`
    SELECT c.CALC_NO,
           SUBSTR(f.NM, 1, 4) AS NM,
           c.TOT_PAY_AMT, c.EXHAUSTED_POINT, c.CALC_METHOD, c.CALC_PROC_TOTAL,
           m.EMP_NO, m.KEEP_PS,
           ${ddcSel}, ${inSel}${birthSel}
    FROM YTS39.PAY_WRK_CALC c
    JOIN YTS39.PAY_WRK_FMLY f ON f.CALC_NO = c.CALC_NO AND f.FMLY_SEQ = 1
    JOIN YTS39.PAY_WRK_MAIN m ON m.CALC_NO = c.CALC_NO
    WHERE m.YY = :1
      AND (${anyPositive})
    ORDER BY c.CALC_NO
  `, [year])

  return rows.map(r => {
    // 출산입양 순번별 표시("첫째 1·둘째 1") — 있는 순번만. 없으면 undefined(→ 기존 총인원 표시로 폴백).
    const birthParts: string[] = []
    if (Number(r.BIRTH1 ?? 0) > 0) birthParts.push(`첫째 ${Number(r.BIRTH1)}`)
    if (Number(r.BIRTH2 ?? 0) > 0) birthParts.push(`둘째 ${Number(r.BIRTH2)}`)
    if (Number(r.BIRTH3 ?? 0) > 0) birthParts.push(`셋째 ${Number(r.BIRTH3)}`)
    const birthBreakdown = birthParts.length ? birthParts.join("·") : undefined

    const lines: PersonalLine[] = cols
      .map(row => ({
        code: row.code, label: row.label, kind: row.kind,
        ytsDdc: Number(r[`DDC_${row.code}`] ?? 0), ytsInput: Number(r[`IN_${row.code}`] ?? 0),
        ...(row.code === "8761" && birthBreakdown ? { birthBreakdown } : {}),
      }))
      .filter(l => l.ytsDdc > 0)
    const ex = exhaustInfo(r.EXHAUSTED_POINT as string | null)
    return {
      calcNo:     String(r.CALC_NO),
      nm:         String(r.NM ?? ""),
      totPayAmt:  Number(r.TOT_PAY_AMT ?? 0),
      exhausted:  ex.exhausted, exhaustLabel: ex.exhaustLabel,
      empNo:      (r.EMP_NO as string) ?? "-",
      calcType:   calcMethodLabel(r.CALC_METHOD as string | null),
      workStatus: workStatusLabel(r.KEEP_PS as string | null),
      calcProcTotal: (r.CALC_PROC_TOTAL as string) ?? null,
      lines,
    }
  })
}
