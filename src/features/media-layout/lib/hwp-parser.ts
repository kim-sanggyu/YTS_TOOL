import * as CFB from "cfb"
import * as zlib from "zlib"

export interface HwpField {
  record: string    // 'A' | 'B' | ... | 'K'
  no: string        // 'A1', 'C67ⓐ'
  name: string      // 서식항목
  dtype: string     // 'X(1)', '9(10)'
  len: number       // 필드 길이
  cum: number       // 누적 길이
  sect: string      // 'HEAD' (기본값, UI에서 BODY_N/FOOTER로 변경)
  gubun?: string    // 구분 레이블 (예: 【자료관리번호】)
}

// ── 텍스트 정제 ──────────────────────────────────────────────
const HWP_OBJ_RE     = /\x02[一-鿿]{1,4}[\x00]{0,8}\x02/g
const CTRL_RE        = /[\x00-\x1F\x7F]/g
const LEADING_CJK_RE = /^[一-鿿\s]+/

function cleanText(s: string): string {
  return s.replace(HWP_OBJ_RE, "").replace(CTRL_RE, "").replace(LEADING_CJK_RE, "").trim()
}

// ── 파싱 패턴 ────────────────────────────────────────────────
const FIELD_NUM_RE   = /^([A-K][0-9]+[ⓐ-ⓩ]?)$/
const DATA_TYPE_RE   = /^[X9]\([0-9]+\)$/
const CUM_LEN_RE     = /^[0-9]+$/
const RECORD_HDR_RE  = /([A-K])레코드【/
const GUBUN_RE       = /【[^】]+】/
const FIELD_PARTS_RE = /^([A-K])([0-9]+)([ⓐ-ⓩ]?)$/
const SUFFIX_CHARS   = "ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ"
const BARE_FIELD_RE  = /^[A-K][0-9]+$/
const LONE_SUFFIX_RE = /^[ⓐ-ⓩ]$/
const MAX_NAME_LINES = 6
// '제1절 근로소득 지급명세서' 영역만 파싱하기 위한 절 감지 (공백·전각숫자 허용)
const SECTION_RE     = /제\s*([\d１２３４５６７８９０]+)\s*절/

function dtypeLen(s: string): number {
  const m = s.match(/^[X9]\(([0-9]+)\)$/)
  return m ? parseInt(m[1]) : 0
}

function isValidNext(prev: string | null, curr: string): boolean {
  const cm = FIELD_PARTS_RE.exec(curr)
  if (!cm) return false
  const cLet = cm[1], cNum = parseInt(cm[2]), cSfx = cm[3]

  if (!prev) return cNum === 1 && cSfx === ""

  const pm = FIELD_PARTS_RE.exec(prev)
  if (!pm) return false
  const pLet = pm[1], pNum = parseInt(pm[2]), pSfx = pm[3]

  if (pLet !== cLet) return false
  if (pSfx === "" && cSfx === "") return cNum === pNum + 1
  if (pSfx === "" && cSfx !== "") return (cNum === pNum || cNum === pNum + 1) && cSfx === "ⓐ"
  if (pSfx !== "" && cSfx === "") return cNum === pNum + 1
  if (cNum === pNum) {
    const pi = SUFFIX_CHARS.indexOf(pSfx), ci = SUFFIX_CHARS.indexOf(cSfx)
    return pi >= 0 && ci === pi + 1
  }
  return cNum === pNum + 1 && cSfx === "ⓐ"
}

// ── HWP 이진 → 텍스트 추출 ────────────────────────────────────
function extractTexts(data: Buffer): string[] {
  const out: string[] = []
  let pos = 0
  while (pos < data.length - 4) {
    const hdr  = data.readUInt32LE(pos)
    const tag  = hdr & 0x3FF
    let   size = (hdr >> 20) & 0xFFF
    pos += 4
    if (size === 0xFFF) { size = data.readUInt32LE(pos); pos += 4 }
    if (tag === 67 && size > 0) {
      out.push(data.slice(pos, pos + size).toString("utf16le").trim())
    }
    pos += size
  }
  return out
}

export interface ParseResult {
  fields:           HwpField[]
  detectedSections: string[]   // 감지된 절 헤더 목록 (디버그용)
}

