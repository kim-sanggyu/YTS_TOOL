/**
 * 새 판정 단일원천(ddcVerdict/diffCodesOf) 그대로 오프라인 재현 → 실제 차이(✗) 케이스 전수 스캔.
 * 저장된 배치 스냅샷만 사용(NTS 재호출 없음). 리팩터 검증용: 여기서 나온 calcNo·코드가
 * 화면 리스트 배지/드로어 ③표 ✗ 와 일치해야 한다.
 * 실행: npx --yes tsx docs/diff-scan.ts [year=2025] [ntsYear=2025]
 */
import fs from "node:fs"
import path from "node:path"
import { MAPPING_2025, type MappingRow } from "@/features/hometax-calc/mapping/2025"
import { CARD_SUBTOTAL_CODE } from "@/features/hometax-calc/mapping/card"
import { MEDI_SUBTOTAL_CODE } from "@/features/hometax-calc/mapping/medi"
import { GIFT_CODES } from "@/features/hometax-calc/mapping/gift"

const YEAR = process.argv[2] ?? "2025"
const NTS_YEAR = process.argv[3] ?? "2025"
const FILE = path.join(process.cwd(), "data", "hometax-batch-results", `${YEAR}-nts${NTS_YEAR}.json`)

// ── HometaxCalcPanel.tsx 판정 로직 그대로 복제 ──
const FLOW_CODES = new Set(["8900", "8901", "8902", "8903", "8990", "8700", "8999"])
const OUT_GROUPS = new Set(["연금계좌", "그밖의소득공제"]) // outCodeOf self 폴백용(근사) — 아래 SUBTOTAL 판정에만 영향
const SUBTOTAL_KEYS = new Set([CARD_SUBTOTAL_CODE, MEDI_SUBTOTAL_CODE, "8761", "8735", "8410", "8705"])
function outCodeOf(m: MappingRow): string {
  if (m.outCode) return m.outCode
  if (m.ytsCol?.startsWith("CARD_")) return CARD_SUBTOTAL_CODE
  if (m.ytsCol?.startsWith("MEDI_")) return MEDI_SUBTOTAL_CODE
  if (m.ytsCol?.startsWith("OTHER_")) return m.ntsCode
  if (OUT_GROUPS.has(m.group)) return m.ntsCode
  return "—"
}
const MAP_ORDER = new Map<string, number>()
const LABEL = new Map<string, string>()
MAPPING_2025.forEach((row, i) => {
  if (!MAP_ORDER.has(row.ntsCode)) MAP_ORDER.set(row.ntsCode, i)
  if (!LABEL.has(row.ntsCode)) LABEL.set(row.ntsCode, `${row.group}/${row.label}`)
})
const SUBTOTAL_OF = new Set<string>()
for (const row of MAPPING_2025) {
  const oc = outCodeOf(row)
  if (SUBTOTAL_KEYS.has(oc) && oc !== row.ntsCode) SUBTOTAL_OF.add(row.ntsCode)
}
type Verdict = "match" | "diff" | null
function ddcVerdict(ntsMap: Record<string, number>, ytsDdcMap: Record<string, number>, code: string): Verdict {
  if (FLOW_CODES.has(code)) return null
  if (!MAP_ORDER.has(code) && !SUBTOTAL_KEYS.has(code)) return null
  if (SUBTOTAL_OF.has(code)) return null
  const nts = ntsMap[code] as number | undefined
  const yts = ytsDdcMap[code] ?? (GIFT_CODES.has(code) ? 0 : undefined)
  return (yts != null && nts != null && (yts || nts)) ? (yts === nts ? "match" : "diff") : null
}
const DOMAIN = [...MAP_ORDER.keys(), ...SUBTOTAL_KEYS.keys()]

interface Row { calcNo: string; result: { ntsMap?: Record<string, number>; ytsDdcMap?: Record<string, number> } | null }
const store = JSON.parse(fs.readFileSync(FILE, "utf8")) as { rows: Record<string, Row> }
const rows = Object.values(store.rows)

let scanned = 0
const perCode = new Map<string, { people: number; samples: { calcNo: string; yts: number; nts: number }[] }>()
const perPerson: { calcNo: string; codes: string[] }[] = []
for (const r of rows) {
  const res = r.result
  if (!res?.ntsMap || !res.ytsDdcMap) continue
  scanned++
  const hit: string[] = []
  const seen = new Set<string>()
  for (const c of DOMAIN) {
    if (seen.has(c)) continue
    seen.add(c)
    if (ddcVerdict(res.ntsMap, res.ytsDdcMap, c) !== "diff") continue
    hit.push(c)
    const yts = res.ytsDdcMap[c] ?? (GIFT_CODES.has(c) ? 0 : 0)
    const nts = res.ntsMap[c] ?? 0
    const h = perCode.get(c) ?? { people: 0, samples: [] }
    h.people++
    if (h.samples.length < 5) h.samples.push({ calcNo: r.calcNo, yts, nts })
    perCode.set(c, h)
  }
  if (hit.length) perPerson.push({ calcNo: r.calcNo, codes: hit })
}

const won = (n: number) => n.toLocaleString("ko-KR")
console.log(`\n════ 항목층 차이(✗) 스캔  [${YEAR}/nts${NTS_YEAR}]  분석대상 ${scanned}/${rows.length} ════\n`)
if (!perCode.size) { console.log("항목층 차이 0건 — 전 항목 일치 ✓"); process.exit(0) }

console.log(`■ 코드별 차이 (사람수 내림차순)`)
for (const [code, h] of [...perCode.entries()].sort((a, b) => b[1].people - a[1].people)) {
  const tag = GIFT_CODES.has(code) ? "기부" : SUBTOTAL_KEYS.has(code) ? "소계" : ""
  const samp = h.samples.map(s => `${s.calcNo}(YTS ${won(s.yts)}→NTS ${won(s.nts)})`).join("  ")
  console.log(`  ${code} ${tag.padEnd(3)} ${(LABEL.get(code) ?? "(소계/미매핑)").padEnd(26)} ${String(h.people).padStart(4)}명  ${samp}`)
}
console.log(`\n■ 차이 있는 사람 ${perPerson.length}명 (앞 20)`)
for (const p of perPerson.slice(0, 20)) console.log(`  ${p.calcNo}  ✗${p.codes.length}  [${p.codes.join(", ")}]`)
console.log(`\n▶ 화면 검증: 위 calcNo 를 열어 리스트 배지(차이 N건) = 드로어 ③표 ✗ 개수 = 여기 ✗개수 가 같은지 확인.`)
process.exit(0)
