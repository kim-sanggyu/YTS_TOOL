// 투자조합출자(그밖의소득공제) — PAY_WRK_PEN_SAVE_SPEC.INVST_CLS/INVST_YY 로 연도×종류 분리.
//   INVST_CLS 2:벤처등 / 1:조합1 / 3:조합2, 연도=INVST_YY. yearOffset = INVST_YY - ntsYear (0=당해,-1,-2).
//   NTS 코드 = (종류, 연도) 조합. 라이브 캡처 실측확정(2026-07-18). 벤처등=100%·조합=10%, 소계 8410.
export interface InvestmentType { cls: string; label: string; codes: Record<number, string> }  // offset → NTS코드

export const INVESTMENT_TYPES: InvestmentType[] = [
  { cls: "2", label: "벤처등", codes: { [-2]: "8416", [-1]: "8418", [0]: "8420" } },
  { cls: "1", label: "조합1",  codes: { [-2]: "8415", [-1]: "8417", [0]: "8419" } },
  { cls: "3", label: "조합2",  codes: { [-2]: "8421", [-1]: "8422", [0]: "8423" } },
]

export const INVESTMENT_SUBTOTAL_CODE = "8410"

// (INVST_CLS, yearOffset) → NTS 코드. 화면에 없는 연도(offset<-2 등)는 undefined.
export function investmentCode(cls: string, offset: number): string | undefined {
  return INVESTMENT_TYPES.find(t => t.cls === cls)?.codes[offset]
}

// NTS 코드 → 라벨("2023 벤처등" 등). ntsYear 로 연도 복원.
export function investmentLabel(code: string, ntsYear: number): string | undefined {
  for (const t of INVESTMENT_TYPES) {
    for (const [offset, c] of Object.entries(t.codes)) {
      if (c === code) return `${ntsYear + Number(offset)} ${t.label}`
    }
  }
  return undefined
}
