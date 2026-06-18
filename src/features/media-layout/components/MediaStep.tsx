"use client"

import { useRef, useState, useCallback, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2, XCircle, Loader2, RefreshCw, Download, AlertTriangle, Save, RotateCcw, Code2, X, Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import type { HwpFileRow, JavaFileRow, TaxSectConfigRow } from "@/lib/tax-oracle"
import type { TaxLayoutRow, JavaField, CompareRow } from "../types"

const RECORD_TYPES = ["A","B","C","D","E","F","G","H","I","K"]

// ── 섹션 배경색 ───────────────────────────────────────────────

const BODY_BG = ["bg-purple-50","bg-violet-50","bg-indigo-50","bg-blue-50"]
function bodyIdx(sect: string) { const m = sect.match(/^body_(\d+)$/); return m ? parseInt(m[1]) : 0 }
function taxSectBg(sect: string) {
  if (sect === "header") return "bg-gray-50"
  if (sect === "footer") return "bg-teal-50"
  if (sect.startsWith("body_")) return BODY_BG[(bodyIdx(sect) - 1) % BODY_BG.length]
  return ""
}

// ── 섹션 구분선 ───────────────────────────────────────────────

// ── 미리보기 섹션 박스 (복사 버튼 포함) ──────────────────────

function SectionBox({ boxBg, hdrCls, label, lineCount, lines }: {
  boxBg: string; hdrCls: string; label: string; lineCount: string; lines: string[]
}) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className={cn("rounded-md border overflow-hidden shadow-sm", boxBg)}>
      <div className={cn("px-3 py-1.5 text-[11px] font-semibold flex items-center gap-2 select-none", hdrCls)}>
        <span>▸ {label}</span>
        <span className="font-normal opacity-70">{lineCount}</span>
        <button
          onClick={handleCopy}
          className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium opacity-70 hover:opacity-100 transition-opacity"
        >
          {copied
            ? <><Check className="h-3 w-3" />복사됨</>
            : <><Copy className="h-3 w-3" />복사</>}
        </button>
      </div>
      <pre className={cn("px-3 py-2 text-[11px] font-mono overflow-x-auto leading-5", boxBg)}>
        {lines.join("\n")}
      </pre>
    </div>
  )
}

function SectSep({ sect, colSpan }: { sect: string; colSpan: number }) {
  const num  = bodyIdx(sect)
  const isH  = sect === "header"
  const isF  = sect === "footer"
  const bg   = isH ? "bg-gray-200" : isF ? "bg-teal-100" : BODY_BG[(num - 1) % BODY_BG.length]
  const txt  = isH ? "text-gray-600" : isF ? "text-teal-700" : "text-purple-700"
  const lbl  = isH ? "▸ Header" : isF ? "▸ Footer" : `▸ Body-${num}`
  return (
    <tr className={`${bg} border-y`}>
      <td colSpan={colSpan} className={`px-3 py-0.5 text-[11px] font-semibold ${txt} select-none`}>{lbl}</td>
    </tr>
  )
}

// ── makeStr 파싱 + 검증 ───────────────────────────────────────

const MAKE_STR_RE = /^makeStr\s*\(\s*"([xX9])"\s*,\s*(\d+)\s*,[\s\S]+\)\s*$/

function parseMakeStr(raw: string): { dtype: string; len: number } | null {
  const m = MAKE_STR_RE.exec(raw.trim())
  if (!m) return null
  return { dtype: m[1].toLowerCase(), len: parseInt(m[2]) }
}

// ── makeStr 정렬 ─────────────────────────────────────────────

function alignMakeStrs(strs: string[]): string[] {
  const parsed = strs.map(s => {
    const m = /^makeStr\("([9xX])",\s*(\d+),\s*([\s\S]+)\)$/.exec(s)
    return m ? { type: m[1], len: m[2], arg: m[3].trimEnd() } : null
  })
  const maxLen = Math.max(...parsed.map(p => p ? p.len.length : 0), 0)
  const maxArg = Math.max(...parsed.map(p => p ? p.arg.length : 0), 0)
  return strs.map((s, i) => {
    const p = parsed[i]
    return p ? `makeStr("${p.type}", ${p.len.padStart(maxLen)}, ${p.arg.padEnd(maxArg)})` : s
  })
}

// ── JavaSlot ─────────────────────────────────────────────────

interface JavaSlot {
  field:     JavaField | null
  cmd:       "D" | "I" | null
  editedRaw: string
  fromDB:    boolean   // true = MLAY_JAVA_EDIT에서 로드된 이미 저장된 D/I
}

// ── 구조 분석 (taxItems 기준) ─────────────────────────────────

function analyzeFromItems(items: (TaxLayoutRow | null)[]) {
  const rows   = items.filter(Boolean) as TaxLayoutRow[]
  const maxBody = rows.reduce((m, r) => Math.max(m, bodyIdx(r.sect)), 0)
  const hasFooter = rows.some(r => r.sect === "footer")
  const isHbf = maxBody > 1 || hasFooter
  if (!isHbf) return { isHbf: false as const, total: rows.length }
  const headRows      = rows.filter(r => r.sect === "header")
  const body1Rows     = rows.filter(r => r.sect === "body_1")
  const lastBodyRows  = rows.filter(r => r.sect === `body_${maxBody}`)
  const footRows      = rows.filter(r => r.sect === "footer")
  return { isHbf: true as const, maxBody, headRows: headRows.length, body1Rows: body1Rows.length, footRows: footRows.length, bodyStart: body1Rows[0]?.코드 ?? "", bodyEnd: lastBodyRows.at(-1)?.코드 ?? "", total: rows.length }
}

