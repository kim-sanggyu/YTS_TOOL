/**
 * ③표 판정 로직 변경(1980행: "YTS undefined vs NTS nonzero" 도 diff 처리) 전수 triage.
 * 저장된 배치 스냅샷을 오프라인 분석 — NTS 재호출 없음.
 *   새로 ✗ 뜨는 코드 = ③표 노출(mapped/subtotal, not compareCode, not subMember)
 *                    & ytsDdcMap[code] === undefined & NTS ddcAmt > 0
 * (ytsDdcMap[code] === 0 은 기존 로직도 이미 ✗ 처리했으므로 신규 아님)
 * 실행: npx --yes tsx docs/gift-8784-triage.ts [year=2025] [ntsYear=2025]
 */
import fs from "node:fs"
import path from "node:path"
import { MAPPING_2025 } from "@/features/hometax-calc/mapping/2025"
import { CARD_SUBTOTAL_CODE } from "@/features/hometax-calc/mapping/card"
import { MEDI_SUBTOTAL_CODE } from "@/features/hometax-calc/mapping/medi"
import { GIFT_CODES } from "@/features/hometax-calc/mapping/gift"

const YEAR = process.argv[2] ?? "2025"
const NTS_YEAR = process.argv[3] ?? "2025"
const FILE = path.join(process.cwd(), "data", "hometax-batch-results", `${YEAR}-nts${NTS_YEAR}.json`)

const COMPARE_CODES = new Set(["8900", "8901", "8902", "8903", "8990", "8700", "8999"])
const SUBTOTAL = new Set([CARD_SUBTOTAL_CODE, MEDI_SUBTOTAL_CODE, "8761", "8735", "8410", "8705"])

// ③표와 동일한 mapOrder / subMember 판정
const mapOrder = new Set(MAPPING_2025.map(m => m.ntsCode))
const label = new Map<string, string>()
for (const m of MAPPING_2025) if (!label.has(m.ntsCode)) label.set(m.ntsCode, `${m.group}/${m.label}`)
const subMembers = new Set<string>()
for (const m of MAPPING_2025) {
  const oc = m.outCode ?? (m.ytsCol?.startsWith("CARD_") ? CARD_SUBTOTAL_CODE : m.ytsCol?.startsWith("MEDI_") ? MEDI_SUBTOTAL_CODE : m.ntsCode)
  if (SUBTOTAL.has(oc) && oc !== m.ntsCode) subMembers.add(m.ntsCode)
}

interface Row { calcNo: string; result: { ntsOut?: Array<{ code: string; ddcAmt: number }>; ytsDdcMap?: Record<string, number> } | null }
const store = JSON.parse(fs.readFileSync(FILE, "utf8")) as { rows: Record<string, Row> }
const rows = Object.values(store.rows)
console.log(`\n════ ③표 신규 ✗ triage  [${YEAR}/nts${NTS_YEAR}]  인원 ${rows.length} ════`)

// code → { people, samples:[{calcNo, nts}] }
const hits = new Map<string, { people: number; samples: { calcNo: string; nts: number }[] }>()
let scanned = 0
for (const r of rows) {
  const res = r.result
  if (!res?.ntsOut) continue
  scanned++
  const ydm = res.ytsDdcMap ?? {}
  for (const o of res.ntsOut) {
    const c = o.code, nts = Number(o.ddcAmt ?? 0)
    if (nts <= 0) continue                                   // NTS nonzero 만
    if (!(mapOrder.has(c) || SUBTOTAL.has(c))) continue      // ③표 노출(매핑/소계)만
    if (COMPARE_CODES.has(c)) continue                       // ①결과비교 중복 제외
    if (subMembers.has(c)) continue                          // 소계 멤버는 oOut=undefined → 미대조
    if (ydm[c] !== undefined) continue                       // 신규 아님(0 포함 정의돼 있으면 기존에도 대조됨)
    const h = hits.get(c) ?? { people: 0, samples: [] }
    h.people++
    if (h.samples.length < 4) h.samples.push({ calcNo: r.calcNo, nts })
    hits.set(c, h)
  }
}

console.log(`분석 대상(result 있는 행): ${scanned}\n`)
if (!hits.size) { console.log("신규 ✗ 없음 — 이 변경으로 새로 뜨는 불일치 없음 ✓"); process.exit(0) }
const sorted = [...hits.entries()].sort((a, b) => b[1].people - a[1].people)
console.log("신규 ✗ 코드 (사람수 내림차순):")
for (const [code, h] of sorted) {
  const samp = h.samples.map(s => `${s.calcNo}(NTS ${s.nts.toLocaleString("ko-KR")})`).join("  ")
  const mark = GIFT_CODES.has(code) ? "✗실제표시" : "—스킵(대조점아님)"
  console.log(`  ${code}  ${(label.get(code) ?? "(소계/미매핑라벨)").padEnd(28)}  ${String(h.people).padStart(5)}명  ${mark.padEnd(16)} ${samp}`)
}
const surviving = sorted.filter(([c]) => GIFT_CODES.has(c))
console.log(`\n▶ 정정 후 실제 ✗ 표시되는 코드: ${surviving.length ? surviving.map(([c]) => c).join(", ") : "없음"}  (나머지는 대조점 아님 → 종전대로 —)`)
process.exit(0)
