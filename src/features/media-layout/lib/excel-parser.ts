import * as XLSX from "xlsx"
import type { TaxLayoutRow } from "../types"

const TYPE_LEN_RE = /([x9])\((\d+)\)/i

// 구분 값 끝의 숫자로 섹션 결정
// 예) 【소득공제명세의 인적사항1】 → "BODY_1"
//     【자료관리번호】             → "HEAD"
function resolveSect(구분: string): string {
  const m = 구분.match(/(\d+)】?$/)
  return m ? `BODY_${m[1]}` : "HEAD"
}

export function parseTaxExcel(buffer: Buffer): TaxLayoutRow[] {
  const wb = XLSX.read(buffer, { type: "buffer" })
  const ws = wb.Sheets["국세청"]
  if (!ws) throw new Error("Excel 파일에 '국세청' sheet가 없습니다.")

  const raw = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { header: 1, defval: "" })

  const rows: TaxLayoutRow[] = []
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i] as unknown as string[]
    const 구분 = String(r[0] ?? "").trim()
    const 코드 = String(r[1] ?? "").trim()
    const 항목 = String(r[2] ?? "").trim()
    const 값 = String(r[3] ?? "").trim()
    if (!코드) continue

    const m = TYPE_LEN_RE.exec(값)
    rows.push({
      seq:  0,
      구분,
      코드,
      항목,
      값,
      타입: m ? m[1].toLowerCase() : undefined,
      길이: m ? parseInt(m[2]) : undefined,
      sect: resolveSect(구분),
    })
  }
  return rows
}
