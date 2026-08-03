/**
 * 복합유형(self + 소계멤버 / self + split) 전수 조사 — 배치결과 캐시 ntsMap 스캔. 읽기 전용.
 *   판별: 소계 그룹의 멤버코드가 NTS per-code ddcAmt(OUT)를 받으면 → 복합(self+멤버). 안 받으면 → 순수 멤버.
 */
import fs from "node:fs"
import path from "node:path"
const DIR = "data/hometax-batch-results"

// 소계 그룹 (소계코드 → 멤버들)
const GROUPS = {
  "8430 카드":      { sub: "8430", members: ["8431","8432","8433","8434","8435","8461","8462","8463"] },
  "8726 의료":      { sub: "8726", members: ["8720","8721","8725","8729"] },
  "8761 출산입양":  { sub: "8761", members: ["8764","8765","8766"] },
  "8735 교육":      { sub: "8735", members: ["8730","8731","8732","8733","8734"] },
  "8410 투자조합":  { sub: "8410", members: ["8415","8416","8417","8418","8419","8420","8421","8422","8423"] },
  "8705 ISA":       { sub: "8705", members: ["8707","8708"] },
  "8003 부양가족":  { sub: "8003", members: ["8004","8005","8006","8007","8008","8009"] },
}
// split 그룹 (송신코드 → NTS 생성코드)
const SPLIT = {
  "8740 정치자금": { send: "8740", generated: ["8741"] },
  "8783/84 고향":  { send: "8783", generated: ["8780","8781","8782","8784","8785","8786"] },
}

// 캐시 병합 (모든 파일의 rows)
const allRows = {}
for (const f of fs.readdirSync(DIR).filter(f => f.endsWith(".json"))) {
  const store = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"))
  for (const [cn, row] of Object.entries(store.rows || {})) if (row.result) allRows[`${f}:${cn}`] = row.result
}
const nz = v => Number(v ?? 0) !== 0

console.log(`총 결과행 ${Object.keys(allRows).length}\n`)
console.log("=== 소계 그룹: 멤버가 per-code OUT을 받나? ===")
for (const [name, g] of Object.entries(GROUPS)) {
  let subHolders = 0, memberPercodeHolders = 0
  const perCodeSeen = new Set()
  for (const r of Object.values(allRows)) {
    const n = r.ntsMap || {}
    const hasSub = nz(n[g.sub]), hasMember = g.members.some(m => nz(n[m]))
    if (!hasSub && !hasMember) continue
    subHolders++
    if (hasMember) { memberPercodeHolders++; g.members.forEach(m => { if (nz(n[m])) perCodeSeen.add(m) }) }
  }
  const kind = memberPercodeHolders > 0 ? "★복합(self+멤버)" : "순수멤버(·N:1)"
  console.log(`  ${name.padEnd(16)} 보유 ${String(subHolders).padStart(3)}  멤버per-code수신 ${String(memberPercodeHolders).padStart(3)}  → ${kind}`)
  if (perCodeSeen.size) console.log(`      per-code 관측: ${[...perCodeSeen].sort().join(", ")}`)
}

console.log("\n=== split 그룹: NTS가 생성코드를 회신하나? ===")
for (const [name, s] of Object.entries(SPLIT)) {
  let sendHolders = 0, genSeenHolders = 0
  const genSeen = new Set()
  for (const r of Object.values(allRows)) {
    const n = r.ntsMap || {}
    if (!nz(n[s.send]) && !s.generated.some(g => nz(n[g]))) continue
    sendHolders++
    if (s.generated.some(g => nz(n[g]))) { genSeenHolders++; s.generated.forEach(g => { if (nz(n[g])) genSeen.add(g) }) }
  }
  console.log(`  ${name.padEnd(16)} 보유 ${String(sendHolders).padStart(3)}  생성코드관측 ${String(genSeenHolders).padStart(3)}  ${genSeen.size ? "★split 확인: " + [...genSeen].sort().join(", ") : "생성코드 미관측"}`)
}
