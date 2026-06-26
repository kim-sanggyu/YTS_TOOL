import { NextRequest, NextResponse } from "next/server"
import {
  getHwpFile, getLatestHwpFile, getJavaSourceText,
  getTaxRows, getJavaRows, getJavaCodeEdits, buildCompareRowsFromMap,
} from "@/lib/tax-oracle"
import { auth } from "@/auth"
import type { CompareRow } from "@/features/media-layout/types"
import { buildAlignedOutput } from "@/features/media-layout/lib/make-str-builder"

const RECORD_TYPES = ["A","B","C","D","E","F","G","H","I","K"]

// 원본 라인의 prefix(들여쓰기 등) 보존 + lineMap의 최종 라인으로 교체
function rebuildLine(originalLine: string, finalLine: string): string {
  const start = originalLine.indexOf("makeStr(")
  if (start === -1) return originalLine
  return originalLine.slice(0, start) + finalLine
}

function applyEdits(
  sourceText: string,
  rows: CompareRow[],
  lineMap: Map<number, string>
): string {
  const srcLines = sourceText.split("\n")

  const deleteLines = new Set<number>()
  const replaceLines = new Map<number, string>()  // lineNo → finalLine
  const insertAfter  = new Map<number, string[]>()

  let lastLineNo = 0

  for (const row of rows) {
    if (!row.java) continue

    if (row.cmd === "D") {
      if (row.java.lineNo > 0) deleteLines.add(row.java.lineNo)
    } else if (row.cmd === "I") {
      if (!insertAfter.has(lastLineNo)) insertAfter.set(lastLineNo, [])
      insertAfter.get(lastLineNo)!.push(row.editedRaw ?? "")
    } else if (row.java.lineNo > 0) {
      // lineMap은 buildAlignedOutput(=generate)이 만든 최종 라인 → 완전 일치 보장
      const finalLine = lineMap.get(row.java.lineNo)
      if (finalLine) replaceLines.set(row.java.lineNo, finalLine)
      lastLineNo = row.java.lineNo
    }
  }

  const result: string[] = []

  for (const content of insertAfter.get(0) ?? []) result.push(content)

  for (let i = 0; i < srcLines.length; i++) {
    const lineNo = i + 1
    if (deleteLines.has(lineNo)) continue

    let line = srcLines[i]
    const finalLine = replaceLines.get(lineNo)
    if (finalLine) line = rebuildLine(line, finalLine)
    result.push(line)

    const indent = line.match(/^(\s*)/)?.[1] ?? ""
    for (const content of insertAfter.get(lineNo) ?? []) result.push(indent + content)
  }

  return result.join("\n")
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

    const userId    = parseInt(session.user?.id ?? "0")
    const body      = await req.json()
    const yearParam = body?.year

    const hwp = yearParam
      ? await getHwpFile(yearParam, userId)
      : await getLatestHwpFile(userId)

    if (!hwp) return NextResponse.json({ message: "HWP 파일이 없습니다." }, { status: 400 })

    const [sourceText, allTaxRows, allJavaRows, allEdits] = await Promise.all([
      getJavaSourceText(hwp.year, userId),
      getTaxRows(hwp.year, userId),
      getJavaRows(hwp.year, userId),
      getJavaCodeEdits(hwp.year, userId),
    ])

    if (!sourceText) return NextResponse.json({ message: "Java 소스가 없습니다." }, { status: 400 })

    const taxByRec:   Record<string, typeof allTaxRows>  = {}
    const javaByRec:  Record<string, typeof allJavaRows> = {}
    const editsByRec: Record<string, typeof allEdits>    = {}
    const seqToRec:   Record<number, string>             = {}
    for (const r of allTaxRows)  { const k = r.코드[0]; if (k) (taxByRec[k]  = taxByRec[k]  || []).push(r) }
    for (const r of allJavaRows) { seqToRec[r.seq] = r.record; (javaByRec[r.record] = javaByRec[r.record] || []).push(r) }
    for (const e of allEdits)    { const k = seqToRec[e.seq]; if (k) (editsByRec[k] = editsByRec[k] || []).push(e) }

    const allRows: CompareRow[] = []
    const lineMap = new Map<number, string>()

    for (const rec of RECORD_TYPES) {
      const rows = await buildCompareRowsFromMap(
        hwp.year, userId, rec,
        taxByRec[rec] ?? [], javaByRec[rec] ?? [], editsByRec[rec] ?? []
      )
      if (!rows) continue
      allRows.push(...rows)

      // generate와 동일한 함수로 lineMap 생성 → 완전 일치 보장
      const { lineMap: recMap } = buildAlignedOutput(rows)
      recMap.forEach((v, k) => lineMap.set(k, v))
    }

    const patched     = applyEdits(sourceText, allRows, lineMap)
    const linesBefore = sourceText.split("\n").length
    const linesAfter  = patched.split("\n").length

    return NextResponse.json({ code: patched, editCount: allRows.length, linesBefore, linesAfter, year: hwp.year })
  } catch (err) {
    console.error("[patch-source] 오류:", err)
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "서버 오류" },
      { status: 500 }
    )
  }
}
