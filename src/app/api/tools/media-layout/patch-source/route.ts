import { NextRequest, NextResponse } from "next/server"
import {
  getHwpFile, getLatestHwpFile, getJavaSourceText,
  getTaxRows, getJavaRows, getJavaCodeEdits, buildCompareRowsFromMap,
} from "@/lib/tax-oracle"
import { auth } from "@/auth"
import type { CompareRow } from "@/features/media-layout/types"

const RECORD_TYPES = ["A","B","C","D","E","F","G","H","I","K"]

// makeStr(...) 표현식을 찾아 새 표현식으로 교체 (들여쓰기·후행 문자 보존)
function replaceMakeStr(line: string, newExpr: string): string {
  const start = line.indexOf("makeStr(")
  if (start === -1) return line
  let depth = 0, end = start
  for (let i = start; i < line.length; i++) {
    if (line[i] === "(") depth++
    else if (line[i] === ")") { depth--; if (depth === 0) { end = i + 1; break } }
  }
  return line.slice(0, start) + newExpr + line.slice(end)
}

// 비교 행(CompareRow[])으로부터 원본 소스에 D/I/M 편집 적용
function applyEdits(sourceText: string, rows: CompareRow[]): string {
  const srcLines = sourceText.split("\n")

  const deleteLines  = new Set<number>()
  const replaceLines = new Map<number, string>()   // lineNo → newMakeStr
  const insertAfter  = new Map<number, string[]>() // afterLineNo → contents

  let lastLineNo = 0

  for (const row of rows) {
    if (!row.java) continue

    if (row.cmd === "D") {
      if (row.java.lineNo > 0) deleteLines.add(row.java.lineNo)
    } else if (row.cmd === "I") {
      // LINE_NO=0 삽입 행: 직전 Java 원본 행 뒤에 삽입
      if (!insertAfter.has(lastLineNo)) insertAfter.set(lastLineNo, [])
      insertAfter.get(lastLineNo)!.push(row.editedRaw ?? "")
    } else if (row.java.lineNo > 0) {
      if (row.editedRaw && row.editedRaw !== row.java.raw) {
        replaceLines.set(row.java.lineNo, row.editedRaw)
      }
      lastLineNo = row.java.lineNo
    }
  }

  const result: string[] = []

  for (const content of insertAfter.get(0) ?? []) {
    result.push(content)
  }

  for (let i = 0; i < srcLines.length; i++) {
    const lineNo = i + 1
    if (deleteLines.has(lineNo)) continue

    let line = srcLines[i]
    const newMakeStr = replaceLines.get(lineNo)
    if (newMakeStr) line = replaceMakeStr(line, newMakeStr)
    result.push(line)

    const indent = line.match(/^(\s*)/)?.[1] ?? ""
    for (const content of insertAfter.get(lineNo) ?? []) {
      result.push(indent + content)
    }
  }

  return result.join("\n")
}

// POST: 원본 소스에 편집 적용 후 반환
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

    // 레코드별 그룹화
    const taxByRec:  Record<string, typeof allTaxRows>  = {}
    const javaByRec: Record<string, typeof allJavaRows> = {}
    const editsByRec: Record<string, typeof allEdits>   = {}
    const seqToRec: Record<number, string> = {}
    for (const r of allTaxRows)  { const k = r.코드[0]; if (k) (taxByRec[k]  = taxByRec[k]  || []).push(r) }
    for (const r of allJavaRows) { seqToRec[r.seq] = r.record; (javaByRec[r.record] = javaByRec[r.record] || []).push(r) }
    for (const e of allEdits)    { const k = seqToRec[e.seq]; if (k) (editsByRec[k] = editsByRec[k] || []).push(e) }

    // 전체 레코드 비교 행 수집
    const allRows: CompareRow[] = []
    for (const rec of RECORD_TYPES) {
      const rows = await buildCompareRowsFromMap(
        hwp.year, userId, rec,
        taxByRec[rec] ?? [], javaByRec[rec] ?? [], editsByRec[rec] ?? []
      )
      if (rows) allRows.push(...rows)
    }

    const patched     = applyEdits(sourceText, allRows)
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
