// CALC_PROC_TOTAL 파싱 — 소진 감지 전용
// 소득/세액이 어느 단계에서 소진됐는지, 이후 어떤 항목이 건너뛰어졌는지는
// CALC_PROC_TOTAL 계산 흐름에만 존재하므로 파싱이 필요함.
// 그 외 금액·입력값은 PAY_WRK_CALC/PAY_WRK_MAIN 컬럼을 직접 사용.

export interface TotalContext {
  incomeExhausted: boolean      // 소득 소진 여부
  incomeExhaustPoint: string    // 소득 소진 항목명 (예: "본인")
  taxExhausted: boolean         // 세액 소진 여부
  taxExhaustPoint: string       // 세액 소진 항목명 (예: "의료비")
  taxExhaustedSkipped: string[] // 세액소진 이후 건너뛴 항목 목록
  // 세대 구분 — ※ 이름님(..., 세대주/세대주배우자/세대원) 푸터에서 파싱
  // 세대주·세대주배우자 → 주택마련저축 공제 가능, 세대원 또는 미포함 → 불가
  isHouseHolder: boolean | null // null: 푸터에 세대 구분 없음 → DB 폴백
}

export function parseTotalContext(text: string): TotalContext {
  // 소득 소진
  const incomeExhausted = text.includes("근로소득 잔액이 '0'이 되었습니다")
  let incomeExhaustPoint = ''
  if (incomeExhausted) {
    const m = text.match(/소진지점:\s*(.+)/)
    if (m) incomeExhaustPoint = m[1].trim()
  }

  // 세액 소진
  const taxExhaustMatch = text.match(/\[(.+?)\]\s*항목에서 산출세액이 모두 소진/)
  const taxExhausted    = !!taxExhaustMatch
  const taxExhaustPoint = taxExhaustMatch ? taxExhaustMatch[1] : ''

  // 세액소진 이후 건너뛴 항목 — ※표기생략 또는 ※계산식생략(산출세액 잔액 0) 줄에서 추출
  const taxExhaustedSkipped: string[] = []
  for (const line of text.split('\n')) {
    const markerIdx =
      line.includes('※표기생략(산출세액 잔액 0)')   ? line.indexOf('※표기생략(산출세액 잔액 0)') :
      line.includes('※계산식생략(산출세액 잔액 0)') ? line.indexOf('※계산식생략(산출세액 잔액 0)') :
      -1
    if (markerIdx === -1) continue
    const before  = line.substring(0, markerIdx)
    const matches = [...before.matchAll(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)]
    const last    = matches.pop()
    if (last) taxExhaustedSkipped.push(last[1].trim())
  }

  // 세대 구분 — ※ 이름님(..., 세대주/세대주배우자/세대원) 푸터에서 파싱
  // null: 푸터에 세대 구분 없음 → analyzer에서 HOUSE_HLDR_YN DB 폴백
  let isHouseHolder: boolean | null = null
  const personMatch = text.match(/※\s+.+?님\(([^)]+)\)/)
  if (personMatch) {
    const parts = personMatch[1].split(',').map(s => s.trim())
    if (parts.includes('세대주') || parts.includes('세대주배우자')) isHouseHolder = true
    else if (parts.includes('세대원')) isHouseHolder = false
  }

  return { incomeExhausted, incomeExhaustPoint, taxExhausted, taxExhaustPoint, taxExhaustedSkipped, isHouseHolder }
}
