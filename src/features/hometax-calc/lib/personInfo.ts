// PAY_WRK_CALC.CALC_METHOD 텍스트로 표준/특별 세액계산 방식 판정
export function calcMethodLabel(method: string | null): string {
  if (!method) return "-"
  return method.includes("표준세액공제 적용 세액") ? "표준" : "특별"
}

// PAY_WRK_MAIN.KEEP_PS: '1'=계속근무, '2'=중도퇴사
export function workStatusLabel(keepPs: string | null): string {
  if (keepPs === "1") return "계속근로"
  if (keepPs === "2") return "중도퇴사"
  return "-"
}
