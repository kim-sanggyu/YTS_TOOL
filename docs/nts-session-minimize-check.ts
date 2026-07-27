/**
 * 세션 창 최소화 검증 — 최소화 상태에서도 세션 수립(클릭 네비)+L03 이 되는지 확인.
 * 실행: npx --yes tsx --env-file=.env.local docs/nts-session-minimize-check.ts
 * 창이 작업표시줄에만(최소화) 뜨고 아래 L03 응답이 찍히면 OK.
 */
import { runHometaxCompare, stopNtsSession, getNtsSessionInfo } from "@/features/hometax-calc/lib/runHometaxCalc"

async function main() {
  console.log("세션 수립 시작 — 창이 최소화(작업표시줄)로 뜨는지 확인하세요...")
  const r = await runHometaxCompare({ TOT_PAY_AMT: 50000000 }, "2025")
  console.log("L03 응답 OK. 결정세액(8999) =", r.ntsMap?.["8999"] ?? "?", " / 세션:", getNtsSessionInfo())
  console.log("10초 대기 — 최소화 상태·클릭 복원 여부 눈으로 확인")
  await new Promise(res => setTimeout(res, 10000))
  stopNtsSession()
  process.exit(0)
}
main().catch(e => { console.error("FAILED:", e); stopNtsSession(); process.exit(1) })
