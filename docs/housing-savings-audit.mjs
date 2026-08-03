/**
 * 주택마련저축(8403/8407/8404) 전수 대조 감사 — 배치결과 캐시에서 YTS공제 vs NTS공제 비교. 읽기 전용.
 *   각 캐시(run)의 ytsDdcMap[code] vs ntsMap[code]는 같은 시점 값이라 내부정합(NTS가 YTS 재현했는지)을 본다.
 * 사용법: node docs/housing-savings-audit.mjs
 */
import fs from "node:fs"
import path from "node:path"
const DIR = "data/hometax-batch-results"
const CODES = { "8403": "청약저축", "8407": "주택청약종합", "8404": "근로자주택마련" }
const fmt = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"))

const files = fs.readdirSync(DIR).filter(f => f.endsWith(".json"))
for (const file of files) {
  const store = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"))
  const rows = store.rows || {}
  const stat = {}
  for (const code of Object.keys(CODES)) stat[code] = { holders: 0, match: 0, mismatch: [] }
  for (const [calcNo, row] of Object.entries(rows)) {
    const r = row.result
    if (!r) continue
    const y = r.ytsDdcMap || {}, n = r.ntsMap || {}
    for (const code of Object.keys(CODES)) {
      const yv = Number(y[code] ?? 0), nv = Number(n[code] ?? 0)
      if (yv === 0 && nv === 0) continue          // 미보유
      stat[code].holders++
      if (yv === nv) stat[code].match++
      else stat[code].mismatch.push({ calcNo, yts: yv, nts: nv })
    }
  }
  console.log(`\n=== ${file} (rows ${Object.keys(rows).length}) ===`)
  for (const code of Object.keys(CODES)) {
    const s = stat[code]
    if (s.holders === 0) { console.log(`  ${code} ${CODES[code]}: 보유 0`); continue }
    console.log(`  ${code} ${CODES[code]}: 보유 ${s.holders}  일치 ${s.match}  불일치 ${s.mismatch.length}`)
    for (const m of s.mismatch.slice(0, 20)) console.log(`      ✗ ${m.calcNo}  YTS ${fmt(m.yts)}  NTS ${fmt(m.nts)}`)
  }
}
