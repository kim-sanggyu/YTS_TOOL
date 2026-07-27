/**
 * 고향사랑 8784 "지출 0인데 왜 1원?" A/B 프로브 (일회성, 읽기 전용).
 *   (A) 평소대로 8784=0 포함 전송   (B) 8784 를 payload 에서 아예 드롭
 * A 가 화면값(8783=55,295 · 8784=1)을 재현하면 payload 충실 → B 에서 1원이
 * 사라지면 "우리가 8784=0 을 보내서 생긴 것", 남으면 "국세청 내부 배분".
 *
 * 실행: npx --yes tsx docs/gift-8784-ab-probe.ts   (DB 환경변수는 아래 셸에서 주입)
 */
import { buildCompareInput } from "@/features/hometax-calc/lib/runCompareForCalcNo"
import { runHometaxCompare, stopNtsSession } from "@/features/hometax-calc/lib/runHometaxCalc"

const CALC_NO = process.argv[2] ?? "Y202500521"
const NTS_YEAR = "2025"
const CODES = ["8783", "8784"] as const

async function main() {
  console.log(`\n════ 고향사랑 8784 A/B  [${CALC_NO}] ════`)
  const { vals } = await buildCompareInput(CALC_NO, NTS_YEAR)
  console.log(`IN vals: GIFT_8783=${vals.GIFT_8783 ?? 0}  GIFT_8784=${vals.GIFT_8784 ?? 0}  총급여=${vals.TOT_PAY_AMT ?? 0}`)

  const A = await runHometaxCompare(vals, NTS_YEAR)                          // 8784=0 포함
  const B = await runHometaxCompare(vals, NTS_YEAR, { omitCodes: ["8784"] }) // 8784 드롭

  const row = (label: string, r: { ntsMap: Record<string, number> }) =>
    `${label}  ` + CODES.map(c => `${c}=${r.ntsMap[c] ?? "없음"}`).join("  ") +
    `  | 결정세액(8916)=${r.ntsMap["8916"] ?? "?"}`

  console.log("\n── OUT (국세청 회신 ddcAmt) ──")
  console.log(row("(A) 8784=0 포함:", A))
  console.log(row("(B) 8784 드롭  :", B))

  const a84 = A.ntsMap["8784"] ?? 0, b84 = B.ntsMap["8784"] ?? 0
  console.log("\n── 판정 ──")
  console.log(`  A 8784 = ${a84}, B 8784 = ${b84}`)
  if (a84 === 1 && b84 === 0) console.log("  ▶ 우리가 8784=0 을 보내서 1원 발생 (드롭하면 사라짐) → 우리 전송이 원인")
  else if (a84 === 1 && b84 === 1) console.log("  ▶ 8784 안 보내도 1원 유지 → 국세청 내부 배분이 원인")
  else console.log("  ▶ 예상 밖 패턴 — A 가 화면(8784=1)을 재현했는지부터 확인")

  stopNtsSession()
  process.exit(0)
}
main().catch(e => { console.error("FAILED:", e); stopNtsSession(); process.exit(1) })