// ── 메인 파서 ─────────────────────────────────────────────────
export function parseHwpBuffer(buffer: Buffer): ParseResult {
  // OLE 읽기
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wb     = (CFB as any).read(buffer, { type: "buffer" }) as CFB.CFB$Container
  const hEntry = CFB.find(wb, "FileHeader")
  if (!hEntry) throw new Error("FileHeader not found")

  const hBuf       = Buffer.from(hEntry.content as Uint8Array)
  const compressed = (hBuf.readUInt32LE(36) & 1) === 1

  // BodyText 섹션들 모두 읽어 텍스트 합산
  const sections = wb.FileIndex.filter(
    (e: CFB.CFB$Entry) => e.name.startsWith("Section") && e.type === 2
  ).slice(0, 8)

  let textsRaw: string[] = []
  for (const entry of sections) {
    const raw  = Buffer.from(entry.content as Uint8Array)
    const data = compressed ? zlib.inflateRawSync(raw) : raw
    textsRaw   = textsRaw.concat(extractTexts(data))
  }

  // 정제 + "C65" + "ⓐ" 합치기
  const clean = textsRaw.map(cleanText)
  const texts: string[] = []
  let j = 0
  while (j < clean.length) {
    if (BARE_FIELD_RE.test(clean[j]) && j + 1 < clean.length && LONE_SUFFIX_RE.test(clean[j + 1])) {
      texts.push(clean[j] + clean[j + 1]); j += 2
    } else {
      texts.push(clean[j]); j++
    }
  }

  // 필드 파싱
  const rows:             HwpField[] = []
  const detectedSections: string[]   = []
  let currentRecord:    string | null = null
  let lastFieldNo:      string | null = null
  let currentGubun:     string | null = null
  let accumulated     = 0
  let i               = 0
  let inTargetSection = false   // 제1절 근로소득 영역 여부
  let foundSection    = false   // 문서에 '제N절' 헤더가 존재하는지

  while (i < texts.length) {
    const t = texts[i]

    // 절 헤더 감지: '제1절' → 파싱 시작, '제2절' 이상 → 파싱 중단
    const sm = SECTION_RE.exec(t)
    if (sm) {
      foundSection = true
      const num = parseInt(sm[1].replace(/[１２３４５６７８９０]/g, d =>
        String("１２３４５６７８９０".indexOf(d) + 1)))
      if (num === 1) {
        if (inTargetSection) break  // 제1절이 두 번째 나오면 → 중단 (push 안 함)
        inTargetSection = true
      } else if (inTargetSection) {
        break  // 제2절 이상이 나오면 완료
      }
      detectedSections.push(t)   // 실제 처리하는 절만 기록
      currentRecord = null; lastFieldNo = null; accumulated = 0
      i++; continue
    }

    // 절 헤더가 있는 문서에서 제1절 밖은 스킵
    if (foundSection && !inTargetSection) { i++; continue }

    const rm = RECORD_HDR_RE.exec(t)
    if (rm) {
      currentRecord = rm[1]; lastFieldNo = null; currentGubun = null; accumulated = 0; i++; continue
    }

    // 구분 레이블 감지: 【자료관리번호】 등 — 레코드 헤더가 아닌 단독 【...】
    if (currentRecord && !RECORD_HDR_RE.test(t)) {
      const gm = GUBUN_RE.exec(t)
      if (gm) { currentGubun = gm[0].replace(/\s+/g, ""); i++; continue }
    }

    if (FIELD_NUM_RE.test(t) && currentRecord) {
      const fieldNo = t

      // 데이터타입 탐색
      let dtypeIdx: number | null = null
      for (let k = i + 1; k < Math.min(i + 1 + MAX_NAME_LINES, texts.length); k++) {
        if (DATA_TYPE_RE.test(texts[k])) { dtypeIdx = k; break }
      }

      if (dtypeIdx !== null && dtypeIdx + 1 < texts.length && CUM_LEN_RE.test(texts[dtypeIdx + 1])) {
        const proposedCum = parseInt(texts[dtypeIdx + 1])
        const dlen        = dtypeLen(texts[dtypeIdx])

        if (!isValidNext(lastFieldNo, fieldNo)) { i++; continue }

        // 이름 토큰 사이에 섞인 구분 레이블 감지 (HWP 병합셀이 중간에 나오는 경우)
        for (let k = i + 1; k < dtypeIdx; k++) {
          const gm2 = GUBUN_RE.exec(texts[k])
          if (gm2 && !RECORD_HDR_RE.test(texts[k])) currentGubun = gm2[0].replace(/\s+/g, "")
        }
        const fieldName = texts.slice(i + 1, dtypeIdx).filter(t => t && !GUBUN_RE.test(t)).join(" ")
        // 누적 불일치 시 proposedCum으로 재동기화 (HWP 원본 오타 대응)
        if (accumulated + dlen !== proposedCum) accumulated = proposedCum - dlen

        rows.push({ record: currentRecord, no: fieldNo, name: fieldName, dtype: texts[dtypeIdx], len: dlen, cum: proposedCum, sect: "HEAD", gubun: currentGubun ?? undefined })
        accumulated = proposedCum; lastFieldNo = fieldNo

        // 같은 필드번호에 연속된 데이터타입 (부호+금액 등)
        let scan = dtypeIdx + 2, cont = 2
        while (scan < texts.length) {
          if (FIELD_NUM_RE.test(texts[scan]) || RECORD_HDR_RE.test(texts[scan])) break
          // 연속 dtype 사이에서도 구분 레이블 감지
          const gm3 = GUBUN_RE.exec(texts[scan])
          if (gm3 && !RECORD_HDR_RE.test(texts[scan])) { currentGubun = gm3[0].replace(/\s+/g, ""); scan++; continue }
          if (DATA_TYPE_RE.test(texts[scan]) && scan + 1 < texts.length && CUM_LEN_RE.test(texts[scan + 1])) {
            const cCum  = parseInt(texts[scan + 1])
            const cDlen = dtypeLen(texts[scan])
            if (accumulated + cDlen === cCum) {
              rows.push({ record: currentRecord, no: `${fieldNo}(${cont})`, name: fieldName, dtype: texts[scan], len: cDlen, cum: cCum, sect: "HEAD", gubun: currentGubun ?? undefined })
              accumulated = cCum; cont++
            }
            scan += 2
          } else { scan++ }
        }
        i = scan; continue
      }
    }
    i++
  }

  return { fields: rows, detectedSections }
}
