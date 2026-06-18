import { NextRequest, NextResponse } from "next/server"
import {
  getHwpFile, getLatestHwpFile, getTaxRows, getJavaRows, getJavaEdits,
  buildCompareRows,
} from "@/lib/tax-oracle"
import { auth } from "@/auth"

// 섹션 배열의 모든 makeStr 라인을 일괄 정렬
// 포맷: makeStr("X", len, arg); // comment
function alignSections(sections: { sect: string; label: string; lines: string[] }[]): void {
  const norm = (s: string) => s.replace(/\s+\)/g, ")")

  type Parsed = { dtype: string; len: string; arg: string; comment: string } | null
  function parseLine(line: string): Parsed {
    const plusComment = line.indexOf(" + //")
    if (plusComment === -1) return null
    const raw = line.slice(0, plusComment).trim()
    const comment = line.slice(plusComment)   // " + // ..." 부분
    const m = /^makeStr\s*\(\s*"([xX9])"\s*,\s*(\d+)\s*,\s*([\s\S]+)\)\s*$/.exec(raw)
    if (!m) return null
    return {
      dtype:   /[xX]/.test(m[1]) ? "X" : "9",
      len:     m[2],
      arg:     norm(m[3].trimEnd()),
      comment,
    }
  }

  // 전체 makeStr 라인 파싱 → maxLen, maxArg 계산
  const allParsed = sections.flatMap(s => s.lines).map(parseLine)
  const maxLen = Math.max(...allParsed.map(p => p?.len.length ?? 0), 1)
  const maxArg = Math.max(...allParsed.map(p => p?.arg.length ?? 0), 1)

  // 각 섹션의 라인 재포맷
  let idx = 0
  for (const s of sections) {
    s.lines = s.lines.map(line => {
      const p = allParsed[idx++]
      if (!p) return line
      return `makeStr("${p.dtype}", ${p.len.padStart(maxLen)}, ${p.arg.padEnd(maxArg)})${p.comment}`
    })
  }
}

function sectLabel(sect: string): string {
  if (sect === "header")   return "Header"
  if (sect === "footer")   return "Footer"
  if (sect === "body_sum") return "Body 합산"
  const m = sect.match(/^body_(\d+)$/)
  return m ? `Body-${m[1]}` : sect
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const userId = parseInt(session.user?.id ?? "0")
  const { record, year: yearParam } = await req.json()

  const hwp = yearParam
    ? await getHwpFile(yearParam, userId)
    : await getLatestHwpFile(userId)
  if (!hwp) {
    return NextResponse.json(
      { message: "업로드된 데이터가 없습니다. 먼저 HWP 파일을 업로드하세요." },
      { status: 400 }
    )
  }

  const [taxRows, javaRows, edits] = await Promise.all([
    getTaxRows(hwp.year, userId, record),
    getJavaRows(hwp.year, userId, record),
    getJavaEdits(hwp.year, userId, record),
  ])

  const rows = buildCompareRows(taxRows, javaRows, edits)
  if (rows.length === 0) {
    return NextResponse.json({ message: "비교 데이터가 없습니다." }, { status: 400 })
  }

  // ── 전체 섹션 빌드 (body 반복 포함) — 다운로드용 code 생성 ──
  type Section = { sect: string; label: string; lines: string[] }
  const allSections: Section[] = []
  let curSect = ""
  let totalBytes = 0

  for (const row of rows) {
    if (!row.tax || !row.java) continue
    if (row.cmd === "D") continue

    const sect = row.java.sect || "header"
    if (sect !== curSect) {
      allSections.push({ sect, label: sectLabel(sect), lines: [] })
      curSect = sect
    }
    const javaCode = (row.editedRaw || row.java.raw).trimEnd()
    const parts    = [row.tax.코드, row.tax.구분, row.tax.항목].filter(Boolean)
    allSections.at(-1)!.lines.push(`${javaCode} + // ${parts.join(" ")}`)
    totalBytes += row.java.len
  }

  // 전체 makeStr 라인 열 정렬 (다운로드 포함)
  alignSections(allSections)

  allSections.forEach((s, i) => {
    s.lines.push(i < allSections.length - 1 ? '    + ""' : '    + "\\n"')
  })

  // 다운로드용 전체 코드 (모든 body 반복 포함)
  const code = allSections.flatMap(s => s.lines).join("\n")

  // ── 표시용 섹션: body_1만 + body_sum 추가, body_2+ 제거 ──
  // 원본 훼손 방지를 위해 deep copy
  // body_1만 유지 — body_2, body_10, body_11 등 번호 무관하게 제거
  const dispSections: Section[] = allSections
    .filter(s => { const m = s.sect.match(/^body_(\d+)$/); return !m || parseInt(m[1]) === 1 })
    .map(s => ({ ...s, lines: [...s.lines] }))

  // \n 라인 제거 후 마지막 표시 섹션에 재부착
  for (const s of dispSections) {
    s.lines = s.lines.filter(l => !l.includes('+ "\\n"'))
  }

  // body_sum 계산 (body_1의 연속 타입별 합산)
  const body1 = dispSections.find(s => s.sect === "body_1")
  if (body1) {
    type Group = { dtype: string; len: number; count: number; from: string; to: string }
    const groups: Group[] = []

    for (const line of body1.lines) {
      const tm = /makeStr\s*\(\s*"([xX9])"\s*,\s*(\d+)/.exec(line)
      const cm = /\/\/\s*(\S+)/.exec(line)
      if (!tm) continue
      const dtype = tm[1].toUpperCase()   // X / 9 로 정규화
      const len   = parseInt(tm[2])
      const code  = cm?.[1]?.trim() ?? ""
      const last  = groups.at(-1)
      if (last && last.dtype === dtype) {
        last.len += len; last.count++; last.to = code
      } else {
        groups.push({ dtype, len, count: 1, from: code, to: code })
      }
    }

    const padW    = Math.max(...groups.map(g => g.len.toString().length), 1)
    const sumLines = groups.map(g => {
      const fill  = g.dtype === "9" ? '"0"' : '" "'
      const dtype = g.dtype   // 이미 toUpperCase 정규화됨
      const range = g.from === g.to ? g.from : `${g.from} ~ ${g.to}`
      return `    makeStr("${dtype}", ${g.len.toString().padStart(padW)}, ${fill}) // ${range}  (${dtype}타입 ${g.count}행 합산)`
    })

    const idx = dispSections.findIndex(s => s.sect === "body_1")
    dispSections.splice(idx + 1, 0, { sect: "body_sum", label: "Body 합산", lines: sumLines })
  }

  // \n 라인 마지막 표시 섹션에 추가
  if (dispSections.length > 0) dispSections.at(-1)!.lines.push('    + "\\n"')

  return NextResponse.json({
    code,
    sections: dispSections,
    lines: allSections.reduce((n, s) => n + s.lines.length, 0),
    bytes: totalBytes,
  })
}
