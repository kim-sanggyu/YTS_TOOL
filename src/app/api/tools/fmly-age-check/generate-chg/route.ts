import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { query, withConnection } from "@/lib/db/oracle"

interface DefectRow {
  CALC_NO: string
  FMLY_SEQ: number
  RES_NO: string
  FMLY_NM: string
  MAN_AGE: number
}

// RES_NO 앞 2자리(출생연도) +1 → 만나이 1 감소
function makeChgResNo(resNo: string): string {
  const yy        = parseInt(resNo.substring(0, 2), 10)
  const mmdd      = resNo.substring(2, 6)
  const genderCode = resNo.substring(6, 7)
  const rest      = resNo.substring(7)

  let newYY   = yy + 1
  let newCode = genderCode

  // 1999(YY=99) → 2000(YY=00): 세기 코드 1→3, 2→4
  if (newYY === 100) {
    newYY = 0
    if (genderCode === "1") newCode = "3"
    else if (genderCode === "2") newCode = "4"
  }

  return String(newYY).padStart(2, "0") + mmdd + newCode + rest
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { year } = (await req.json()) as { year: string }

  if (!/^\d{4}$/.test(year))
    return NextResponse.json({ error: "연도는 4자리 숫자로 입력하세요." }, { status: 400 })

  const rows = await query<DefectRow>(
    "ytts",
    `SELECT CALC_NO, FMLY_SEQ, RES_NO, FMLY_NM, MAN_AGE
     FROM CALC_FMLY_AGE_DEFECT
     WHERE YY = :1`,
    [year]
  )

  if (rows.length === 0) return NextResponse.json({ updated: 0 })

  // 동일 나이(MAN_AGE)끼리는 동일한 변환 로직 적용 — RES_NO 기반으로 자연스럽게 처리
  let updated = 0
  await withConnection("ytts", async (conn) => {
    const binds = rows.map((r) => {
      const chgResNo = makeChgResNo(r.RES_NO)
      return {
        CHG_RES_NO:  chgResNo,
        CHG_FMLY_NM: r.FMLY_NM,
        CALC_NO:     r.CALC_NO,
        FMLY_SEQ:    r.FMLY_SEQ,
      }
    })

    const result = await conn.executeMany(
      `UPDATE CALC_FMLY_AGE_DEFECT
       SET CHG_RES_NO = :CHG_RES_NO, CHG_FMLY_NM = :CHG_FMLY_NM, UPT_DT = SYSDATE
       WHERE CALC_NO = :CALC_NO AND FMLY_SEQ = :FMLY_SEQ`,
      binds
    )
    updated = result.rowsAffected ?? rows.length
  })

  return NextResponse.json({ updated })
}
