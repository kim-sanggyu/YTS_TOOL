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
  lineMap:   Map<number, string>,
  insertMap: Map<number, string>,
  unmappedDeleteLines: Set<number> = new Set(),
): string {
  const srcLines = sourceText.split("\n")

  const deleteLines = new Set<number>(unmappedDeleteLines)
  const replaceLines = new Map<number, string>()  // lineNo → finalLine
  const insertAfter  = new Map<number, string[]>()

  let lastLineNo = 0

  for (const row of rows) {
    if (!row.java) continue

    if (row.cmd === "D") {
      if (row.java.lineNo > 0) deleteLines.add(row.java.lineNo)
    } else if (row.cmd === "I") {
      // insertMap: buildAlignedOutput이 만든 정렬+주석 완성 라인 사용 → generate와 일치
      const formattedLine = insertMap.get(row.java.seq)
      if (!insertAfter.has(lastLineNo)) insertAfter.set(lastLineNo, [])
      insertAfter.get(lastLineNo)!.push(formattedLine ?? row.editedRaw ?? "")
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

    const allRows:  CompareRow[]        = []
    const lineMap   = new Map<number, string>()
    const insertMap = new Map<number, string>()
    const processedRecs = new Set<string>()

    for (const rec of RECORD_TYPES) {
      const rows = await buildCompareRowsFromMap(
        hwp.year, userId, rec,
        taxByRec[rec] ?? [], javaByRec[rec] ?? [], editsByRec[rec] ?? []
      )
      if (!rows) continue
      processedRecs.add(rec)
      allRows.push(...rows)

      // generate와 동일한 함수로 lineMap/insertMap 생성 → 완전 일치 보장
      const { lineMap: recMap, insertMap: recInsert } = buildAlignedOutput(rows)
      recMap.forEach((v, k) => lineMap.set(k, v))
      recInsert.forEach((v, k) => insertMap.set(k, v))
    }

    // MAP이 있는 레코드에서 generate에 포함되지 않은 원본 Java 행(LINE_NO>0)을 patch에서도 삭제
    // (unmapped 행 + MAP에 있어도 tax=null 등으로 generate에서 제외된 행 모두 커버)
    const unmappedDeleteLines = new Set<number>()
    for (const rec of processedRecs) {
      for (const j of javaByRec[rec] ?? []) {
        if (j.lineNo > 0 && !lineMap.has(j.lineNo)) unmappedDeleteLines.add(j.lineNo)
      }
    }

    const patched     = applyEdits(sourceText, allRows, lineMap, insertMap, unmappedDeleteLines)
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
