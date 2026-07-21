import { PROC_LABEL_CODE_2025 } from "@/features/hometax-calc/mapping/2025"

// 계산과정(CALC_PROC_TOTAL) 항목행 파싱: "(잔액) [잔액] - [공제금액] ([항목명]  ) 설명"
//   라벨 필드는 좌측정렬 + 우측 공백패딩 후 ')'. 내부 괄호(대출기관/30조제외 등)까지 담기 위해
//   "라벨(내부괄호 포함) + 공백 + )" 로 종료 판정. group1=공제금액, group2=항목명.
export const PROC_ROW_RE = /\(잔액\)\s+[\d,]+\s+-\s+([\d,]+)\s+\((.+?)\s+\)/

// 계산과정 텍스트 → 등장 코드 순서(위→아래, 매핑된 것만, 중복 제거).
//   실행과정 ③표(NTS 원본 IN/OUT)를 계산과정과 같은 순서로 정렬하는 단일 기준.
export function procCodeOrder(text: string): string[] {
  const order: string[] = []
  const seen = new Set<string>()
  for (const line of text.split("\n")) {
    const m = PROC_ROW_RE.exec(line)
    if (!m) continue
    const code = PROC_LABEL_CODE_2025[m[2].trim()]
    if (code && !seen.has(code)) { seen.add(code); order.push(code) }
  }
  return order
}
