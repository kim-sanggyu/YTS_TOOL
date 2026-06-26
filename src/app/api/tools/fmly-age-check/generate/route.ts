import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { ytsDb, withConnection } from "@/lib/db/oracle"

interface SourceRow {
  CALC_NO: string
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
  NM: string
  EMP_NO: string
  KEEP_PS: string
}

interface ChgCandidate {
  CALC_NO: string
  RES_NO: string
  NM: string
}

// 컬럼명을 인자로 받아 만나이 계산용 CASE 식 반환
function birthYearExpr(col: string) {
  return `CASE SUBSTR(${col}, 7, 1)
    WHEN '1' THEN 1900 + TO_NUMBER(SUBSTR(${col}, 1, 2))
    WHEN '2' THEN 1900 + TO_NUMBER(SUBSTR(${col}, 1, 2))
    WHEN '3' THEN 2000 + TO_NUMBER(SUBSTR(${col}, 1, 2))
    WHEN '4' THEN 2000 + TO_NUMBER(SUBSTR(${col}, 1, 2))
    ELSE           1900 + TO_NUMBER(SUBSTR(${col}, 1, 2))
  END`
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  try {
    const { year } = (await req.json()) as { year: string }

    if (!/^\d{4}$/.test(year))
      return NextResponse.json({ error: "연도는 4자리 숫자로 입력하세요." }, { status: 400 })

    const toYear = Number(year) + 1

    // 경계나이 해당자 조회 (ytsDb) — f. 별칭으로 RES_NO 명확히 지정
    const rows = await ytsDb.query<SourceRow>(`
      WITH BASE AS (
        SELECT
          f.CALC_NO, f.FMLY_SEQ, f.RES_NO, f.NM AS FMLY_NM,
          f.FMLY_RELN, c.COMM_NM AS FMLY_RELN_NM, f.BAS_SUB_YN,
          f.OB_TRE_YN, f.CHILD_YN, f.MORE_STD_INCM_YN, f.HDC_PERS_YN,
          m.NM, w.EMP_NO, w.KEEP_PS,
          :1 - ${birthYearExpr("f.RES_NO")} AS MAN_AGE
        FROM PAY_WRK_FMLY f
        JOIN PAY_WRK_FMLY m ON m.CALC_NO = f.CALC_NO AND m.FMLY_SEQ = 1
        JOIN PAY_WRK_MAIN w ON w.CALC_NO = f.CALC_NO
        LEFT JOIN YTS_CODE_MGT c ON c.COMM_CD = f.FMLY_RELN
        WHERE f.CALC_NO LIKE '%Y' || :2 || '%'
          AND f.FMLY_SEQ <> 1
      )
      SELECT CALC_NO, FMLY_SEQ, RES_NO, FMLY_NM, FMLY_RELN, FMLY_RELN_NM, BAS_SUB_YN,
             OB_TRE_YN, CHILD_YN, MORE_STD_INCM_YN, HDC_PERS_YN,
             NM, EMP_NO, KEEP_PS, MAN_AGE
      FROM BASE WHERE MAN_AGE IN (7, 20, 59, 69)
    `, [toYear, year])

    // 나이별 경계 행의 CALC_NO 집합
    const ageCalcNos = new Map<number, Set<string>>()
    for (const r of rows) {
      if (!ageCalcNos.has(r.MAN_AGE)) ageCalcNos.set(r.MAN_AGE, new Set())
      ageCalcNos.get(r.MAN_AGE)!.add(r.CALC_NO)
    }

    // 나이별 대체자 조회: 동일 나이면 동일 대체 데이터 사용
    const chgMap = new Map<number, { chgResNo: string; chgFmlyNm: string }>()

    for (const [manAge, excludeCalcNos] of ageCalcNos) {
      const targetAge = manAge - 1

      const candidates = await ytsDb.query<ChgCandidate>(`
        SELECT CALC_NO, RES_NO, NM FROM (
          SELECT CALC_NO, RES_NO, NM
          FROM PAY_WRK_FMLY
          WHERE CALC_NO LIKE '%Y' || :1 || '%'
            AND FMLY_SEQ <> 1
            AND :2 - ${birthYearExpr("RES_NO")} = :3
        ) WHERE ROWNUM <= 100
      `, [year, toYear, targetAge])

      const subst = candidates.find(c => !excludeCalcNos.has(c.CALC_NO))
      if (subst) {
        chgMap.set(manAge, { chgResNo: subst.RES_NO, chgFmlyNm: subst.NM })
      }
    }

    let inserted = 0
    await withConnection("ytts", async (conn) => {
      await conn.execute(`DELETE FROM CALC_FMLY_AGE_DEFECT WHERE YY = :1`, [year])

      if (rows.length === 0) return

      const insertSql = `
        INSERT INTO CALC_FMLY_AGE_DEFECT (
          CALC_NO, YY, NM, EMP_NO, KEEP_PS,
          FMLY_SEQ, FMLY_NM, FMLY_RELN, FMLY_RELN_NM,
          RES_NO, MAN_AGE, BAS_SUB_YN,
          OB_TRE_YN, CHILD_YN, MORE_STD_INCM_YN, HDC_PERS_YN,
          CHG_RES_NO, CHG_FMLY_NM,
          DEFECT_REASON, STATUS
        ) VALUES (
          :CALC_NO, :YY, :NM, :EMP_NO, :KEEP_PS,
          :FMLY_SEQ, :FMLY_NM, :FMLY_RELN, :FMLY_RELN_NM,
          :RES_NO, :MAN_AGE, :BAS_SUB_YN,
          :OB_TRE_YN, :CHILD_YN, :MORE_STD_INCM_YN, :HDC_PERS_YN,
          :CHG_RES_NO, :CHG_FMLY_NM,
          :DEFECT_REASON, 'N'
        )
      `

      const binds = rows.map((r) => {
        const chg = chgMap.get(r.MAN_AGE)
        return {
          CALC_NO:          r.CALC_NO,
          YY:               year,
          NM:               r.NM,
          EMP_NO:           r.EMP_NO,
          KEEP_PS:          r.KEEP_PS,
          FMLY_SEQ:         r.FMLY_SEQ,
          FMLY_NM:          r.FMLY_NM,
          FMLY_RELN:        r.FMLY_RELN,
          FMLY_RELN_NM:     r.FMLY_RELN_NM ?? r.FMLY_RELN,
          RES_NO:           r.RES_NO,
          MAN_AGE:          r.MAN_AGE,
          BAS_SUB_YN:       r.BAS_SUB_YN,
          OB_TRE_YN:        r.OB_TRE_YN,
          CHILD_YN:         r.CHILD_YN,
          MORE_STD_INCM_YN: r.MORE_STD_INCM_YN,
          HDC_PERS_YN:      r.HDC_PERS_YN,
          CHG_RES_NO:       chg?.chgResNo ?? "",
          CHG_FMLY_NM:      chg?.chgFmlyNm ?? "",
          DEFECT_REASON:    `만${r.MAN_AGE}세 (${r.BAS_SUB_YN === "Y" ? "기본공제대상" : "비대상"})`,
        }
      })

      const result = await conn.executeMany(insertSql, binds)
      inserted = result.rowsAffected ?? rows.length
    })

    return NextResponse.json({ inserted })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
