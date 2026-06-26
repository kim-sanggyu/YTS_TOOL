/**
 * generate(화면+다운로드)와 patch-source(원본패치) 양쪽이 공유하는 makeStr 조립 로직.
 * 이 함수를 단일 진실의 원천으로 사용하면 화면·다운로드·패치가 항상 일치가 보장됩니다.
 */
import type { CompareRow } from "@/features/media-layout/types"

export type Section = {
  sect:            string
  label:           string
  lines:           string[]
  lineNos:         number[]   // lines[i]에 대응하는 java.lineNo (patch-source용)
  seqs:            number[]   // lines[i]에 대응하는 java.seq (I-행 insertMap용)
  bodyRepeatCount?: number
}

function sectLabel(sect: string): string {
  if (sect === "header")   return "Header"
  if (sect === "footer")   return "Footer"
  if (sect === "body_sum") return "Body 합산"
  const m = sect.match(/^body_(\d+)$/)
  return m ? `Body-${m[1]}` : sect
}

function alignSections(sections: Section[]): void {
  const norm = (s: string) => s.replace(/\s+\)/g, ")")

  type Parsed = { dtype: string; len: string; arg: string; comment: string } | null
  function parseLine(line: string): Parsed {
    const plusComment = line.indexOf(" + //")
    if (plusComment === -1) return null
    const raw     = line.slice(0, plusComment).trim()
    const comment = line.slice(plusComment)
    const m = /^makeStr\s*\(\s*"([xX9])"\s*,\s*(\d+)\s*,\s*([\s\S]+)\)\s*$/.exec(raw)
    if (!m) return null
    return { dtype: /[xX]/.test(m[1]) ? "X" : "9", len: m[2], arg: norm(m[3].trimEnd()), comment }
  }

  const allParsed = sections.flatMap(s => s.lines).map(parseLine)
  const maxLen = Math.max(...allParsed.map(p => p?.len.length ?? 0), 1)
  const maxArg = Math.max(...allParsed.map(p => p?.arg.length ?? 0), 1)

  let idx = 0
  for (const s of sections) {
    s.lines = s.lines.map(line => {
      const p = allParsed[idx++]
      if (!p) return line
      return `makeStr("${p.dtype}", ${p.len.padStart(maxLen)}, ${p.arg.padEnd(maxArg)})${p.comment}`
    })
  }
}

