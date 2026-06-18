import { NextRequest, NextResponse } from "next/server"
import { getHwpFile, getLatestHwpFile, getJavaSourceText, getJavaEdits } from "@/lib/tax-oracle"
import { auth } from "@/auth"
import type { JavaEditRow } from "@/lib/tax-oracle"

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

// 원본 소스에 D/I/M 편집 적용
function applyEdits(sourceText: string, edits: JavaEditRow[]): string {
  const srcLines = sourceText.split("\n")

  const dSet  = new Set(edits.filter(e => e.cmd === "D").map(e => e.lineNo!))
  const mMap  = new Map(edits.filter(e => e.cmd === "M").map(e => [e.lineNo!, e.javaCode ?? ""]))

  // I 삽입: prevLineNo(=삽입 기준 행) 별 그룹
  const iAfter = new Map<number, JavaEditRow[]>()
  for (const e of edits.filter(e => e.cmd === "I")) {
    const key = e.prevLineNo ?? 0
    if (!iAfter.has(key)) iAfter.set(key, [])
    iAfter.get(key)!.push(e)
  }

  const result: string[] = []

  // prevLineNo=0 → 파일 맨 앞 삽입
  for (const e of iAfter.get(0) ?? []) {
    if (e.javaCode) result.push(e.javaCode)
  }

  for (let i = 0; i < srcLines.length; i++) {
    const lineNo = i + 1

    if (dSet.has(lineNo)) continue   // D: 삭제

    let line = srcLines[i]

    const newMakeStr = mMap.get(lineNo)
    if (newMakeStr) {                // M: makeStr 교체
      line = replaceMakeStr(line, newMakeStr)
    }

    result.push(line)

    // I: 이 행 뒤에 삽입 (들여쓰기는 기준 행에 맞춤)
    const indent = line.match(/^(\s*)/)?.[1] ?? ""
    for (const e of iAfter.get(lineNo) ?? []) {
      if (e.javaCode) result.push(indent + e.javaCode)
    }
  }

  return result.join("\n")
}

// POST: 원본 소스에 편집 적용 후 반환
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

    const userId = parseInt(session.user?.id ?? "0")
    const body = await req.json()
    const yearParam = body?.year

    const hwp = yearParam
      ? await getHwpFile(yearParam, userId)
      : await getLatestHwpFile(userId)

    if (!hwp) return NextResponse.json({ message: "HWP 파일이 없습니다." }, { status: 400 })

    const [sourceText, allEdits] = await Promise.all([
      getJavaSourceText(hwp.year, userId),
      getJavaEdits(hwp.year, userId),
    ])

    if (!sourceText) return NextResponse.json({ message: "Java 소스가 없습니다. (JAVA_DATA 없음)" }, { status: 400 })
    if (typeof sourceText !== "string") return NextResponse.json({ message: `Java 소스 타입 오류: ${typeof sourceText}` }, { status: 500 })

    const patched     = applyEdits(sourceText, allEdits)
    const linesBefore = sourceText.split("\n").length
    const linesAfter  = patched.split("\n").length

    return NextResponse.json({
      code:        patched,
      editCount:   allEdits.length,
      linesBefore,
      linesAfter,
      year:        hwp.year,
    })
  } catch (err) {
    console.error("[patch-source] 오류:", err)
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "서버 오류" },
      { status: 500 }
    )
  }
}
