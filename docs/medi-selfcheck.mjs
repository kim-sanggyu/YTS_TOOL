/**
 * 의료비 self 여부 점검 — 캐시에서 의료 보유자의 8720/8721/8725/8726 ntsMap + (있으면)ntsOut 필드 덤프. 읽기 전용.
 *   질문: 8726 소계 = Σ(8720,8721,8725) per-code 인가? per-code ddcAmt가 실제 공제인가 중간값인가?
 */
import fs from "node:fs"
import path from "node:path"
const DIR = "data/hometax-batch-results"
const MEDI = ["8720","8721","8725","8729","8726"]
const fmt = n => (n == null ? "—" : Number(n).toLocaleString("ko-KR"))

// 의료 보유자 3명 뽑아 상세
let shown = 0
for (const f of fs.readdirSync(DIR).filter(f => f.endsWith(".json"))) {
  const store = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"))
  for (const [cn, row] of Object.entries(store.rows || {})) {
    const r = row.result; if (!r) continue
    const n = r.ntsMap || {}
    const hasPer = ["8720","8721","8725"].some(c => Number(n[c] ?? 0) !== 0)
    if (!hasPer) continue
    console.log(`\n[${f}:${cn}]`)
    console.log(`  ntsMap:   ${MEDI.map(c => `${c}=${fmt(n[c])}`).join("  ")}`)
    const perSum = ["8720","8721","8725","8729"].reduce((s,c)=>s+Number(n[c]??0),0)
    console.log(`  Σ개별(8720,21,25,29)=${fmt(perSum)}  vs  소계8726=${fmt(n["8726"])}  →  ${perSum===Number(n["8726"]??0)?"일치(per-code가 소계 구성)":"불일치"}`)
    console.log(`  ytsDdcMap: ${MEDI.map(c => `${c}=${fmt((r.ytsDdcMap||{})[c])}`).join("  ")}`)
    // ntsOut(전체 필드)가 있으면 8720/8726의 useAmt/ddcTrgtAmt/ddcLmtAmt/ddcAmt 표시
    const out = r.ntsOut || []
    if (out.length) {
      for (const code of ["8720","8721","8725","8726"]) {
        const it = out.find(o => String(o.code ?? o.amtClusCd) === code)
        if (it) console.log(`    OUT ${code}: useAmt=${fmt(it.useAmt)} 대상=${fmt(it.ddcTrgtAmt)} 한도=${fmt(it.ddcLmtAmt)} 공제=${fmt(it.ddcAmt)}`)
      }
    } else console.log(`    (ntsOut 미저장 — 슬림 캐시)`)
    if (++shown >= 3) process.exit(0)
  }
}