const MAKE_STR_LEN_RE = /^makeStr\s*\(\s*"[xX9]"\s*,\s*(\d{1,4})\s*,/
function parseMakeStrLen(raw: string): number | null {
  const m = MAKE_STR_LEN_RE.exec(raw.trim())
  return m ? parseInt(m[1]) : null
}

export interface BuildResult {
  /** 화면 표시용 섹션 (body_1만 + body_sum, \n 라인 없음) */
  displaySections: Section[]
  /** 레코드 단독 다운로드용 코드 (header+body_1+body_sum+footer, body_2+ 제외) */
  downloadCode: string
  /** patch-source 내부용 전체 코드 (body 반복 전체 포함) */
  fullCode: string
  /** 총 바이트 수 */
  totalBytes: number
  /** patch-source용: java.lineNo → 최종 정렬된 라인 ("makeStr(...) + // 코드 구분 항목") */
  lineMap: Map<number, string>
  /** patch-source용 I-행: java.seq → 최종 정렬된 라인 (lineNo=0 행, lineMap 대신 사용) */
  insertMap: Map<number, string>
  /** patch-source용: body_2+ 행 LINE_NO 집합 (원본에서 삭제 대상) */
  bodyRepeatDeleteLines: Set<number>
  /** patch-source용: body_sum 삽입 기준 LINE_NO (body_1 마지막 행, 없으면 -1) */
  bodySumInsertAfterLineNo: number
  /** patch-source용: body_sum 삽입 라인 목록 (" + // " 포맷 적용) */
  bodySumInsertLines: string[]
}

export function buildAlignedOutput(rows: CompareRow[]): BuildResult {
  const allSections: Section[] = []
  let curSect = ""

  for (const row of rows) {
    if (!row.tax || !row.java) continue
    if (row.cmd === "D") continue

    const sect = row.tax.sect || row.java.sect || "header"
    if (sect !== curSect) {
      allSections.push({ sect, label: sectLabel(sect), lines: [], lineNos: [], seqs: [] })
      curSect = sect
    }
    const javaCode  = (row.editedRaw || row.java.raw).trimEnd()
    const taxComment = [row.tax.코드, row.tax.구분, row.tax.항목].filter(Boolean).join(" ")
    allSections.at(-1)!.lines.push(`${javaCode} + // ${taxComment}`)
    allSections.at(-1)!.lineNos.push(row.java.lineNo)
    allSections.at(-1)!.seqs.push(row.java.seq)
  }

  // 열 정렬 (generate와 동일)
  alignSections(allSections)

  // 바이트 합산
  const totalBytes = allSections
    .flatMap(s => s.lines)
    .reduce((sum, line) => sum + (parseMakeStrLen(line) ?? 0), 0)

  // \n 구분자 추가
  allSections.forEach((s, i) => {
    s.lines.push(i < allSections.length - 1 ? '    + ""' : '    + "\\n"')
    s.lineNos.push(-1)
    s.seqs.push(-1)
  })

  // 다운로드용 전체 코드
  const downloadCode = allSections.flatMap(s => s.lines).join("\n")

  // patch-source용 lineMap: lineNo → 정렬된 라인 (lineNo>0 행만)
  // patch-source용 insertMap: java.seq → 정렬된 라인 (I-행 lineNo=0 행만)
  const lineMap   = new Map<number, string>()
  const insertMap = new Map<number, string>()
  for (const s of allSections) {
    s.lines.forEach((line, i) => {
      const lineNo = s.lineNos[i]
      const seq    = s.seqs[i]
      if (lineNo > 0)              lineMap.set(lineNo, line)
      else if (lineNo === 0 && seq > 0) insertMap.set(seq, line)
    })
  }

  // 화면 표시용: body_1만 + body_sum, \n 라인 제거
  const dispSections: Section[] = allSections
    .filter(s => { const m = s.sect.match(/^body_(\d+)$/); return !m || parseInt(m[1]) === 1 })
    .map(s => ({ ...s, lines: s.lines.filter(l => !l.includes('+ "\\n"')), lineNos: [...s.lineNos], seqs: [...s.seqs] }))

  // body_sum 계산
  const body1 = dispSections.find(s => s.sect === "body_1")
  if (body1) {
    type Group = { dtype: string; len: number; count: number; from: string; to: string }
    const groups: Group[] = []
    for (const line of body1.lines) {
      const tm = /makeStr\s*\(\s*"([xX9])"\s*,\s*(\d+)/.exec(line)
      const cm = /\/\/\s*(\S+)/.exec(line)
      if (!tm) continue
      const dtype = tm[1].toUpperCase()
      const len   = parseInt(tm[2])
      const code  = cm?.[1]?.trim() ?? ""
      const last  = groups.at(-1)
      if (last && last.dtype === dtype) { last.len += len; last.count++; last.to = code }
      else groups.push({ dtype, len, count: 1, from: code, to: code })
    }
    const padW = Math.max(...groups.map(g => g.len.toString().length), 1)
    const sumLines = groups.map(g => {
      const fill  = g.dtype === "9" ? '"0"' : '" "'
      const range = g.from === g.to ? g.from : `${g.from} ~ ${g.to}`
      return `makeStr("${g.dtype}", ${g.len.toString().padStart(padW)}, ${fill}) // ${range}  (${g.dtype}타입 ${g.count}행 합산)`
    })
    const bodyRepeatCount = allSections.filter(s => /^body_\d+$/.test(s.sect)).length
    const idx = dispSections.findIndex(s => s.sect === "body_1")
    dispSections.splice(idx + 1, 0, { sect: "body_sum", label: "body_1 타입별 길이 합산", lines: sumLines, lineNos: [], seqs: [], bodyRepeatCount })
  }

  if (dispSections.length > 0) {
    dispSections.at(-1)!.lines.push('    + "\\n"')
    dispSections.at(-1)!.lineNos.push(-1)
    dispSections.at(-1)!.seqs.push(-1)
  }

  // 레코드 단독 다운로드용 코드: displaySections 기반 (header+body_1+body_sum+footer)
  // body_sum 행은 " // " → " + // " 변환으로 Java 연결 문법 유지
  const displayDownloadLines: string[] = []
  for (let si = 0; si < dispSections.length; si++) {
    const s      = dispSections[si]
    const isLast = si === dispSections.length - 1
    for (const line of s.lines) {
      if (line === '    + "\\n"' || line === '    + ""') continue
      if (s.sect === "body_sum") {
        displayDownloadLines.push(line.replace(" // ", " + // "))
      } else {
        displayDownloadLines.push(line)
      }
    }
    displayDownloadLines.push(isLast ? '    + "\\n"' : '    + ""')
  }
  const displayDownloadCode = displayDownloadLines.join("\n")

  // patch-source용: body_2+ 행 삭제 + body_sum 삽입 데이터
  const bodyRepeatDeleteLines = new Set<number>()
  for (const s of allSections) {
    const m = s.sect.match(/^body_(\d+)$/)
    if (!m || parseInt(m[1]) === 1) continue
    for (const lineNo of s.lineNos) {
      if (lineNo > 0) bodyRepeatDeleteLines.add(lineNo)
    }
  }

  let bodySumInsertAfterLineNo = -1
  const body1Sect = allSections.find(s => s.sect === "body_1")
  if (body1Sect) {
    for (let i = body1Sect.lineNos.length - 1; i >= 0; i--) {
      if (body1Sect.lineNos[i] > 0) { bodySumInsertAfterLineNo = body1Sect.lineNos[i]; break }
    }
  }

  const bodySumSect = dispSections.find(s => s.sect === "body_sum")
  const bodySumInsertLines = bodyRepeatDeleteLines.size > 0 && bodySumSect
    ? bodySumSect.lines.map(l => l.replace(" // ", " + // "))
    : []

  return {
    displaySections: dispSections,
    downloadCode:    displayDownloadCode,
    fullCode:        downloadCode,
    totalBytes,
    lineMap,
    insertMap,
    bodyRepeatDeleteLines,
    bodySumInsertAfterLineNo,
    bodySumInsertLines,
  }
}
