import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { runCompareForCalcNo } from "@/features/hometax-calc/lib/runCompareForCalcNo"
import { upsertBatchResults } from "@/features/hometax-calc/lib/batchResultStore"

export const maxDuration = 120

const ATTR_YR = "2025"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증이 필요합니다." }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { calcNo?: string; mode?: string; ntsYear?: string; year?: string }
  const calcNo = (body.calcNo ?? "").trim()
  if (!calcNo) return Response.json({ error: "calc_no 를 입력하세요." }, { status: 400 })

  const mode    = body.mode ?? "compare"
  const ntsYear = (body.ntsYear ?? ATTR_YR).trim()                    // NTS L03 귀속연도
  const year    = (body.year ?? "").trim()                            // 우리자료 귀속연도 (복원 캐시 키)

  try {
    const startedAt = Date.now()
    const compare = await runCompareForCalcNo(calcNo, ntsYear)
    // 개별실행 결과도 복원 캐시에 upsert(그 한 건만) → 나갔다 와도 "마지막 실행" 유지. year 없으면 생략.
    if (year) {
      upsertBatchResults(year, ntsYear, [{
        calcNo, ok: true, result: compare, error: null,
        ranAt: new Date().toISOString(), duration: Date.now() - startedAt,
        inputHash: compare.inputHash,
      }])
    }
    return Response.json({ mode, ...compare })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: `실행 실패: ${msg}` }, { status: 500 })
  }
}
