import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { ytsDb } from "@/lib/db/oracle"
import { runHometaxCalc } from "@/features/hometax-calc/lib/runHometaxCalc"
import { runCompareForCalcNo } from "@/features/hometax-calc/lib/runCompareForCalcNo"

export const maxDuration = 120

const ATTR_YR = "2025"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증이 필요합니다." }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { calcNo?: string; mode?: string; ntsYear?: string }
  const calcNo = (body.calcNo ?? "").trim()
  if (!calcNo) return Response.json({ error: "calc_no 를 입력하세요." }, { status: 400 })

  const mode    = body.mode ?? "compare"                               // "compare" | "simple"
  const ntsYear = (body.ntsYear ?? ATTR_YR).trim()                    // NTS L03 귀속연도

  try {
    if (mode === "simple") {
      // 기존 방식: 총급여+기납부만 전송
      const [row] = await ytsDb.query<{ TOT_PAY_AMT: number; PAYM_INCM_TAX: number }>(
        `SELECT TOT_PAY_AMT, PAYM_INCM_TAX FROM YTS39.PAY_WRK_CALC WHERE CALC_NO = :1`, [calcNo]
      )
      if (!row) return Response.json({ error: `${calcNo} 를 찾을 수 없습니다.` }, { status: 404 })
      const result = await runHometaxCalc({ totalPay: Number(row.TOT_PAY_AMT), prepaidTax: Number(row.PAYM_INCM_TAX) })
      return Response.json({ calcNo, mode, result })
    }

    const compare = await runCompareForCalcNo(calcNo, ntsYear)
    return Response.json({ mode, ...compare })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: `실행 실패: ${msg}` }, { status: 500 })
  }
}