// ── 구조 표시 + 오류 통계 (읽기전용) ────────────────────────────

function TaxSectInfo({ items, slots }: { items: (TaxLayoutRow | null)[]; slots: JavaSlot[] }) {
  const info = analyzeFromItems(items)
  if (items.length === 0) return null

  // 오류 통계
  const maxLen = Math.max(items.length, slots.length)
  let itemDiff = 0, typeDiff = 0
  for (let i = 0; i < maxLen; i++) {
    const tax  = items[i]
    const slot = slots[i]
    if (!tax || !slot?.field || slot.cmd === "D" || slot.cmd === "I") continue
    if (tax.항목?.replace(/\s+/g, '') !== slot.field.name?.replace(/\s+/g, '')) itemDiff++
    if (tax.타입 !== slot.field.dtype || tax.길이 !== slot.field.len) typeDiff++
  }
  const totalErr = itemDiff + typeDiff

  const errBadge = totalErr > 0 ? (
    <span className="flex items-center gap-2 ml-2 pl-2 border-l border-border">
      <span className="text-red-600 font-medium">오류 {totalErr}행</span>
      {itemDiff > 0 && <span className="text-orange-600">서식항목 {itemDiff}</span>}
      {typeDiff > 0 && <span className="text-red-500">데이터타입 {typeDiff}</span>}
    </span>
  ) : totalErr === 0 && maxLen > 0 ? (
    <span className="ml-2 pl-2 border-l border-border text-green-600 font-medium">오류 없음</span>
  ) : null

  if (!info.isHbf) {
    return (
      <div className="flex items-center gap-3 text-xs bg-muted/30 px-3 py-2 border-b text-muted-foreground flex-wrap">
        <span className="font-medium text-sky-700">Header 구조</span>
        <span>· 전체 {info.total}행</span>
        {errBadge}
      </div>
    )
  }
  const recLetter = items.find(Boolean)?.코드[0] ?? ""
  const toNum = (code: string) => code.startsWith(recLetter) ? code.slice(recLetter.length) : code
  return (
    <div className="flex items-center gap-3 text-xs bg-muted/30 px-3 py-2 border-b text-muted-foreground flex-wrap">
      <span className="font-medium text-purple-700">Header/Body/Footer 구조</span>
      <span className="text-gray-600">Header {info.headRows}행</span>
      <span>·</span>
      <span className="text-purple-600">
        Body <span className="font-mono">{recLetter}{toNum(info.bodyStart)}</span>
        {" ~ "}
        <span className="font-mono">{recLetter}{toNum(info.bodyEnd)}</span>
        {" "}({info.body1Rows}행 × {info.maxBody}회)
      </span>
      {info.footRows > 0 && <><span>·</span><span className="text-teal-600">Footer {info.footRows}행</span></>}
      <span>· 전체 {info.total}행</span>
      {errBadge}
    </div>
  )
}

// ── applySectConfig ───────────────────────────────────────────

function applySectConfig(rows: (TaxLayoutRow | null)[], cfg: TaxSectConfigRow | null): (TaxLayoutRow | null)[] {
  if (!cfg || cfg.sectMode === "body") return rows.map(r => r ? { ...r, sect: "header" } : null)
  const { bodyStart, bodyEnd, repeatCount } = cfg
  // HwpStep의 applyBulk와 동일하게: 전체 body 범위를 repeatCount로 나눠 1개 단위 길이 계산
  const unitLen = Math.max(1, Math.floor(Math.max(1, bodyEnd - bodyStart + 1) / repeatCount))
  // D 행(tax=null)은 tax 위치 카운트에서 제외
  let taxN = 0
  return rows.map((r) => {
    if (!r) return null
    taxN++
    if (taxN < bodyStart) return { ...r, sect: "header" }
    const off = taxN - bodyStart
    const bn  = Math.min(repeatCount, Math.floor(off / unitLen) + 1)
    if (taxN <= bodyEnd) return { ...r, sect: `body_${bn}` }
    return { ...r, sect: "footer" }
  })
}

// ── MediaStep ─────────────────────────────────────────────────

