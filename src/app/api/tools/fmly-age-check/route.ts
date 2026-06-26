import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { query, execute } from "@/lib/db/oracle"

export interface FmlyAgeRow {
  CALC_NO: string
  YY: string
  NM: string
  EMP_NO: string
  KEEP_PS: string
  FMLY_SEQ: number
  FMLY_NM: string
  FMLY_RELN: string
  FMLY_RELN_NM: string
  RES_NO: string
  MAN_AGE: number
  BAS_SUB_YN: string
  OB_TRE_YN: string
  CHILD_YN: string
  MORE_STD_INCM_YN: string
  HDC_PERS_YN: string
  DEFECT_REASON: string
  CHG_RES_NO: string
  CHG_FMLY_NM: string
  STATUS: string
  INS_DT: string
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const year = searchParams.get("year") ?? ""

  if (!/^\d{4}$/.test(year))
    return NextResponse.json({ error: "연도는 4자리 숫자로 입력하세요." }, { status: 400 })

  const sql = `
    SELECT
      CALC_NO, YY, NM, EMP_NO, KEEP_PS,
      FMLY_SEQ, FMLY_NM, FMLY_RELN, FMLY_RELN_NM,
      RES_NO, MAN_AGE, BAS_SUB_YN,
      OB_TRE_YN, CHILD_YN, MORE_STD_INCM_YN, HDC_PERS_YN,
      DEFECT_REASON, CHG_RES_NO, CHG_FMLY_NM, STATUS,
      TO_CHAR(INS_DT, 'YYYY-MM-DD HH24:MI') AS INS_DT
    FROM CALC_FMLY_AGE_DEFECT
    WHERE YY = :year
    ORDER BY MAN_AGE, CALC_NO, FMLY_SEQ
  `

  const rows = await query<FmlyAgeRow>("ytts", sql, [year])
  return NextResponse.json(rows)
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const year = searchParams.get("year") ?? ""

  if (!/^\d{4}$/.test(year))
    return NextResponse.json({ error: "연도는 4자리 숫자로 입력하세요." }, { status: 400 })

  const { rowsAffected } = await execute("ytts", `DELETE FROM CALC_FMLY_AGE_DEFECT WHERE YY = :1`, [year])
  return NextResponse.json({ deleted: rowsAffected })
}
