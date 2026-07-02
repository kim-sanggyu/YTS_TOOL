// CALC_PROC_TOTAL 파싱
// 해설서 기능은 이 파일이 읽는 CALC_PROC_TOTAL 정보만으로 동작한다.
// 외부 DB 컬럼 의존을 줄이는 방향으로 항목별로 교체 중 (2026-07-02~)
// 설계 원칙: docs/tax-insight-commentary-design.md 참조

export interface TotalInputs {
  월세액: number
  건강보험료: number
  고용보험료: number
  보장성보험료: number
  교육비: number
  청약저축: number
  주택청약종합저축: number
  근로자주택마련저축: number
  주택임차차입금_대출기관: number
  주택임차차입금_거주자: number
}

export interface TotalContext {
  inputs: TotalInputs
  isStandard: boolean         // 표준세액공제 방식 여부
  taxExhausted: boolean       // 세액 소진 여부
  taxExhaustPoint: string     // 세액 소진 항목명 (예: "의료비", "월세액")
  taxExhaustedSkipped: string[] // 세액소진 이후 ※표기생략된 항목명 목록
  incomeExhausted: boolean    // 소득 소진 여부
  incomeExhaustPoint: string  // 소득 소진 항목명 (예: "본인")
  주택한도소진: boolean        // 주택임차차입금원리금상환액이 400만원 한도 전부 소진 → 주택마련저축 공제 불가
  산출세액: number
}

function num(s: string): number {
  return parseInt(s.replace(/,/g, ''), 10) || 0
}

// ====소득자 입력 값==== ~ ====END==== 섹션 파싱
function parseInputSection(text: string): TotalInputs {
  const result: TotalInputs = {
    월세액: 0, 건강보험료: 0, 고용보험료: 0,
    보장성보험료: 0, 교육비: 0,
    청약저축: 0, 주택청약종합저축: 0, 근로자주택마련저축: 0,
    주택임차차입금_대출기관: 0, 주택임차차입금_거주자: 0,
  }

  const startIdx = text.indexOf('====소득자 입력 값====')
  if (startIdx === -1) return result

  const after = text.slice(startIdx + '====소득자 입력 값===='.length)
  for (const line of after.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('=')) break
    const kv = trimmed.match(/^(.+?):\s*(.+)$/)
    if (!kv) continue
    const [, key, val] = kv.map(s => s.trim())
    switch (key) {
      case '월세액':               result.월세액 = num(val); break
      case '건강보험료':           result.건강보험료 = num(val); break
      case '고용보험료':           result.고용보험료 = num(val); break
      case '보장성보험료':         result.보장성보험료 = num(val); break
      case '교육비':               result.교육비 = num(val); break
      case '청약저축':             result.청약저축 = num(val); break
      case '주택청약종합저축':     result.주택청약종합저축 = num(val); break
      case '근로자주택마련저축':   result.근로자주택마련저축 = num(val); break
      case '주택임차차입금_대출기관': result.주택임차차입금_대출기관 = num(val); break
      case '주택임차차입금_거주자':   result.주택임차차입금_거주자 = num(val); break
    }
  }
  return result
}

export function parseTotalContext(text: string): TotalContext {
  const inputs = parseInputSection(text)

  // 표준세액공제 방식 여부
  const isStandard = text.includes("'표준세액공제' 방식으로 계산합니다")

  // 세액 소진 — ▣▣▣ [항목명] 항목에서 산출세액이 모두 소진
  const taxExhaustMatch = text.match(/\[(.+?)\]\s*항목에서 산출세액이 모두 소진/)
  const taxExhausted = !!taxExhaustMatch
  const taxExhaustPoint = taxExhaustMatch ? taxExhaustMatch[1] : ''

  // 소득 소진 — ▣▣▣ 근로소득 잔액이 '0'이 되었습니다
  const incomeExhausted = text.includes("근로소득 잔액이 '0'이 되었습니다")
  let incomeExhaustPoint = ''
  if (incomeExhausted) {
    // 소득소진 시 소진지점은 ※ 라인에서 파싱
    const soginMatch = text.match(/소진지점:\s*(.+)/)
    if (soginMatch) incomeExhaustPoint = soginMatch[1].trim()
  }

  // 세액소진으로 표기생략된 항목 — ※표기생략(산출세액 잔액 0) 포함된 줄에서 항목명 추출
  const taxExhaustedSkipped: string[] = []
  for (const line of text.split('\n')) {
    if (!line.includes('※표기생략(산출세액 잔액 0)')) continue
    const before = line.substring(0, line.indexOf('※표기생략'))
    const matches = [...before.matchAll(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)]
    const last = matches.pop()
    if (last) taxExhaustedSkipped.push(last[1].trim())
  }

  // 주택 400만원 한도 소진 — ①주택4백한도 0
  const 주택한도소진 = /주택4백한도\s*0[,)]/.test(text)

  // 산출세액
  const prodMatch = text.match(/ㆍ\s*([\d,]+)\s*\(산출세액\)/)
  const 산출세액 = prodMatch ? num(prodMatch[1]) : 0

  return {
    inputs, isStandard,
    taxExhausted, taxExhaustPoint, taxExhaustedSkipped,
    incomeExhausted, incomeExhaustPoint,
    주택한도소진,
    산출세액,
  }
}
