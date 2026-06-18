import { NextRequest, NextResponse } from "next/server"
import {
  getHwpFile, getLatestHwpFile,
  getTaxRows, getJavaRows, getJavaEdits,
  getTaxSectConfig, getAllTaxSectConfigs,
  buildCompareRows, calcSummary,
  updateTaxItemsByCode, updateJavaCodeByLineNo,
  markJavaDeleted, insertJavaRows, resetJavaEdits,
} from "@/lib/tax-oracle"
import { auth } from "@/auth"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const userId    = parseInt(session.user?.id ?? "0")
  const record    = req.nextUrl.searchParams.get("record") ?? ""
  const yearParam = parseInt(req.nextUrl.searchParams.get("year") ?? "0")

  const hwp = yearParam
    ? await getHwpFile(yearParam, userId)
    : await getLatestHwpFile(userId)

  if (!hwp) {
    return NextResponse.json({
      rows: [], summary: { taxBytes: 0, javaBytes: 0, errors: 0 },
      year: null, sectConfig: null,
    })
  }

  // 단일 레코드 모드 (저장 후 새로고침용)
  if (record) {
    const [taxRows, javaRows, edits, sectConfig] = await Promise.all([
      getTaxRows(hwp.year, userId, record),
      getJavaRows(hwp.year, userId, record),
      getJavaEdits(hwp.year, userId, record),
      getTaxSectConfig(hwp.year, userId, record, "TAX"),
    ])
    const rows    = buildCompareRows(taxRows, javaRows, edits)
    const summary = calcSummary(rows)
    return NextResponse.json({ rows, summary, year: hwp.year, sectConfig })
  }

  // 전체 레코드 모드 — 4 쿼리로 전체 로드, Node에서 레코드별 분류
  const [allTaxRows, allJavaRows, allEdits, allSectConfigs] = await Promise.all([
    getTaxRows(hwp.year, userId),
    getJavaRows(hwp.year, userId),
    getJavaEdits(hwp.year, userId),
    getAllTaxSectConfigs(hwp.year, userId, "TAX"),
  ])

  // D/M 편집의 레코드 분류: lineNo → record
  const lineNoRec: Record<number, string> = {}
  for (const r of allJavaRows) if (r.lineNo) lineNoRec[r.lineNo] = r.record

  // 레코드별 그룹화
  const taxByRec:   Record<string, typeof allTaxRows>  = {}
  const javaByRec:  Record<string, typeof allJavaRows> = {}
  const editsByRec: Record<string, typeof allEdits>    = {}
  for (const r of allTaxRows)  { const k = r.코드[0]; if (k) (taxByRec[k]  = taxByRec[k]  || []).push(r) }
  for (const r of allJavaRows) {                              (javaByRec[r.record] = javaByRec[r.record] || []).push(r) }
  for (const e of allEdits) {
    const k = e.cmd === "I"
      ? e.record
      : (e.lineNo !== null ? lineNoRec[e.lineNo] ?? null : null)
    if (k) (editsByRec[k] = editsByRec[k] || []).push(e)
  }

  const byRecord: Record<string, { rows: ReturnType<typeof buildCompareRows>; sectConfig: typeof allSectConfigs[string] | null }> = {}
  const allRecs = new Set([...Object.keys(taxByRec), ...Object.keys(javaByRec)])
  for (const rec of allRecs) {
    const rows = buildCompareRows(taxByRec[rec] ?? [], javaByRec[rec] ?? [], editsByRec[rec] ?? [])
    if (rows.length > 0) byRecord[rec] = { rows, sectConfig: allSectConfigs[rec] ?? null }
  }

  return NextResponse.json({ byRecord, year: hwp.year })
}

// DELETE: 현재 레코드 편집 초기화 (MLAY_JAVA_EDIT 삭제)
export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const userId = parseInt(session.user?.id ?? "0")
  const record = req.nextUrl.searchParams.get("record") ?? ""
  const year   = parseInt(req.nextUrl.searchParams.get("year") ?? "0")

  if (!record || !year) return NextResponse.json({ message: "record, year 필수" }, { status: 400 })

  const deleted = await resetJavaEdits(year, userId, record)
  return NextResponse.json({ ok: true, deleted })
}

// PATCH: 서식항목(HWP) + makeStr(Java) 수정 저장
export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const userId = parseInt(session.user?.id ?? "0")
  const { year, taxItemUpdates, javaCodeUpdates, dUpdates, iInserts } = await req.json()

  if (!year) return NextResponse.json({ message: "연도를 입력하세요." }, { status: 400 })

  // MLAY_JAVA_EDIT에 쓰는 함수들은 EDIT_SEQ 충돌 방지를 위해 순차 실행
  if (taxItemUpdates?.length)  await updateTaxItemsByCode(year, userId, taxItemUpdates)
  if (javaCodeUpdates?.length) await updateJavaCodeByLineNo(year, userId, javaCodeUpdates)
  const dUpdated  = dUpdates?.length ? await markJavaDeleted(year, userId, dUpdates as { lineNo: number; bodyIter?: number | null }[]) : 0
  const iInserted = iInserts?.length ? await insertJavaRows(year, userId, iInserts as { editedRaw: string; record: string; afterLineNo: number; afterBodyIter?: number | null }[]) : 0

  return NextResponse.json({
    ok: true,
    taxUpdated:  taxItemUpdates?.length  ?? 0,
    javaUpdated: javaCodeUpdates?.length ?? 0,
    dUpdated:    dUpdated ?? 0,
    iInserted:   iInserted ?? 0,
  })
}
