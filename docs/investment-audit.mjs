/**
 * 투자조합출자(8415~8423 + 소계 8410) 대조 감사 — 배치결과 캐시. 읽기 전용.
 *   ① 소계: ytsDdcMap[8410](OTO_IU_ETC) vs ntsMap[8410]
 *   ② NTS 내부정합: Σ개별(8415~8423) ntsMap === ntsMap[8410]?
 *   ③ per-code ntsMap 구조 표시(투자조합 탭 대조는 SUB_AMT라 DB 병행 필요)
 */
import fs from "node:fs"
import path from "node:path"
const DIR = "data/hometax-batch-results"
const CODES = ["8416","8418","8420","8415","8417","8419","8421","8422","8423"]  // 벤처/조합1/조합2 × 3연도
const fmt = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"))

for (const file of fs.readdirSync(DIR).filter(f => f.endsWith(".json"))) {
  const store = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"))
  const rows = store.rows || {}
  const holders = []
  for (const [calcNo, row] of Object.entries(rows)) {
    const r = row.result; if (!r) continue
    const n = r.ntsMap || {}, y = r.ytsDdcMap || {}
    const perSum = CODES.reduce((s, c) => s + Number(n[c] ?? 0), 0)
    const sub8410nts = Number(n["8410"] ?? 0), sub8410yts = Number(y["8410"] ?? 0)
    if (perSum === 0 && sub8410nts === 0 && sub8410yts === 0) continue
    holders.push({ calcNo, y8410: sub8410yts, n8410: sub8410nts, perSum, per: CODES.filter(c => Number(n[c] ?? 0) !== 0).map(c => `${c}=${fmt(n[c])}`) })
  }
  console.log(`\n=== ${file} (rows ${Object.keys(rows).length}) — 투자조합 보유 ${holders.length} ===`)
  for (const h of holders) {
    const subOk = h.y8410 === h.n8410 ? "✓" : "✗"
    const intOk = h.perSum === h.n8410 ? "✓" : "✗"
    console.log(`  ${h.calcNo}  소계 YTS ${fmt(h.y8410)} vs NTS ${fmt(h.n8410)} ${subOk}  | Σ개별 ${fmt(h.perSum)} vs 소계NTS ${fmt(h.n8410)} ${intOk}`)
    console.log(`      개별: ${h.per.join("  ") || "—"}`)
  }
}
