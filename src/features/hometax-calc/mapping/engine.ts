/**
 * 매핑 파생 로직 — 연도 무관(단일 원천). 데이터(mapping·coverage·marriageCredit)를 인자로 받는다.
 * 연도별 데이터는 mapping/2025.ts 등에, 연도 라우팅은 mapping/registry.ts 의 getYearConfig 가 담당.
 * (기존 mapping/2025.ts 에 있던 로직을 연도 파라미터화해 이관 — 동작 불변)
 */
import type { Coverage, MappingRow, NtsInputRow } from "./types"

/** 매핑에서 값을 읽어와야 하는 YTS39 컬럼 목록 (SQL SELECT 생성용, 중복·null 제거).
 *  send 여부와 무관하게 전부 조회해야 "값은 있는데 미전송"을 감지할 수 있다. */
export function mappingSelectCols(mapping: MappingRow[]): string[] {
  const set = new Set<string>()
  for (const m of mapping) if (m.ytsCol) set.add(m.ytsCol)
  return [...set]
}

/** 한 매핑행이 실제로 L03 에 넣을 값. 미전송(send:false)이면 0.
 *  const1=1, flag=원천값>0이면 1, value=원천값 그대로.
 *  혼인공제(8790) 특수: 자격(FAM_MRRG>0)이면 원본 marriageCredit 을 직접 전송(국세청이 잔액 소진캡). */
export function mappingSentValue(m: MappingRow, vals: Record<string, number>, marriageCredit: number): number {
  if (!m.send) return 0
  if (m.ntsCode === "8790") return Number(vals.FAM_MRRG ?? 0) > 0 ? marriageCredit : 0
  if (m.rule === "const1") return 1
  const raw = m.ytsCol ? Number(vals[m.ytsCol] ?? 0) : 0
  return m.rule === "flag" ? (raw > 0 ? 1 : 0) : raw
}

/** YTS 값 레코드(컬럼명→값) → 전 매핑행의 입력상태(0 포함) */
export function computeInputs(vals: Record<string, number>, mapping: MappingRow[], marriageCredit: number): NtsInputRow[] {
  return mapping.map(m => {
    const raw = m.ytsCol ? Number(vals[m.ytsCol] ?? 0) : 0
    return {
      code:     m.ntsCode,
      label:    m.label,
      group:    m.group,
      ytsCol:   m.ytsCol,
      valueKey: m.valueKey,
      status:   m.status,
      send:     m.send,
      altSent:  m.altSent ?? false,
      ytsValue: raw,
      hasValue: m.rule === "const1" ? true : raw > 0,
      sent:     mappingSentValue(m, vals, marriageCredit),
      outCode:  m.outCode,
      note:     m.note,
    }
  })
}

/** 커버리지 판정 조회. send:true 인데 coverage 에 없으면 undefined → 현황탭이 "미분류"(적색)로 표시. */
export function coverageOf(code: string, coverage: Record<string, Coverage>): Coverage | undefined {
  return coverage[code]
}
