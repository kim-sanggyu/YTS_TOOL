import { NextRequest, NextResponse } from "next/server"
import {
  getHwpFile, getLatestHwpFile,
  getTaxRows, getJavaRows, getJavaCodeEdits,
  getTaxSectConfig, getAllTaxSectConfigs,
  buildCompareRowsFromMap, calcSummary,
  upsertTaxEdit, updateJavaCode, deleteJavaCodeEdits,
  saveMap, resetJavaEdits, initMapForRecord,
  type MapSaveRow,
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
      getJavaCodeEdits(hwp.year, userId, record),
      getTaxSectConfig(hwp.year, userId, record, "TAX"),
    ])
    const rows = await buildCompareRowsFromMap(hwp.year, userId, record, taxRows, javaRows, edits) ?? []
    const summary = calcSummary(rows)
    return NextResponse.json({ rows, summary, year: hwp.year, sectConfig })
  }

  // 전체 레코드 모드
  const [allTaxRows, allJavaRows, allEdits, allSectConfigs] = await Promise.all([
    getTaxRows(hwp.year, userId),
    getJavaRows(hwp.year, userId),
    getJavaCodeEdits(hwp.year, userId),
    getAllTaxSectConfigs(hwp.year, userId, "TAX"),
  ])

  // 레코드별 그룹화 (SEQ 기반 — lineNo 불필요)
  const taxByRec:  Record<string, typeof allTaxRows>  = {}
  const javaByRec: Record<string, typeof allJavaRows> = {}
  const editsByRec: Record<string, typeof allEdits>   = {}
  const seqToRec: Record<number, string> = {}
  for (const r of allTaxRows)  { const k = r.코드[0]; if (k) (taxByRec[k]  = taxByRec[k]  || []).push(r) }
  for (const r of allJavaRows) { seqToRec[r.seq] = r.record;  (javaByRec[r.record] = javaByRec[r.record] || []).push(r) }
  for (const e of allEdits)    { const k = seqToRec[e.seq]; if (k) (editsByRec[k] = editsByRec[k] || []).push(e) }

  const allRecs = new Set([...Object.keys(taxByRec), ...Object.keys(javaByRec)])
  const byRecord: Record<string, { rows: import("@/features/media-layout/types").CompareRow[]; sectConfig: typeof allSectConfigs[string] | null }> = {}

  await Promise.all(Array.from(allRecs).map(async (rec) => {
    const rows = await buildCompareRowsFromMap(
      hwp.year, userId, rec,
      taxByRec[rec] ?? [], javaByRec[rec] ?? [], editsByRec[rec] ?? []
    ) ?? []
    if (rows.length > 0) byRecord[rec] = { rows, sectConfig: allSectConfigs[rec] ?? null }
  }))

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
  await initMapForRecord(year, userId, record)
  return NextResponse.json({ ok: true, deleted })
}

// PATCH: 서식항목(HWP) + makeStr(Java) 수정 저장
export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const userId = parseInt(session.user?.id ?? "0")
  const { year, taxItemUpdates, javaCodeUpdates, javaCodeResets, mapRows } = await req.json()

  if (!year) return NextResponse.json({ message: "연도를 입력하세요." }, { status: 400 })

  try {
    if (taxItemUpdates?.length)  await upsertTaxEdit(year, userId, taxItemUpdates)
    if (javaCodeResets?.length)  await deleteJavaCodeEdits(year, userId, javaCodeResets)
    if (javaCodeUpdates?.length) await updateJavaCode(year, userId, javaCodeUpdates)

    let mapSaved = 0
    if (mapRows?.length) {
      const rows   = mapRows as MapSaveRow[]
      const record = rows.find(r => r.recordType)?.recordType ?? ""
      if (record) mapSaved = await saveMap(year, userId, record, rows)
    }

    return NextResponse.json({
      ok: true,
      taxUpdated:  taxItemUpdates?.length  ?? 0,
      javaUpdated: javaCodeUpdates?.length ?? 0,
      mapSaved,
    })
  } catch (err) {
    console.error("[compare PATCH]", err)
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "저장 중 오류가 발생했습니다." },
      { status: 500 }
    )
  }
}
