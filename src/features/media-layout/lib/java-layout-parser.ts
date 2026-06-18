import type { JavaField } from "../types"

export type { JavaField }   // 하위 호환 re-export

export interface JavaParseResult {
  fields:           JavaField[]
  skipped:          number
  detectedSections: string[]
}

// ── 정규식 ────────────────────────────────────────────────────

const MAKE_STR_RE    = /makeStr\("([9xX])",\s*(\d+),/
// 】 뒤 텍스트를 항목명으로 사용 (/*...*/는 제거)
const FIELD_CMT_RE   = /\/\/\s*([A-K]\d+(?:[ⓐ-ⓩ]|\(\d+\))?)\s*【[^】]+】(.+)/
const SECTION_RE     = /제\s*([\d１２３４５６７８９０]+)\s*절/
const CPR_RE         = /countPerRecord\s*=\s*(\d+)/      // 한 레코드당 반복 수
const REC_HDR_RE     = /\/\/([A-K])레코드/               // //E레코드[...]
const BW_WRITE_RE    = /bw\.write\s*\(/
const ELSE_RE        = /\}\s*else\s*[\{\(]/              // } else { 또는 } else if (
const NEWLINE_MARK   = /"\s*\\n\s*"/                     // "\n" - 레코드 종결 마커

// ── 유틸 ─────────────────────────────────────────────────────

function extractMakeStr(line: string): string {
  const start = line.indexOf('makeStr(')
  if (start === -1) return line
  let depth = 0
  for (let i = start; i < line.length; i++) {
    if (line[i] === '(') depth++
    else if (line[i] === ')') {
      depth--
      if (depth === 0) return line.slice(start, i + 1)
    }
  }
  return line.slice(start)
}

// ── 파서 ─────────────────────────────────────────────────────

interface RawField {
  no: string; record: string; name: string; dtype: string; len: number; lineNo: number; raw: string
}

interface BwBlock {
  rawFields: RawField[]
  isFooter: boolean   // "\n" 포함 → 레코드 마지막 블록
  isElse: boolean     // else 브랜치 → 패딩 (무시)
}

export function parseJavaLayout(source: string): JavaParseResult {
  const lines            = source.split(/\r?\n/)
  const detectedSections: string[] = []
  const allFields:        JavaField[] = []
  let skipped            = 0

  // ── 절 / 구역 상태 ──────────────────────────────────────────
  let inTargetSection = false
  let foundSection    = false

  // ── bw.write() 블록 상태 ────────────────────────────────────
  let inBwBlock      = false
  let blockRawFields: RawField[] = []
  let blockIsFooter  = false
  let blockIsElse    = false
  let nextBlockIsElse = false  // 다음 bw.write()가 else 브랜치인지

  // ── 레코드 상태 ──────────────────────────────────────────────
  let currentRecord: string | null  = null
  let countPerRecord                = 1
  let recordBlocks:  BwBlock[]      = []
  const cumByRecord: Record<string, number> = {}

  function flushRecord() {
    if (!currentRecord || recordBlocks.length === 0) return

    const rec    = currentRecord
    const repeat = countPerRecord

    // else 패딩 블록 제외
    const blocks = recordBlocks.filter(b => !b.isElse)

    if (repeat <= 1 || blocks.length <= 1) {
      // 단순 레코드 (A/B/C/D): 블록 순서대로 누적
      for (const blk of blocks) {
        for (const rf of blk.rawFields) {
          cumByRecord[rec] = (cumByRecord[rec] ?? 0) + rf.len
          allFields.push({ ...rf, cum: cumByRecord[rec], sect: "HEAD" })
        }
      }
    } else {
      // 반복 레코드 (E/F/G/K)
      // 구조: HEAD 블록(들) + BODY 블록(들) + FOOTER 블록
      const footerBlocks = blocks.filter(b => b.isFooter)
      const nonFooter    = blocks.filter(b => !b.isFooter)

      // HEAD: 첫 번째 비-FOOTER 블록
      const headBlock  = nonFooter[0]
      // BODY: 나머지 비-FOOTER 블록
      const bodyBlocks = nonFooter.slice(1)

      // HEAD 필드 (×1)
      for (const rf of (headBlock?.rawFields ?? [])) {
        cumByRecord[rec] = (cumByRecord[rec] ?? 0) + rf.len
        allFields.push({ ...rf, cum: cumByRecord[rec], sect: "HEAD" })
      }

      // BODY 필드 (×repeat) — BODY_1, BODY_2, ... 섹션으로 표기
      for (let iter = 1; iter <= repeat; iter++) {
        for (const blk of bodyBlocks) {
          for (const rf of blk.rawFields) {
            cumByRecord[rec] = (cumByRecord[rec] ?? 0) + rf.len
            allFields.push({ ...rf, cum: cumByRecord[rec], sect: `BODY_${iter}`, bodyIter: iter })
          }
        }
      }

      // FOOTER 필드 (×1)
      for (const blk of footerBlocks) {
        for (const rf of blk.rawFields) {
          cumByRecord[rec] = (cumByRecord[rec] ?? 0) + rf.len
          allFields.push({ ...rf, cum: cumByRecord[rec], sect: "FOOTER" })
        }
      }
    }
  }

  // ── 라인 스캔 ────────────────────────────────────────────────
  for (let idx = 0; idx < lines.length; idx++) {
    const line    = lines[idx]
    const trimmed = line.trim()
    const lineNo  = idx + 1

    // 절 감지
    const sm = SECTION_RE.exec(trimmed)
    if (sm) {
      foundSection = true
      const num = parseInt(sm[1].replace(/[１２３４５６７８９０]/g,
        d => String("１２３４５６７８９０".indexOf(d) + 1)))
      if (num === 1) {
        if (inTargetSection) break
        inTargetSection = true
        detectedSections.push(trimmed)
      } else if (inTargetSection) {
        break
      }
      continue
    }
    if (foundSection && !inTargetSection) continue

    // countPerRecord
    const cprM = CPR_RE.exec(trimmed)
    if (cprM) { countPerRecord = parseInt(cprM[1]); continue }

    // 레코드 헤더 주석 (//E레코드)
    const recM = REC_HDR_RE.exec(trimmed)
    if (recM) {
      // 이전 레코드 플러시
      if (!inBwBlock) {
        flushRecord()
        currentRecord  = recM[1]
        recordBlocks   = []
        countPerRecord = 1
      }
      continue
    }

    // else 브랜치 감지
    if (ELSE_RE.test(trimmed)) {
      nextBlockIsElse = true
      continue
    }

    // bw.write( 시작
    if (BW_WRITE_RE.test(trimmed)) {
      inBwBlock      = true
      blockRawFields = []
      blockIsFooter  = false
      blockIsElse    = nextBlockIsElse
      nextBlockIsElse = false
      continue
    }

    if (!inBwBlock) continue

    // "\n" → FOOTER 마커
    if (NEWLINE_MARK.test(trimmed)) { blockIsFooter = true; continue }

    // 블록 종료 );
    if (/^\);\s*$/.test(trimmed)) {
      inBwBlock = false
      if (currentRecord) {
        recordBlocks.push({
          rawFields: blockRawFields,
          isFooter:  blockIsFooter,
          isElse:    blockIsElse,
        })
      }
      continue
    }

    // makeStr() 파싱
    const makeM    = MAKE_STR_RE.exec(trimmed)
    const commentM = FIELD_CMT_RE.exec(trimmed)

    if (makeM && commentM) {
      const no     = commentM[1]
      const name   = commentM[2].replace(/\/\*.*?\*\//g, "").trim()
      const record = no[0]
      const dtype  = makeM[1].toLowerCase()
      const len    = parseInt(makeM[2])
      blockRawFields.push({ no, record, name, dtype, len, lineNo, raw: extractMakeStr(trimmed) })
    } else if (makeM) {
      skipped++
    }
  }

  // 마지막 레코드 플러시
  flushRecord()

  return { fields: allFields, skipped, detectedSections }
}
