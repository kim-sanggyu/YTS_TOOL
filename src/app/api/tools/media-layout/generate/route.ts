import { NextRequest, NextResponse } from "next/server"
import {
  getLatestHwpFile, getTaxRows, getJavaRows, getJavaEdits,
  buildCompareRows,
} from "@/lib/tax-oracle"
import { auth } from "@/auth"

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
  const { record } = await req.json()

  const hwp = await getLatestHwpFile(userId)
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
    const javaCode = row.editedRaw || row.java.raw
    const taxCode  = row.tax.코드.padEnd(4)
    allSections.at(-1)!.lines.push(`${javaCode} // ${taxCode} 【${row.tax.항목}】`)
    totalBytes += row.java.len
  }

  if (allSections.length > 0) allSections.at(-1)!.lines.push('    + "\\n"')

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
      const code  = cm?.[1]?.replace(/【.*/, "").trim() ?? ""
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