export function MediaStep() {
  const scrollDivRef  = useRef<HTMLDivElement>(null)
  const scrollPosRef  = useRef<Record<string, number>>({})

  const [year,      setYear]      = useState(() => new Date().getFullYear() - 1)
  const [hwpFile,   setHwpFile]   = useState<HwpFileRow | null>(null)
  const [javaFile,  setJavaFile]  = useState<JavaFileRow | null>(null)
  const [taxBytes,  setTaxBytes]  = useState<Record<string, number>>({})
  const [javaBytes, setJavaBytes] = useState<Record<string, number>>({})
  const [checking,  setChecking]  = useState(false)

  const [activeRec,   setActiveRec]   = useState("A")
  const [taxItems,    setTaxItems]    = useState<(TaxLayoutRow | null)[]>([])
  const [javaSlots,   setJavaSlots]   = useState<JavaSlot[]>([])
  const [sectConfig,     setSectConfig]     = useState<TaxSectConfigRow | null>(null)
  const [allSectConfigs, setAllSectConfigs] = useState<Record<string, TaxSectConfigRow>>({})
  const [comparing,   setComparing]   = useState(false)
  const [generating,  setGenerating]  = useState(false)
  const [dirtyTax,    setDirtyTax]    = useState<Map<string, string>>(new Map()) // code → item

  // 레코드별 비교 캐시 — 탭 전환 시 API 호출 없이 즉시 전환
  type CachedRecord = { taxItems: (TaxLayoutRow | null)[]; javaSlots: JavaSlot[]; sectConfig: TaxSectConfigRow | null }
  const [compareCache, setCompareCache] = useState<Record<string, CachedRecord>>({})
  const [saving,      setSaving]      = useState(false)
  const [saveMsg,     setSaveMsg]     = useState<{ ok: boolean; text: string } | null>(null)
  type PreviewSection = { sect: string; label: string; lines: string[] }
  const [previewCode,     setPreviewCode]     = useState<string | null>(null)
  const [previewSections, setPreviewSections] = useState<PreviewSection[]>([])
  const [previewRec,      setPreviewRec]      = useState("")
  const [modalPos,    setModalPos]    = useState({ x: 0, y: 0 })
  const [modalSize,   setModalSize]   = useState({ w: 860, h: 640 })
  const dragRef = useRef<null | {
    type: "drag";   ox: number; oy: number; px: number; py: number
  } | {
    type: "resize"; dir: string; ox: number; oy: number; px: number; py: number; pw: number; ph: number
  }>(null)

  const recList = RECORD_TYPES.filter(r => taxBytes[r] || javaBytes[r])

  // ── API 응답 → 캐시 항목 변환 헬퍼 ──────────────────────────

  function processCompareRows(rows: CompareRow[], cfg: TaxSectConfigRow | null): CachedRecord {
    return {
      taxItems:  applySectConfig(rows.map(r => r.tax), cfg),
      javaSlots: rows.map(r => ({
        field:     r.java,
        cmd:       (r.cmd === "D" || r.cmd === "I") ? r.cmd as "D" | "I" : null,
        editedRaw: r.editedRaw ?? r.java?.raw ?? "",
        fromDB:    r.cmd === "D" || r.cmd === "I",
      })),
      sectConfig: cfg,
    }
  }

  // ── 탭 스크롤 위치 복원 ──────────────────────────────────────

  function handleTabChange(rec: string) {
    if (scrollDivRef.current) scrollPosRef.current[activeRec] = scrollDivRef.current.scrollTop
    setActiveRec(rec)
    setTimeout(() => { if (scrollDivRef.current) scrollDivRef.current.scrollTop = scrollPosRef.current[rec] ?? 0 }, 0)
  }

  // ── 요약 로드 (바이트 바, 파일 상태) ──────────────────────────

  const loadSummary = useCallback(async (y: number) => {
    setChecking(true)
    try {
      const res  = await fetch(`/api/tools/media-layout/summary?year=${y}`)
      const data = await res.json()
      setHwpFile(data.hwpFile ?? null)
      setJavaFile(data.javaFile ?? null)
      setTaxBytes(data.taxBytes ?? {})
      setJavaBytes(data.javaBytes ?? {})
      setAllSectConfigs(data.sectConfigs ?? {})
    } finally { setChecking(false) }
  }, [])

  // ── 전체 레코드 한 번에 로드 (마운트/연도 변경 시) ─────────────

  const loadAllCompare = useCallback(async (y: number) => {
    setComparing(true)
    try {
      const res  = await fetch(`/api/tools/media-layout/compare?year=${y}`)
      const data = await res.json()
      const byRecord = data.byRecord as Record<string, { rows: CompareRow[]; sectConfig: TaxSectConfigRow | null }> | undefined
      if (!byRecord) { setCompareCache({}); return }
      const newCache: Record<string, CachedRecord> = {}
      for (const [rec, rd] of Object.entries(byRecord)) {
        newCache[rec] = processCompareRows(rd.rows, rd.sectConfig)
      }
      setCompareCache(newCache)
    } finally { setComparing(false) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 단일 레코드 로드 (저장 후 캐시 갱신용) ──────────────────

  const loadCompare = useCallback(async (y: number, rec: string) => {
    setComparing(true)
    try {
      const res  = await fetch(`/api/tools/media-layout/compare?record=${rec}&year=${y}`)
      const data = await res.json()
      const rows: CompareRow[] = data.rows ?? []
      const cfg:  TaxSectConfigRow | null = data.sectConfig ?? null
      setCompareCache(prev => ({ ...prev, [rec]: processCompareRows(rows, cfg) }))
    } finally { setComparing(false) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 캐시 → 표시 상태 동기화 (activeRec 변경 or 캐시 갱신 시 자동 반영)
  useEffect(() => {
    const cached = compareCache[activeRec]
    if (!cached) { setTaxItems([]); setJavaSlots([]); setSectConfig(null); return }
    setSectConfig(cached.sectConfig)
    setTaxItems(cached.taxItems)
    setJavaSlots(cached.javaSlots)
    setDirtyTax(new Map())
  }, [compareCache, activeRec])

  useEffect(() => { loadSummary(year) },    [year, loadSummary])
  useEffect(() => {
    setCompareCache({})
    loadAllCompare(year)
  }, [year]) // eslint-disable-line react-hooks/exhaustive-deps

  // 모달 드래그 / 리사이즈 전역 핸들러 (ref 기반 — 렌더 없이 추적)
  useEffect(() => {
    const MIN_W = 400, MIN_H = 280
    function onMove(e: MouseEvent) {
      const d = dragRef.current; if (!d) return
      if (d.type === "drag") {
        setModalPos({ x: d.px + e.clientX - d.ox, y: d.py + e.clientY - d.oy })
      } else {
        const dx = e.clientX - d.ox, dy = e.clientY - d.oy
        let x = d.px, y = d.py, w = d.pw, h = d.ph
        if (d.dir.includes("e")) w = Math.max(MIN_W, d.pw + dx)
        if (d.dir.includes("s")) h = Math.max(MIN_H, d.ph + dy)
        if (d.dir.includes("w")) { w = Math.max(MIN_W, d.pw - dx); x = d.px + d.pw - w }
        if (d.dir.includes("n")) { h = Math.max(MIN_H, d.ph - dy); y = d.py + d.ph - h }
        setModalPos({ x, y }); setModalSize({ w, h })
      }
    }
    function onUp() { dragRef.current = null }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup",   onUp)
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp) }
  }, [])

  // ── D / I 핸들러 ─────────────────────────────────────────────

  function handleD(idx: number) {
    const slot = javaSlots[idx]
    if (!slot || slot.fromDB) return   // 이미 저장된 D/I는 UI에서 취소 불가
    if (slot.cmd === "D") {
      setTaxItems(prev  => [...prev.slice(0, idx), ...prev.slice(idx + 1)])
      setJavaSlots(prev => prev.map((j, i) => i === idx ? { ...j, cmd: null } : j))
    } else {
      setTaxItems(prev  => [...prev.slice(0, idx), null, ...prev.slice(idx)])
      setJavaSlots(prev => prev.map((j, i) => i === idx ? { ...j, cmd: "D", fromDB: false } : j))
    }
  }

  function handleI(idx: number) {
    const slot = javaSlots[idx]
    if (slot?.cmd === "I" && slot.field === null && !slot.fromDB) {
      setJavaSlots(prev => [...prev.slice(0, idx), ...prev.slice(idx + 1)])
    } else if (!slot?.fromDB) {
      setJavaSlots(prev => [
        ...prev.slice(0, idx),
        { field: null, cmd: "I", editedRaw: "", fromDB: false },
        ...prev.slice(idx),
      ])
    }
  }

  function handleEdit(idx: number, raw: string) {
    setJavaSlots(prev => prev.map((j, i) => i === idx ? { ...j, editedRaw: raw } : j))
    setSaveMsg(null)
  }

  function handleTaxItemEdit(code: string, item: string) {
    setTaxItems(prev => prev.map(r => r?.코드 === code ? { ...r, 항목: item } : r))
    setDirtyTax(prev => { const next = new Map(prev); next.set(code, item); return next })
    setSaveMsg(null)
  }

  // ── 저장 ─────────────────────────────────────────────────────

  async function handleSave() {
    // I 슬롯 유효성 검사 — 비어 있거나 makeStr 형식이 아니면 저장 차단
    const badI = javaSlots.filter(s => s.cmd === "I" && (!s.editedRaw.trim() || !parseMakeStr(s.editedRaw)))
    if (badI.length > 0) {
      setSaveMsg({ ok: false, text: `I 행 ${badI.length}건: makeStr 입력이 없거나 형식이 올바르지 않습니다.` })
      return
    }
    setSaving(true); setSaveMsg(null)
    try {
      const y = year
      const taxItemUpdates = Array.from(dirtyTax.entries()).map(([code, item]) => ({ code, item }))
      const javaCodeUpdates = javaSlots
        .filter(s => s.field && s.editedRaw !== s.field.raw && s.cmd !== "D" && s.cmd !== "I")
        .map(s => ({ lineNo: s.field!.lineNo, javaCode: s.editedRaw }))
      const dUpdates = javaSlots
        .filter(s => s.cmd === "D" && s.field && !s.fromDB)
        .map(s => ({ lineNo: s.field!.lineNo, bodyIter: s.field!.bodyIter ?? null }))
      // I 삽입: fromDB=false인 것만, afterLineNo 포함해 역순 전달
      const iInserts = javaSlots
        .reduce((acc, s, idx) => {
          if (s.cmd === "I" && !s.fromDB && s.editedRaw.trim()) {
            const prevField = [...javaSlots.slice(0, idx)].reverse().find(j => j.field)?.field
            acc.push({
              editedRaw:     s.editedRaw,
              record:        activeRec,
              afterLineNo:   prevField?.lineNo ?? 0,
              afterBodyIter: prevField?.bodyIter ?? null,
              uiIdx:         idx,
            })
          }
          return acc
        }, [] as { editedRaw: string; record: string; afterLineNo: number; afterBodyIter: number | null; uiIdx: number }[])
        .sort((a, b) => b.uiIdx - a.uiIdx)
        .map(({ uiIdx: _ui, ...rest }) => rest)

      const res  = await fetch("/api/tools/media-layout/compare", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: y, taxItemUpdates, javaCodeUpdates, dUpdates, iInserts }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setDirtyTax(new Map())
      const total = (data.taxUpdated ?? 0) + (data.javaUpdated ?? 0) + (data.dUpdated ?? 0) + (data.iInserted ?? 0)
      setSaveMsg({ ok: true, text: `저장 완료 (${total}건)` })
      await loadCompare(y, activeRec)
      setTimeout(() => setSaveMsg(null), 3000)
    } catch (err) {
      setSaveMsg({ ok: false, text: err instanceof Error ? err.message : "저장 오류" })
    } finally { setSaving(false) }
  }

  // ── 편집 초기화 ───────────────────────────────────────────────

  async function handleReset() {
    if (!confirm(`${activeRec}-레코드의 D/I/M 편집 내역을 모두 초기화하시겠습니까?\n(MLAY_JAVA_EDIT에서 해당 레코드 항목 삭제)`)) return
    setSaving(true); setSaveMsg(null)
    try {
      const res  = await fetch(`/api/tools/media-layout/compare?record=${activeRec}&year=${year}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setSaveMsg({ ok: true, text: `초기화 완료 (${data.deleted}건 삭제)` })
      await loadCompare(year, activeRec)
      setTimeout(() => setSaveMsg(null), 3000)
    } catch (err) {
      setSaveMsg({ ok: false, text: err instanceof Error ? err.message : "초기화 오류" })
    } finally { setSaving(false) }
  }

  function handleCancel() {
    // 캐시에 저장된 마지막 확정 상태로 복원 (없으면 서버 재조회)
    const cached = compareCache[activeRec]
    if (cached) {
      setSectConfig(cached.sectConfig)
      setTaxItems(cached.taxItems)
      setJavaSlots(cached.javaSlots)
    } else {
      loadCompare(year, activeRec)
    }
    setDirtyTax(new Map()); setSaveMsg(null)
  }

  // ── Java 소스 생성 + 다운로드 ─────────────────────────────────

  async function handleGenerate() {
    setGenerating(true)
    try {
      const res  = await fetch("/api/tools/media-layout/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record: activeRec }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      const W = Math.min(860, window.innerWidth  - 80)
      const H = Math.min(640, window.innerHeight - 80)
      setModalSize({ w: W, h: H })
      setModalPos({ x: Math.round((window.innerWidth  - W) / 2), y: Math.round((window.innerHeight - H) / 2) })
      setPreviewSections(data.sections ?? [])
      setPreviewCode(data.code)
      setPreviewRec(activeRec)
    } catch (err) {
      alert(err instanceof Error ? err.message : "생성 오류")
    } finally { setGenerating(false) }
  }

  function handleDownload() {
    if (!previewCode) return
    const blob = new Blob([previewCode], { type: "text/plain;charset=utf-8" })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement("a")
    a.href = url; a.download = `${previewRec}_record.java`; a.click()
    URL.revokeObjectURL(url)
  }

  // ── 파생 계산 ─────────────────────────────────────────────────

  const maxLen = Math.max(taxItems.length, javaSlots.length)

  // makeStr 파싱 결과를 한 번만 계산 — 렌더 함수에서 매 행 정규식 재실행 방지
  const parsedSlots = useMemo(
    () => javaSlots.map(s => s.editedRaw ? parseMakeStr(s.editedRaw) : null),
    [javaSlots],
  )

  const cumData = useMemo(() => {
    let tc = 0, jc = 0
    return Array.from({ length: maxLen }, (_, i) => {
      tc += taxItems[i]?.길이 ?? 0
      if (javaSlots[i]?.cmd !== "D") {
        jc += parsedSlots[i]?.len ?? javaSlots[i]?.field?.len ?? 0
      }
      return { tc, jc }
    })
  }, [taxItems, javaSlots, parsedSlots, maxLen])

  const alignedRaws = useMemo(
    () => alignMakeStrs(javaSlots.map(s => s.editedRaw)),
    [javaSlots],
  )

  const sectBounds = useMemo(() => {
    const s = new Set<number>()
    let prev = ""
    for (let i = 0; i < taxItems.length; i++) {
      const sect = taxItems[i]?.sect ?? ""
      if (sect && sect !== prev) { s.add(i); prev = sect }
    }
    return s
  }, [taxItems])

  const finalTaxBytes  = cumData[maxLen - 1]?.tc ?? 0
  const finalJavaBytes = cumData[maxLen - 1]?.jc ?? 0

  // ── JSX ───────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">

      {/* 상태 바 */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <select value={year} onChange={e => setYear(parseInt(e.target.value))}
          className="h-8 border rounded px-2 font-mono text-sm bg-background cursor-pointer shrink-0">
          {Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - 1 - i).map(y => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>

        {/* HWP 상태 */}
        <div className="flex items-center gap-1.5 h-8 px-3 border rounded text-sm min-w-[200px] bg-orange-50">
          {checking ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
           : hwpFile ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
           : <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
          <span className="text-xs text-orange-800 font-medium shrink-0">HWP</span>
          <span className="text-xs truncate text-muted-foreground">
            {hwpFile ? `${hwpFile.hwpFileName} · ${hwpFile.rowCount.toLocaleString()}행` : "미업로드"}
          </span>
        </div>

        {/* Java 상태 */}
        <div className="flex items-center gap-1.5 h-8 px-3 border rounded text-sm min-w-[200px] bg-blue-50">
          {checking ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
           : javaFile ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
           : <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
          <span className="text-xs text-blue-800 font-medium shrink-0">Java</span>
          <span className="text-xs truncate text-muted-foreground">
            {javaFile ? `${javaFile.javaFileName} · ${javaFile.rowCount.toLocaleString()}행` : "미업로드"}
          </span>
        </div>

        <Button variant="outline" size="sm" className="shrink-0 h-8"
          onClick={() => { loadSummary(year); setCompareCache({}); loadAllCompare(year) }}
          disabled={checking || comparing}>
          <RefreshCw className={cn("h-3 w-3 mr-1", (checking || comparing) && "animate-spin")} />
          새로고침
        </Button>
      </div>

      {/* 레코드별 바이트 비교 */}
      {recList.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs shrink-0">
          <span className="text-muted-foreground font-medium shrink-0">레코드별 바이트:</span>
          {recList.map(r => {
            const t = taxBytes[r] ?? 0
            const j = javaBytes[r] ?? 0
            const ok = t > 0 && j > 0 && t === j
            const none = !t && !j
            return (
              <span key={r} className={cn(
                "inline-flex items-center rounded-full px-1.5 py-0.5 font-mono font-semibold",
                none ? "bg-gray-100 text-gray-400" : ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
              )}>
                {r}:{t||"?"}↔{j||"?"}
              </span>
            )
          })}
        </div>
      )}

      {/* 탭 + 비교 테이블 */}
      {recList.length > 0 && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-end border-b border-border gap-0.5">
            <div className="flex items-end gap-0.5 min-w-0">
              {recList.map(r => {
                const isActive = r === activeRec
                const isHbf   = allSectConfigs[r]?.sectMode === "hbf"
                const baseBg  = isHbf ? "bg-purple-100 text-purple-700" : "bg-sky-50 text-sky-700"
                const hoverBg = isHbf ? "hover:bg-purple-200" : "hover:bg-sky-100"
                const topLine = isHbf ? "border-t-[3px] border-t-purple-500" : "border-t-[3px] border-t-sky-500"
                const borderB = isHbf ? "border-b-purple-100" : "border-b-sky-50"
                return (
                  <button key={r} type="button" onClick={() => handleTabChange(r)}
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors shrink min-w-[36px] truncate max-w-[80px]",
                      baseBg,
                      isActive ? cn("font-semibold border border-border -mb-px relative z-10", topLine, borderB) : hoverBg
                    )}>
                    {r}-레코드
                  </button>
                )
              })}
            </div>

            {/* 우측 액션 */}
            <div className="ml-auto flex items-center gap-2 pb-0.5 shrink-0">
              {saveMsg && (
                <span className={`text-xs ${saveMsg.ok ? "text-green-600" : "text-destructive"}`}>{saveMsg.text}</span>
              )}
              {(() => {
                const hasChanges =
                  dirtyTax.size > 0 ||
                  javaSlots.some(s =>
                    (!s.fromDB && (s.cmd === "D" || s.cmd === "I")) ||
                    (s.field && s.editedRaw !== s.field.raw)
                  )
                return (
                  <>
                    {hasChanges && <Badge variant="outline" className="text-xs">미저장</Badge>}
                    <Button size="sm" variant="default" className="h-7 text-xs" onClick={handleSave}
                      disabled={saving || !hasChanges}>
                      {saving ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />저장 중...</> : <><Save className="h-3 w-3 mr-1" />저장</>}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleCancel}
                      disabled={saving || !hasChanges}>
                      <RotateCcw className="h-3 w-3 mr-1" />변경취소
                    </Button>
                  </>
                )
              })()}
              {(() => {
                const hasEdits = javaSlots.some(s => s.fromDB)
                return hasEdits ? (
                  <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={handleReset} disabled={saving}>
                    <RotateCcw className="h-3 w-3 mr-1" />편집초기화
                  </Button>
                ) : null
              })()}
              {maxLen > 0 && (
                <span className={cn("text-xs font-mono", finalTaxBytes !== finalJavaBytes ? "text-red-500 font-bold" : "text-green-600")}>
                  HWP {finalTaxBytes} {finalTaxBytes !== finalJavaBytes ? <><AlertTriangle className="inline h-3 w-3" /> Java {finalJavaBytes}</> : "= Java"}
                </span>
              )}
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={handleGenerate} disabled={generating || maxLen === 0}>
                {generating ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />생성 중...</> : <><Code2 className="h-3 w-3 mr-1" />Java 미리보기</>}
              </Button>
            </div>
          </div>

          <div className="border border-t-0 border-border rounded-b bg-white flex flex-col flex-1 min-h-0">
            <TaxSectInfo items={taxItems} slots={javaSlots} />
            <div ref={scrollDivRef} className="overflow-auto flex-1 text-xs">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    {/* HWP */}
                    <th className="px-2 py-1.5 border-b border-r bg-orange-50 text-orange-800 text-center w-16">코드</th>
                    <th className="px-2 py-1.5 border-b border-r bg-orange-50 text-orange-800 text-left min-w-[160px]">서식항목</th>
                    <th className="px-2 py-1.5 border-b border-r bg-orange-50 text-orange-800 text-center w-20 whitespace-nowrap">데이터타입</th>
                    <th className="px-2 py-1.5 border-b border-r bg-orange-100 text-orange-800 text-center w-12">누적</th>
                    {/* D·I·M */}
                    <th className="px-1 py-1.5 border-b border-r bg-muted text-center w-14">D·I·M</th>
                    {/* Java */}
                    <th className="px-2 py-1.5 border-b border-r bg-blue-50 text-blue-800 text-left min-w-[160px]">서식항목</th>
                    <th className="px-2 py-1.5 border-b border-r bg-blue-50 text-blue-800 text-left min-w-[360px] whitespace-nowrap">makeStr</th>
                    <th className="px-2 py-1.5 border-b border-r bg-blue-50 text-blue-800 text-center w-18 whitespace-nowrap">데이터타입</th>
                    <th className="px-2 py-1.5 border-b border-r bg-blue-50 text-blue-800 text-center w-10">행</th>
                    <th className="px-2 py-1.5 border-b bg-blue-100 text-blue-800 text-center w-12">누적</th>
                  </tr>
                </thead>
                <tbody>
                  {comparing ? (
                    <tr><td colSpan={10} className="text-center py-10 text-muted-foreground">
                      <Loader2 className="inline h-4 w-4 animate-spin mr-2" />불러오는 중...
                    </td></tr>
                  ) : maxLen === 0 ? (
                    <tr><td colSpan={10} className="text-center py-10 text-muted-foreground">
                      데이터가 없습니다. HWP와 Java 소스를 먼저 업로드하세요.
                    </td></tr>
                  ) : (
                    Array.from({ length: maxLen }).flatMap((_, i) => {
                      const tax  = taxItems[i] ?? null
                      const slot = javaSlots[i] ?? { field: null, cmd: null as null, editedRaw: "" }
                      const isD  = slot.cmd === "D"
                      const isI  = slot.cmd === "I" && slot.field === null
                      const isM  = !isD && !isI && !!slot.field && slot.editedRaw !== slot.field.raw
                      const parsedMake   = parsedSlots[i]
                      const makeValid    = !slot.editedRaw || parsedMake !== null
                      const effDtype     = parsedMake?.dtype ?? slot.field?.dtype ?? ""
                      const effLen       = parsedMake?.len   ?? slot.field?.len   ?? 0
                      const mismatch     = !isD && !isI && !!tax &&
                        (tax.타입 !== effDtype || tax.길이 !== effLen)
                      const itemMismatch = !isD && !isI && !!tax && !!slot.field &&
                        tax.항목?.replace(/\s+/g, '') !== slot.field.name?.replace(/\s+/g, '')
                      const { tc, jc } = cumData[i] ?? { tc: 0, jc: 0 }
                      const rowBg = isD ? "bg-red-50" : isI ? "bg-yellow-50" : mismatch ? "bg-amber-50" : isM ? "bg-blue-50" : taxSectBg(tax?.sect ?? "")

                      const nodes = []
                      if (sectBounds.has(i)) nodes.push(<SectSep key={`sep-${i}`} sect={tax?.sect ?? ""} colSpan={10} />)
                      nodes.push(
                        <tr key={i} className={cn("border-b hover:brightness-[0.97] transition-colors", rowBg)}>
                          {/* HWP */}
                          <td className="px-2 py-1 border-r font-mono font-semibold text-center">{tax?.코드 ?? ""}</td>
                          <td className={cn("px-1 py-0.5 border-r min-w-[160px]", itemMismatch && "bg-orange-50")}>
                            {tax ? (
                              <input
                                value={tax.항목 ?? ""}
                                onChange={e => handleTaxItemEdit(tax.코드, e.target.value)}
                                className={cn("w-full text-xs px-1 py-0.5 rounded border-0 bg-transparent focus:bg-white focus:border focus:border-primary outline-none break-keep",
                                  itemMismatch && "text-orange-600 font-medium",
                                  dirtyTax.has(tax.코드) && "bg-amber-50")}
                              />
                            ) : ""}
                          </td>
                          <td className={cn("px-2 py-1 border-r text-center font-mono", mismatch && "text-red-600 font-bold")}>
                            {tax ? `${tax.타입 ?? "?"}(${tax.길이 ?? "?"})` : ""}
                          </td>
                          <td className={cn("px-2 py-1 border-r text-right font-mono tabular-nums", tc !== jc && tc > 0 ? "text-red-600 font-bold" : tc > 0 ? "text-green-700" : "")}>
                            {tc > 0 ? tc : ""}
                          </td>
                          {/* D·I·M */}
                          <td className="px-1 py-1 border-r">
                            <div className="flex gap-0.5 justify-center">
                              <button onClick={() => handleD(i)} disabled={isI || (slot.field === null && !isD) || slot.fromDB}
                                className={cn("w-5 h-5 rounded text-[10px] font-bold transition-colors disabled:opacity-20",
                                  isD ? "bg-red-500 text-white" : "border border-border text-muted-foreground hover:border-red-400 hover:text-red-500")}>D</button>
                              <button onClick={() => handleI(i)} disabled={isD}
                                className={cn("w-5 h-5 rounded text-[10px] font-bold transition-colors disabled:opacity-20",
                                  isI ? "bg-yellow-500 text-white" : "border border-border text-muted-foreground hover:border-yellow-400 hover:text-yellow-600")}>I</button>
                              <span className={cn("w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center select-none",
                                isM ? "bg-blue-500 text-white" : "border border-border text-muted-foreground/30")}>M</span>
                            </div>
                          </td>
                          {/* Java */}
                          {/* Java 서식항목 */}
                          <td className={cn("px-2 py-0.5 border-r text-xs min-w-[160px] break-keep", itemMismatch && "text-orange-600 font-medium")}>{slot.field?.name ?? ""}</td>
                          {/* makeStr */}
                          <td className="px-2 py-1 border-r font-mono whitespace-nowrap">
                            {isD ? (
                              <span className="line-through text-red-400 text-[11px]">{alignedRaws[i]}</span>
                            ) : isI ? (
                              <input value={slot.editedRaw} onChange={e => handleEdit(i, e.target.value)}
                                placeholder='makeStr("x", 10, ...) 형식으로 입력'
                                className={cn(
                                  "w-full rounded px-1 py-1 font-mono text-[11px] outline-none",
                                  slot.editedRaw.trim() && !parseMakeStr(slot.editedRaw)
                                    ? "bg-red-50 border border-red-400 focus:border-red-500"
                                    : "bg-yellow-50 border border-yellow-300 focus:border-yellow-500"
                                )} />
                            ) : (
                              <input value={slot.editedRaw} onChange={e => handleEdit(i, e.target.value)}
                                className={cn("w-full bg-transparent outline-none font-mono text-[11px] py-1",
                                  makeValid
                                    ? "border-0 focus:bg-white focus:border focus:border-primary focus:rounded focus:px-1"
                                    : "border border-red-400 rounded px-1 bg-red-50",
                                  isM && makeValid && "text-blue-700")} />
                            )}
                          </td>
                          <td className={cn("px-2 py-1 border-r text-center font-mono", mismatch && "text-red-600 font-bold", !makeValid && "text-red-400 line-through")}>
                            {effDtype && effLen ? `${effDtype}(${effLen})` : ""}
                          </td>
                          <td className="px-2 py-1 border-r text-center text-muted-foreground/60 tabular-nums">{slot.field?.lineNo ?? ""}</td>
                          <td className={cn("px-2 py-1 text-right font-mono tabular-nums", tc !== jc && jc > 0 ? "text-red-600 font-bold" : jc > 0 ? "text-green-700" : "")}>
                            {jc > 0 ? jc : ""}
                          </td>
                        </tr>
                      )
                      return nodes
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 데이터 없을 때 안내 */}
      {recList.length === 0 && !checking && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          HWP 파일과 Java 소스를 먼저 업로드하세요.
        </div>
      )}

      {/* Java 소스 미리보기 — 드래그·리사이즈 가능 */}
      {previewCode !== null && (
        <>
          {/* 배경 딤 */}
          <div className="fixed inset-0 z-50 bg-black/40" />

          {/* 모달 */}
          <div
            className="fixed z-[51] flex flex-col bg-white rounded-lg shadow-2xl border border-border overflow-hidden"
            style={{ left: modalPos.x, top: modalPos.y, width: modalSize.w, height: modalSize.h }}
          >
            {/* ── 드래그 핸들 (헤더) ── */}
            <div
              className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/30 shrink-0 rounded-t-lg cursor-grab active:cursor-grabbing select-none"
              onMouseDown={e => {
                e.preventDefault()
                dragRef.current = { type: "drag", ox: e.clientX, oy: e.clientY, px: modalPos.x, py: modalPos.y }
              }}
            >
              <Code2 className="h-4 w-4 text-blue-600 pointer-events-none" />
              <span className="text-sm font-semibold pointer-events-none">{previewRec}-레코드 Java 소스 미리보기</span>
              <div className="ml-auto flex items-center gap-2" onMouseDown={e => e.stopPropagation()}>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleDownload}>
                  <Download className="h-3 w-3 mr-1" />다운로드
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPreviewCode(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* ── 섹션별 코드 박스 ── */}
            <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3 bg-gray-50">
              {previewSections.map((sec, si) => {
                const isHeader  = sec.sect === "header"
                const isFooter  = sec.sect === "footer"
                const isBodySum = sec.sect === "body_sum"
                const bodyNum   = sec.sect.match(/^body_(\d+)$/)?.[1]
                const BODY_BG   = ["bg-purple-50","bg-violet-50","bg-indigo-50","bg-blue-50"]
                const BODY_HDR  = ["bg-purple-200 text-purple-800","bg-violet-200 text-violet-800","bg-indigo-200 text-indigo-800","bg-blue-200 text-blue-800"]
                const boxBg  = isHeader  ? "bg-gray-50"
                             : isFooter  ? "bg-teal-50"
                             : isBodySum ? "bg-amber-50"
                             : BODY_BG[(parseInt(bodyNum ?? "1") - 1) % BODY_BG.length]
                const hdrCls = isHeader  ? "bg-gray-200 text-gray-700"
                             : isFooter  ? "bg-teal-200 text-teal-800"
                             : isBodySum ? "bg-amber-200 text-amber-800"
                             : BODY_HDR[(parseInt(bodyNum ?? "1") - 1) % BODY_HDR.length]
                const lineCount = isBodySum
                  ? `${sec.lines.filter(l => !l.includes('+ "\\n"')).length}그룹`
                  : `${sec.lines.filter(l => !l.includes('+ "\\n"')).length}행`
                return (
                  <SectionBox key={si} boxBg={boxBg} hdrCls={hdrCls} label={sec.label} lineCount={lineCount} lines={sec.lines} />
                )
              })}
            </div>

            {/* ── 리사이즈 핸들 (8방향) ── */}
            {(["n","s","e","w"] as const).map(dir => (
              <div key={dir}
                className={cn("absolute z-10",
                  dir === "n" && "top-0    left-2  right-2 h-1 cursor-n-resize",
                  dir === "s" && "bottom-0 left-2  right-2 h-1 cursor-s-resize",
                  dir === "w" && "left-0   top-2 bottom-2  w-1 cursor-w-resize",
                  dir === "e" && "right-0  top-2 bottom-2  w-1 cursor-e-resize",
                )}
                onMouseDown={e => {
                  e.preventDefault(); e.stopPropagation()
                  dragRef.current = { type: "resize", dir, ox: e.clientX, oy: e.clientY, px: modalPos.x, py: modalPos.y, pw: modalSize.w, ph: modalSize.h }
                }}
              />
            ))}
            {(["nw","ne","sw","se"] as const).map(dir => (
              <div key={dir}
                className={cn("absolute z-10 w-3 h-3",
                  dir === "nw" && "top-0    left-0  cursor-nw-resize",
                  dir === "ne" && "top-0    right-0 cursor-ne-resize",
                  dir === "sw" && "bottom-0 left-0  cursor-sw-resize",
                  dir === "se" && "bottom-0 right-0 cursor-se-resize",
                )}
                onMouseDown={e => {
                  e.preventDefault(); e.stopPropagation()
                  dragRef.current = { type: "resize", dir, ox: e.clientX, oy: e.clientY, px: modalPos.x, py: modalPos.y, pw: modalSize.w, ph: modalSize.h }
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
