"use client"

import { useRef, useState, useCallback, useEffect, useLayoutEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FileText, CheckCircle2, AlertCircle, Loader2, Save, Trash2, RotateCcw, HelpCircle, Table2, X, Maximize2, Minimize2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { TaxRow, HwpFileRow, TaxSectConfigRow, ItemNoteRow } from "@/lib/tax-oracle"
import { ItemNoteSticker, NoteMarkButton } from "./ItemNoteSticker"
import { useSidebar } from "@/components/ui/sidebar"

const RECORD_TYPES = ["A","B","C","D","E","F","G","H","I","K"]

// ── 파싱 변환 diff (원본 → 변환값, 제거된 문자 강조) ────────────

function diffOrig(orig: string, clean: string | null): { text: string; removed: boolean }[] {
  if (!clean) return [{ text: orig, removed: true }]
  const m = orig.length, n = clean.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = orig[i-1] === clean[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1])
  const segs: { text: string; removed: boolean }[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && orig[i-1] === clean[j-1]) { segs.unshift({ text: orig[i-1], removed: false }); i--; j-- }
    else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) j--
    else { segs.unshift({ text: orig[i-1], removed: true }); i-- }
  }
  // 연속 같은 타입 병합
  return segs.reduce<{ text: string; removed: boolean }[]>((acc, s) => {
    const last = acc[acc.length - 1]
    if (last && last.removed === s.removed) { last.text += s.text; return acc }
    return [...acc, { ...s }]
  }, [])
}

// ── 일괄 섹션 적용 ─────────────────────────────────────────────

interface BulkConfig { bodyStart: number; bodyEnd: number; divideBy: number }

// ── 반복 구간 자동 감지 ────────────────────────────────────────
// item(서식항목명) 시퀀스의 반복 패턴 + 바이트 합 일치로 body 구간 확정.
// 가장 많이 반복되는 후보를 최적 결과로 선택.

function detectInterval(rows: TaxRow[]): BulkConfig | null {
  if (rows.length < 2) return null

  const lens = rows.map(r => r.fieldLen ?? 0)
  let best: BulkConfig | null = null

  const selectBest = (candidate: BulkConfig) => {
    const curUL = best ? (best.bodyEnd - best.bodyStart + 1) / best.divideBy : 0
    const newUL = (candidate.bodyEnd - candidate.bodyStart + 1) / candidate.divideBy
    if (!best || candidate.divideBy > best.divideBy ||
        (candidate.divideBy === best.divideBy && newUL > curUL)) {
      best = candidate
    }
  }

  // ── 전략 1: GUBUN 변경점 기반 반복 감지 ──────────────────────
  // currentGubun이 행마다 전파되므로, 같은 값이 연속되는 것은 무시하고
  // GUBUN 값이 바뀌는 시점의 위치만 수집한다.
  const gubunChangePos = new Map<string, number[]>()
  let prevG = ""
  for (let i = 0; i < rows.length; i++) {
    const g = rows[i].gubun?.trim() ?? ""
    if (g && g !== prevG) {
      const arr = gubunChangePos.get(g) ?? []
      arr.push(i)
      gubunChangePos.set(g, arr)
      prevG = g
    }
  }

  for (const positions of gubunChangePos.values()) {
    if (positions.length < 2) continue
    const s       = positions[0]
    const unitLen = positions[1] - s
    if (unitLen <= 0) continue
    const allUniform = positions.every((p, i) => p === s + i * unitLen)
    if (!allUniform) continue
    selectBest({ bodyStart: s + 1, bodyEnd: s + unitLen * positions.length, divideBy: positions.length })
  }

  if (best) return best

  // ── 전략 2: 항목명 + fieldLen 시퀀스 일치 (GUBUN 없는 레코드 대비) ──
  const items  = rows.map(r => (r.item ?? "").replace(/\s+/g, " ").trim())
  const PADDING = new Set(["공란", "예비", "여백", "미사용", "사용안함", "reserved", "계"])

  const itemPos = new Map<string, number[]>()
  for (let i = 0; i < items.length; i++) {
    const v = items[i]
    if (!v || PADDING.has(v)) continue
    const arr = itemPos.get(v) ?? []
    arr.push(i)
    itemPos.set(v, arr)
  }

  for (const positions of itemPos.values()) {
    if (positions.length < 2) continue
    const s       = positions[0]
    const unitLen = positions[1] - s
    // 항목명 시퀀스 일치 검증, 불일치 시 fieldLen 시퀀스로 대체 검증 (항목명이 body마다 미세하게 다른 경우 대비)
    const unitItems = items.slice(s, s + unitLen).join("|")
    const unitLens  = lens.slice(s, s + unitLen).join(",")
    const itemSeqOk = items.slice(positions[1], positions[1] + unitLen).join("|") === unitItems
    const lenSeqOk  = lens.slice(positions[1], positions[1] + unitLen).join(",") === unitLens
    if (!itemSeqOk && !lenSeqOk) continue

    // bodyStart를 앞으로 확장 (BODY_1의 실제 시작점 탐색)
    let actualStart = s
    while (actualStart > 0) {
      const prev = actualStart - 1
      if (prev + unitLen >= rows.length) break
      if (lens[prev] !== lens[prev + unitLen]) break
      actualStart--
    }

    // actualStart 기준 BODY_1 fieldLen으로 재카운팅 → 나머지는 FOOTER
    const actualUnitLens = lens.slice(actualStart, actualStart + unitLen).join(",")
    let repeatCount = 0, pos = actualStart
    while (pos + unitLen <= rows.length &&
           lens.slice(pos, pos + unitLen).join(",") === actualUnitLens) {
      repeatCount++; pos += unitLen
    }
    if (repeatCount < 2) continue

    selectBest({ bodyStart: actualStart + 1, bodyEnd: actualStart + unitLen * repeatCount, divideBy: repeatCount })
  }

  return best
}

function applyBulk(rows: TaxRow[], cfg: BulkConfig): TaxRow[] {
  const { bodyStart, bodyEnd, divideBy } = cfg
  const unitLen = Math.max(1, Math.floor(Math.max(1, bodyEnd - bodyStart + 1) / divideBy))
  return rows.map((r, i) => {
    const n = i + 1
    if (n < bodyStart)  return { ...r, sect: "header" }
    if (n > bodyEnd)    return { ...r, sect: "footer" }
    const bodyNum = Math.min(divideBy, Math.floor((n - bodyStart) / unitLen) + 1)
    return { ...r, sect: `body_${bodyNum}` }
  })
}

// ── 섹션 행 배경색 ───────────────────────────────────────────

const BODY_BG = ["bg-purple-50", "bg-violet-50", "bg-indigo-50", "bg-blue-50"]
function bodyIdx(sect: string) { const m = sect.match(/^body_(\d+)$/); return m ? parseInt(m[1]) : 0 }
function sectRowBg(sect: string): string {
  if (sect === "header") return "bg-gray-50"
  if (sect === "footer") return "bg-teal-50"
  if (sect.startsWith("body_")) return BODY_BG[(bodyIdx(sect) - 1) % BODY_BG.length]
  return ""
}

// ── 섹션 구분선 ───────────────────────────────────────────────

function SectSep({ sect, maxBody }: { sect: string; maxBody: number }) {
  const isHead = sect === "header"
  const isFoot = sect === "footer"
  const num    = bodyIdx(sect)
  // body_1만 있을 때(maxBody===1)는 Header로 표시
  const treatAsHead = isHead || (num === 1 && maxBody === 1)
  const bg    = treatAsHead ? "bg-gray-200"  : isFoot ? "bg-teal-100"  : BODY_BG[(num - 1) % BODY_BG.length]
  const txt   = treatAsHead ? "text-gray-600": isFoot ? "text-teal-700": "text-purple-700"
  const label = treatAsHead ? "▸ Header"     : isFoot ? "▸ Footer"     : `▸ Body-${num}`
  return (
    <tr className={`${bg} border-y`}>
      <td colSpan={6} className={`px-3 py-0.5 text-[11px] font-semibold ${txt} select-none`}>
        {label}
      </td>
    </tr>
  )
}

// ── BulkSectPanel ─────────────────────────────────────────────

function BulkSectPanel({ totalRows, recFields, applying, msg, config, onApply, codeModCount, itemModCount }: {
  totalRows:    number
  recFields:    TaxRow[]
  applying:     boolean
  msg:          { ok: boolean; text: string } | null
  config:       TaxSectConfigRow | null
  onApply:      (cfg: BulkConfig | null) => void
  codeModCount: number
  itemModCount: number
}) {
  const recLetter = recFields[0]?.recordType ?? ""
  const toNum = (row: number) => {
    const c = recFields[row - 1]?.code ?? ""
    return c.startsWith(recLetter) ? c.slice(recLetter.length) : c
  }
  const fromNum = (num: string) => {
    const idx = recFields.findIndex(f => f.code === recLetter + num.trim())
    return idx >= 0 ? idx + 1 : null
  }

  const initMode: "body"|"hbf" = config?.sectMode === "hbf" ? "hbf" : "body"
  const initCfg: BulkConfig = {
    bodyStart: config?.bodyStart ?? 1,
    bodyEnd:   config?.bodyEnd   ?? 1,
    divideBy:  config?.repeatCount ?? 1,
  }

  const [mode,     setMode]     = useState<"body"|"hbf">(initMode)
  const [cfg,      setCfg]      = useState<BulkConfig>(initCfg)
  const [startNum, setStartNum] = useState(() => toNum(initCfg.bodyStart))
  const [endNum,   setEndNum]   = useState(() => toNum(initCfg.bodyEnd))
  const [startErr, setStartErr] = useState(false)
  const [endErr,   setEndErr]   = useState(false)
  const [appliedMode, setAppliedMode] = useState<"body"|"hbf">(initMode)
  const [appliedCfg,  setAppliedCfg]  = useState<BulkConfig>(initCfg)

  const onStart = (v: string) => { setStartNum(v); const r = fromNum(v); r ? (setStartErr(false), setCfg(p => ({ ...p, bodyStart: r }))) : setStartErr(true) }
  const onEnd   = (v: string) => { setEndNum(v);   const r = fromNum(v); r ? (setEndErr(false),   setCfg(p => ({ ...p, bodyEnd:   r }))) : setEndErr(true)   }

  const bodyLen  = Math.max(0, cfg.bodyEnd - cfg.bodyStart + 1)
  const unitLen  = cfg.divideBy > 0 ? Math.floor(bodyLen / cfg.divideBy) : 0
  const hasErr   = startErr || endErr

  const hasChanges = mode !== appliedMode || (
    mode === "hbf" && (
      cfg.bodyStart !== appliedCfg.bodyStart ||
      cfg.bodyEnd   !== appliedCfg.bodyEnd   ||
      cfg.divideBy  !== appliedCfg.divideBy
    )
  )

  function handleApply() {
    setAppliedMode(mode)
    setAppliedCfg(cfg)
    onApply(mode === "hbf" ? cfg : null)
  }

  return (
    <div className="flex items-center gap-3 text-xs flex-wrap bg-muted/30 px-3 py-2 border-b">
      <span className="text-muted-foreground shrink-0">구조설정:</span>
      <label className="flex items-center gap-1 cursor-pointer shrink-0">
        <input type="radio" checked={mode === "body"} onChange={() => setMode("body")} className="w-3 h-3" />
        <span className={mode === "body" ? "text-sky-700 font-medium" : ""}>Header 구조</span>
      </label>
      <label className="flex items-center gap-1 cursor-pointer shrink-0">
        <input type="radio" checked={mode === "hbf"} onChange={() => setMode("hbf")} className="w-3 h-3" />
        <span className={mode === "hbf" ? "text-purple-700 font-medium" : ""}>Header/Body/Footer 구조</span>
      </label>

      {mode === "hbf" && (
        <>
          <span className="text-muted-foreground ml-2">Body 구간</span>
          <div className="flex items-center">
            <span className="font-mono text-sm font-semibold text-muted-foreground pr-0.5">{recLetter}</span>
            <input type="text" value={startNum} onChange={e => onStart(e.target.value)} maxLength={3}
              className={cn("w-10 h-6 border rounded px-1 text-center bg-background font-mono", startErr && "border-red-400 text-red-600")} />
          </div>
          <span className="text-muted-foreground">~</span>
          <div className="flex items-center">
            <span className="font-mono text-sm font-semibold text-muted-foreground pr-0.5">{recLetter}</span>
            <input type="text" value={endNum} onChange={e => onEnd(e.target.value)} maxLength={3}
              className={cn("w-10 h-6 border rounded px-1 text-center bg-background font-mono", endErr && "border-red-400 text-red-600")} />
          </div>
          <span className="text-muted-foreground">등분</span>
          <input type="number" min={1} max={99} value={cfg.divideBy}
            onChange={e => setCfg(p => ({ ...p, divideBy: Math.max(1, Math.min(99, +e.target.value)) }))}
            className="w-11 h-6 border rounded px-1 text-center bg-background" />
          {!hasErr && totalRows > 0 && (
            <>
              <span className="text-muted-foreground tabular-nums">
                전체 {totalRows}행 · BODY {bodyLen}행 ÷ {cfg.divideBy} = {unitLen}행×{cfg.divideBy}
              </span>
              {(() => {
                if (cfg.divideBy < 2 || unitLen === 0) return null
                const sectionBytes = Array.from({ length: cfg.divideBy }, (_, i) => {
                  const start = cfg.bodyStart + i * unitLen - 1
                  const end   = i === cfg.divideBy - 1 ? cfg.bodyEnd : cfg.bodyStart + (i + 1) * unitLen - 1
                  return recFields.slice(start, end).reduce((s, r) => s + (r.fieldLen ?? 0), 0)
                })
                const allEqual = sectionBytes.every(b => b === sectionBytes[0])
                return allEqual ? (
                  <span className="tabular-nums font-mono text-green-600">
                    [전체동일:{sectionBytes[0]}]
                  </span>
                ) : (
                  <span className="tabular-nums font-mono text-red-500">
                    {sectionBytes.map((b, i) => `${recLetter}${i + 1}:${b}`).join(" ")}
                  </span>
                )
              })()}
            </>
          )}
          {hasErr && <span className="text-red-500">항목 번호를 찾을 수 없습니다</span>}
        </>
      )}

      <Button size="sm" className="h-6 text-xs px-3" disabled={applying || !hasChanges || (mode === "hbf" && hasErr)}
        onClick={handleApply}>
        {applying ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />적용중...</> : "설정 적용"}
      </Button>
      {msg && !applying && (
        <span className={`text-xs font-medium ${msg.ok ? "text-green-600" : "text-destructive"}`}>
          {msg.ok ? <><CheckCircle2 className="inline h-3 w-3 mr-0.5" />{msg.text}</> : msg.text}
        </span>
      )}

      {(codeModCount > 0 || itemModCount > 0) && (
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {codeModCount > 0 && (
            <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded text-[11px] font-medium">
              번호 수정 <strong className="font-bold">{codeModCount}</strong>건
            </span>
          )}
          {itemModCount > 0 && (
            <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded text-[11px] font-medium">
              서식항목 수정 <strong className="font-bold">{itemModCount}</strong>건
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ── HwpStep ───────────────────────────────────────────────────

export function HwpStep() {
  const fileRef = useRef<HTMLInputElement>(null)

  // 업로드 상태
  const [file,      setFile]      = useState<File | null>(null)
  const [year,      setYear]      = useState(() => new Date().getFullYear() - 1)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState("")

  // 편집 상태
  const [byRecord,    setByRecord]    = useState<Record<string, TaxRow[]>>({})
  const [sectConfigs, setSectConfigs] = useState<Record<string, TaxSectConfigRow>>({})
  const [dirty,       setDirty]       = useState<Map<number, TaxRow>>(new Map())
  const [activeRec, setActiveRec] = useState("A")
  const [saving,       setSaving]       = useState(false)
  const [saveMsg,      setSaveMsg]      = useState<{ ok: boolean; text: string } | null>(null)
  const [sectApplying, setSectApplying] = useState(false)
  const [sectMsg,      setSectMsg]      = useState<{ ok: boolean; text: string } | null>(null)
  const [checking,     setChecking]     = useState(false)
  const [hwpFile,   setHwpFile]   = useState<HwpFileRow | null>(null)
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const [deleting,  setDeleting]  = useState(false)

  const [helpOpen,  setHelpOpen]  = useState(false)
  const [helpTab,   setHelpTab]   = useState<"usage" | "how">("usage")
  const [panelKey,  setPanelKey]  = useState(0)
  const [autoMsg,      setAutoMsg]      = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmState, setConfirmState] = useState<{
    title: string; lines: string[]; danger?: string; onConfirm: () => void
  } | null>(null)

  // 주목 노트
  const [notes,       setNotes]       = useState<Record<string, ItemNoteRow>>({}) // key: `${rec}-${code}`
  const [openNoteKey, setOpenNoteKey] = useState<string | null>(null)

  // 파싱 변환 로그
  const [parseLogOpen,    setParseLogOpen]    = useState(false)
  const [logicOpen,       setLogicOpen]       = useState(false)
  const [parseLogs,       setParseLogs]       = useState<{ recordType: string; code: string; origText: string; cleanText: string | null }[]>([])
  const [parseLogLoading, setParseLogLoading] = useState(false)
  const [parseLogSelIdx,  setParseLogSelIdx]  = useState<number | null>(null)
  const [logPos,  setLogPos]  = useState({ x: 0, y: 0 })
  const [logSize, setLogSize] = useState({ w: 640, h: 500 })

  const [isFullscreen, setIsFullscreen] = useState(false)
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar()
  const sidebarOpenBeforeFullscreen = useRef<boolean>(true)
  function handleToggleFullscreen() {
    if (!isFullscreen) {
      sidebarOpenBeforeFullscreen.current = sidebarOpen
      setSidebarOpen(false)
      sessionStorage.setItem('ytsmfs', '1')
    } else {
      setSidebarOpen(sidebarOpenBeforeFullscreen.current)
      sessionStorage.removeItem('ytsmfs')
    }
    setIsFullscreen(v => !v)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (sessionStorage.getItem('ytsmfs') === '1') { setIsFullscreen(true); setSidebarOpen(false) }
  }, [])
  useEffect(() => {
    const btn = document.querySelector<HTMLElement>('[data-sidebar="trigger"]')
    if (!btn) return
    if (isFullscreen) { btn.style.pointerEvents = "none"; btn.style.opacity = "0.3" }
    else              { btn.style.pointerEvents = "";     btn.style.opacity = "" }
  }, [isFullscreen])
  const logDragRef = useRef<null | {
    type: "drag";   ox: number; oy: number; px: number; py: number
  } | {
    type: "resize"; dir: string; ox: number; oy: number; px: number; py: number; pw: number; ph: number
  }>(null)

  // 파싱 로그 모달 드래그·리사이즈
  useEffect(() => {
    const MIN_W = 400, MIN_H = 260
    function onMove(e: MouseEvent) {
      const d = logDragRef.current; if (!d) return
      if (d.type === "drag") {
        setLogPos({ x: d.px + e.clientX - d.ox, y: d.py + e.clientY - d.oy })
      } else {
        const dx = e.clientX - d.ox, dy = e.clientY - d.oy
        let x = d.px, y = d.py, w = d.pw, h = d.ph
        if (d.dir.includes("e")) w = Math.max(MIN_W, d.pw + dx)
        if (d.dir.includes("s")) h = Math.max(MIN_H, d.ph + dy)
        if (d.dir.includes("w")) { w = Math.max(MIN_W, d.pw - dx); x = d.px + d.pw - w }
        if (d.dir.includes("n")) { h = Math.max(MIN_H, d.ph - dy); y = d.py + d.ph - h }
        setLogPos({ x, y }); setLogSize({ w, h })
      }
    }
    function onUp() { logDragRef.current = null }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup",   onUp)
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp) }
  }, [])

  async function handleParseLogOpen() {
    if (!parseLogOpen) {
      const W = Math.min(640, window.innerWidth  - 80)
      const H = Math.min(500, window.innerHeight - 80)
      setLogSize({ w: W, h: H })
      setLogPos({ x: Math.round((window.innerWidth  - W) / 2), y: Math.round((window.innerHeight - H) / 2) })
    }
    setParseLogOpen(true)
    setLogicOpen(false)
    if (parseLogs.length > 0) return
    setParseLogLoading(true)
    try {
      const res = await fetch(`/api/tools/media-layout/parse-log?year=${year}`)
      const data = await res.json()
      setParseLogs(data.logs ?? [])
    } finally {
      setParseLogLoading(false)
    }
  }

  const hasRows = Object.keys(byRecord).length > 0
  const recList = RECORD_TYPES.filter(r => byRecord[r]?.length)

  const scrollDivRef  = useRef<HTMLDivElement>(null)
  const scrollPosRef  = useRef<Record<string, number>>({})

  function handleTabChange(rec: string) {
    if (scrollDivRef.current) {
      scrollPosRef.current[activeRec] = scrollDivRef.current.scrollTop
    }
    setActiveRec(rec)
    setParseLogSelIdx(null)
    setTimeout(() => {
      if (scrollDivRef.current) {
        scrollDivRef.current.scrollTop = scrollPosRef.current[rec] ?? 0
      }
    }, 0)
  }

  // ── 로드 ───────────────────────────────────────────────────

  const loadRows = useCallback(async (y: number) => {
    setChecking(true)
    try {
      const [rowsRes, fileRes] = await Promise.all([
        fetch(`/api/tools/media-layout/tax-rows?year=${y}`),
        fetch(`/api/tools/media-layout/upload?year=${y}`),
      ])
      const [rowsData, fileData] = await Promise.all([rowsRes.json(), fileRes.json()])

      setHwpFile(fileData.upload ?? null)

      const all: TaxRow[] = rowsData.rows ?? []
      const grouped: Record<string, TaxRow[]> = {}
      for (const row of all) {
        if (!grouped[row.recordType]) grouped[row.recordType] = []
        grouped[row.recordType].push(row)
      }
      setByRecord(grouped)
      setSectConfigs(rowsData.sectConfigs ?? {})
      setDirty(new Map())
      setSaveMsg(null)
      setActiveRec(prev => {
        const keys = Object.keys(grouped).sort()
        return keys.includes(prev) ? prev : (keys[0] ?? "A")
      })
    } finally { setChecking(false) }
  }, [])

  // 마운트 및 연도 변경 시 기존 데이터 자동 로드
  useEffect(() => { loadRows(year) }, [year, loadRows])

  // Escape 키: confirm 다이얼로그 → 파싱 로그 팝업 순으로 닫기
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (confirmState)  { setConfirmState(null);   return }
      if (parseLogOpen)  { setParseLogOpen(false) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [confirmState, parseLogOpen])

  const notesRef = useRef(notes)
  useEffect(() => { notesRef.current = notes }, [notes])

  useEffect(() => {
    if (!openNoteKey) return
    const key = openNoteKey
    function handle(e: PointerEvent) {
      if (!(e.target as Element).closest?.("[data-note-popup]")) {
        const note = notesRef.current[key]
        if (note && !note.memo.trim()) {
          const sep = key.indexOf("-")
          handleNoteDelete(key.slice(0, sep), key.slice(sep + 1))
        } else {
          setOpenNoteKey(null)
        }
      }
    }
    document.addEventListener("pointerdown", handle)
    return () => document.removeEventListener("pointerdown", handle)
  }, [openNoteKey])

  // ── 주목 노트 로드 ──────────────────────────────────────────

  const loadNotes = useCallback(async (y: number) => {
    try {
      const res  = await fetch(`/api/tools/media-layout/item-notes?year=${y}`)
      const data = await res.json()
      const map: Record<string, ItemNoteRow> = {}
      for (const n of (data.notes ?? []) as ItemNoteRow[]) {
        map[`${n.recordType}-${n.code}`] = n
      }
      setNotes(map)
    } catch {}
  }, [])

  useEffect(() => { loadNotes(year) }, [year, loadNotes])

  async function handleNoteSave(rec: string, code: string, patch: Partial<Pick<ItemNoteRow, "memo" | "isDone" | "color">>) {
    const key     = `${rec}-${code}`
    const current = notes[key]
    const next: ItemNoteRow = {
      year, userId: 0, recordType: rec, code,
      memo:    patch.memo    ?? current?.memo    ?? "",
      isDone:  patch.isDone  ?? current?.isDone  ?? false,
      color:   patch.color   ?? current?.color   ?? "yellow",
      createdAt: current?.createdAt ?? "",
      updatedAt: new Date().toISOString(),
    }
    setNotes(prev => ({ ...prev, [key]: next }))
    await fetch("/api/tools/media-layout/item-notes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, recordType: rec, code, ...patch }),
    })
  }

  async function handleNoteCreate(rec: string, code: string) {
    const key = `${rec}-${code}`
    if (!notes[key]) await handleNoteSave(rec, code, { memo: "", isDone: false, color: "yellow" })
    setOpenNoteKey(key)
  }

  async function handleNoteDelete(rec: string, code: string) {
    const key = `${rec}-${code}`
    setNotes(prev => { const n = { ...prev }; delete n[key]; return n })
    setOpenNoteKey(null)
    await fetch(`/api/tools/media-layout/item-notes?year=${year}&record=${rec}&code=${encodeURIComponent(code)}`, { method: "DELETE" })
  }

  // ── 업로드 ─────────────────────────────────────────────────

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.match(/\.hwp$/i)) { setUploadErr("HWP 파일만 허용됩니다."); return }
    setFile(f); setUploadErr("")
  }

  async function doUpload() {
    if (!file) return
    setUploading(true); setUploadErr(""); setSaveMsg(null)
    try {
      const form = new FormData()
      form.append("year", String(year))
      form.append("hwp",  file)
      const res  = await fetch("/api/tools/media-layout/upload", { method: "POST", body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setByRecord({}); setSectConfigs({}); setDirty(new Map())
      setSaveMsg(null); setSectMsg(null)
      await loadRows(year)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ""
      setParseLogs([])
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : "업로드 오류")
    } finally { setUploading(false) }
  }

  function handleUpload() {
    if (!file) return
    if (hwpFile) {
      setConfirmState({
        title: `${year}년 HWP 데이터 덮어쓰기`,
        lines: [
          `현재: ${hwpFile.hwpFileName} (${hwpFile.rowCount.toLocaleString()}행)`,
          `새 파일: ${file.name}`,
        ],
        danger: '기존 데이터를 모두 삭제하고 덮어씁니다.',
        onConfirm: doUpload,
      })
      return
    }
    doUpload()
  }

  // ── 삭제 ───────────────────────────────────────────────────

  async function doDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/tools/media-layout/upload?year=${year}`, { method: "DELETE" })
      if (!res.ok) { const d = await res.json(); throw new Error(d.message) }
      setHwpFile(null)
      setByRecord({}); setSectConfigs({}); setDirty(new Map())
      setSaveMsg(null); setParseLogs([])
      setFile(null)
      if (fileRef.current) fileRef.current.value = ""
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "삭제 중 오류가 발생했습니다.")
    } finally { setDeleting(false) }
  }

  function handleDelete() {
    setConfirmState({
      title: `${year}년 HWP 데이터 삭제`,
      lines: [],
      danger: 'MLAY_TAX 전체를 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
      onConfirm: doDelete,
    })
  }

  // ── 셀 편집 ────────────────────────────────────────────────

  function editRow(rec: string, seq: number, patch: Partial<TaxRow>) {
    setByRecord(prev => {
      const rows = prev[rec]?.map(r => r.seq === seq ? { ...r, ...patch } : r) ?? []
      return { ...prev, [rec]: rows }
    })
    setDirty(prev => {
      const next     = new Map(prev)
      const cur      = byRecord[rec]?.find(r => r.seq === seq)
      if (cur) {
        const existing = next.get(seq)
        // 최초 편집 시 원본값 고정 (이후 편집에서도 유지)
        const 원본항목 = existing?.원본항목 ?? cur.원본항목 ?? cur.item
        const 원본코드 = existing?.원본코드 ?? cur.원본코드 ?? cur.code
        next.set(seq, { ...cur, ...patch, 원본항목, 원본코드 })
      }
      return next
    })
    setSaveMsg(null)
  }

  // ── 구조 설정 적용 (MLAY_SECT_CONFIG + MLAY_TAX.SECT 저장) ──

  async function handleSectApply(rec: string, cfg: BulkConfig | null) {
    const rows    = byRecord[rec] ?? []
    const newRows = cfg ? applyBulk(rows, cfg) : rows.map(r => ({ ...r, sect: "header" }))
    setByRecord(prev => ({ ...prev, [rec]: newRows }))

    setSectApplying(true)
    setSectMsg(null)
    try {
      const res = await fetch("/api/tools/media-layout/sect-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          record: rec,
          target: "TAX",
          sectMode: cfg ? "hbf" : "body",
          bodyStart:   cfg?.bodyStart  ?? null,
          bodyEnd:     cfg?.bodyEnd    ?? null,
          repeatCount: cfg?.divideBy   ?? null,
          sectRows: newRows.map(r => ({ seq: r.seq, sect: r.sect })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setSectConfigs(prev => ({
        ...prev,
        [rec]: {
          year, userId: 0, record: rec, target: "TAX" as const,
          sectMode: cfg ? "hbf" : "body",
          bodyStart:   cfg?.bodyStart  ?? 0,
          bodyEnd:     cfg?.bodyEnd    ?? 0,
          repeatCount: cfg?.divideBy   ?? 0,
        },
      }))
      setSectMsg({ ok: true, text: "구조 설정 저장됨" })
      setTimeout(() => setSectMsg(null), 2000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "구조 설정 저장 중 오류가 발생했습니다.")
    } finally {
      setSectApplying(false)
    }
  }

  // ── 저장 ───────────────────────────────────────────────────

  async function handleSave() {
    if (dirty.size === 0) return
    setSaving(true); setSaveMsg(null)
    try {
      const updates = Array.from(dirty.values()).map(r => ({
        seq: r.seq, recordType: r.recordType, code: r.code, item: r.item,
        fieldType: r.fieldType, fieldLen: r.fieldLen,
        원본코드: r.원본코드, 원본항목: r.원본항목,
      }))
      const res  = await fetch("/api/tools/media-layout/tax-rows", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, updates }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setSaveMsg({ ok: true, text: `${data.updated}행 저장 완료` })
      setTimeout(() => setSaveMsg(null), 3000)
      setDirty(new Map())
      await loadRows(year)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "저장 중 오류가 발생했습니다.")
    } finally { setSaving(false) }
  }

  // ── 구간 자동 감지 (전체 레코드 일괄) ────────────────────────

  async function handleAutoDetect() {
    if (!hasRows) return

    // 레코드별 감지 + 새 행 계산 (감지 안 된 레코드는 전체 header로 초기화)
    const detections:  { rec: string; cfg: BulkConfig | null; newRows: TaxRow[] }[] = []
    for (const rec of recList) {
      const rows = byRecord[rec] ?? []
      const cfg  = detectInterval(rows)
      const newRows = cfg ? applyBulk(rows, cfg) : rows.map(r => ({ ...r, sect: "header" }))
      detections.push({ rec, cfg, newRows })
    }

    // byRecord 일괄 업데이트
    setByRecord(prev => {
      const next = { ...prev }
      for (const { rec, newRows } of detections) next[rec] = newRows
      return next
    })

    setSectApplying(true)
    setSectMsg(null)
    try {
      await Promise.all(detections.map(({ rec, cfg, newRows }) =>
        fetch("/api/tools/media-layout/sect-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            year, record: rec, target: "TAX",
            sectMode:    cfg ? "hbf" : "body",
            bodyStart:   cfg?.bodyStart ?? null,
            bodyEnd:     cfg?.bodyEnd   ?? null,
            repeatCount: cfg?.divideBy  ?? null,
            sectRows:    newRows.map(r => ({ seq: r.seq, sect: r.sect })),
          }),
        }).then(r => { if (!r.ok) throw new Error(`${rec} 저장 실패`) })
      ))

      // sectConfigs 일괄 업데이트
      setSectConfigs(prev => {
        const next = { ...prev }
        for (const { rec, cfg } of detections) {
          next[rec] = {
            year, userId: 0, record: rec, target: "TAX" as const,
            sectMode:    cfg ? "hbf" : "body",
            bodyStart:   cfg?.bodyStart ?? null,
            bodyEnd:     cfg?.bodyEnd   ?? null,
            repeatCount: cfg?.divideBy  ?? null,
          }
        }
        return next
      })

      setPanelKey(k => k + 1)
      const detected = detections.filter(d => d.cfg)
      const summary  = detected.map(d => `${d.rec}(×${d.cfg!.divideBy})`).join("  ")
      setAutoMsg({ ok: true, text: `${recList.length}개 레코드 적용 — ${summary || "반복구간 없음"}` })
      setTimeout(() => setAutoMsg(null), 5000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "구조 설정 저장 중 오류가 발생했습니다.")
    } finally {
      setSectApplying(false)
    }
  }

  // ── 렌더: 섹션 구분선 계산 ────────────────────────────────

  function renderTable(rows: TaxRow[]) {
    const nodes: React.ReactNode[] = []
    let prevSect  = ""
    let prevGubun = ""
    let cumBytes  = 0
    const maxBody = rows.reduce((m, r) => Math.max(m, bodyIdx(r.sect)), 0)
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r.sect !== prevSect) { nodes.push(<SectSep key={`sep-${r.seq}`} sect={r.sect} maxBody={maxBody} />); prevSect = r.sect }
      const curGubun = r.gubun ?? ""
      if (curGubun && curGubun !== prevGubun) {
        nodes.push(
          <tr key={`gubun-${r.seq}`} className="bg-sky-50 border-y border-sky-200">
            <td colSpan={6} className="px-3 py-0.5 text-[11px] font-semibold text-sky-700 select-none">
              {curGubun}
            </td>
          </tr>
        )
        prevGubun = curGubun
      }
      cumBytes += r.fieldLen ?? 0
      const isDirty    = dirty.has(r.seq)
      const isSelected = selectedSeq === r.seq
      const noteKey    = `${activeRec}-${r.code}`
      const note       = notes[noteKey]
      const rowBg = isSelected ? "bg-blue-100" : isDirty ? "bg-amber-50" : sectRowBg(r.sect)
      nodes.push(
        <tr key={r.seq} onClick={() => setSelectedSeq(isSelected ? null : r.seq)}
          className={cn(
            "border-b hover:brightness-95 transition-colors cursor-pointer group",
            openNoteKey === noteKey ? "relative z-[25]" : "",
            rowBg
          )}>
          {/* 번호 */}
          <td className={cn("px-1 py-0.5 border-r cursor-text", isDirty ? "bg-amber-100" : "")}>
            <div className="flex items-center justify-center gap-1">
              <input
                className={cn(
                  "w-full font-mono font-semibold text-xs px-1 py-0.5 rounded border-0 bg-transparent focus:border focus:border-primary outline-none text-center",
                  (isDirty || r.원본코드) ? "text-sky-600 font-bold" : ""
                )}
                value={r.code}
                spellCheck={false}
                onChange={e => editRow(activeRec, r.seq, { code: e.target.value })}
              />
              {r.원본코드 && !dirty.has(r.seq) && (
                <span title={`원본: ${r.원본코드}`}
                  className="shrink-0 text-[9px] leading-none px-0.5 rounded bg-sky-100 text-sky-600 font-medium select-none">수정</span>
              )}
            </div>
          </td>
          {/* 서식항목 */}
          <td className={cn("pl-1 pr-1 py-0.5 border-r cursor-text", isDirty ? "bg-amber-100" : "")}>
            <div className="flex items-center gap-0 min-w-0">
              <div className="relative shrink-0 self-center" data-note-popup onClick={e => e.stopPropagation()}>
                <NoteMarkButton
                  hasNote={!!note}
                  isDone={note?.isDone}
                  onClick={() => note ? setOpenNoteKey(openNoteKey === noteKey ? null : noteKey) : handleNoteCreate(activeRec, r.code)}
                />
                {openNoteKey === noteKey && note && (
                  <div className="absolute left-0 top-5 z-30">
                      <ItemNoteSticker
                        note={note}
                        item={r.item}
                        onSave={patch => handleNoteSave(activeRec, r.code, patch)}
                        onDelete={() => handleNoteDelete(activeRec, r.code)}
                        onClose={() => setOpenNoteKey(null)}
                      />
                  </div>
                )}
              </div>
              <input
                className={cn(
                  "flex-1 min-w-0 text-xs px-1 py-0.5 rounded border-0 bg-transparent focus:border focus:border-primary outline-none",
                  (isDirty || r.원본항목) ? "text-sky-600 font-bold" : ""
                )}
                value={r.item}
                spellCheck={false}
                title={(() => { const o = dirty.get(r.seq)?.원본항목 ?? r.원본항목; return o ? `원본: ${o}` : undefined })()}
                onChange={e => editRow(activeRec, r.seq, { item: e.target.value })}
              />
              {r.원본항목 && !dirty.has(r.seq) && (
                <span title={`원본: ${r.원본항목}`}
                  className="shrink-0 text-[9px] leading-none px-0.5 rounded bg-sky-100 text-sky-600 font-medium select-none">수정</span>
              )}
            </div>
          </td>
          {/* 데이터타입 */}
          <td className="px-2 py-1 border-r text-center font-mono text-xs cursor-default">{r.val ?? ""}</td>
          {/* 길이 */}
          <td className="px-2 py-1 border-r text-right font-mono text-xs cursor-default">{r.fieldLen ?? ""}</td>
          {/* 누적(HWP) */}
          <td className="px-2 py-1 border-r text-right font-mono text-xs tabular-nums text-muted-foreground/60 cursor-default">
            {r.hwpCum ?? ""}
          </td>
          {/* 누적(계산) */}
          {(() => {
            const mismatch = r.hwpCum !== undefined && r.hwpCum !== cumBytes
            return (
              <td className={cn("px-2 py-1 text-right font-mono text-xs tabular-nums cursor-default", mismatch ? "text-red-500 font-bold" : "text-muted-foreground/60")}>
                {cumBytes > 0 ? cumBytes : ""}
              </td>
            )
          })()}
        </tr>
      )
    }
    return nodes
  }

  // ── JSX ───────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">

      {/* 커스텀 확인 다이얼로그 */}
      {confirmState && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40">
          <div className="bg-background border rounded-lg shadow-2xl p-6 w-full max-w-md mx-4">
            <h3 className="font-semibold text-sm mb-3">{confirmState.title}</h3>
            {confirmState.lines.map((line, i) => (
              <p key={i} className="text-xs text-muted-foreground font-mono mb-1">{line}</p>
            ))}
            {confirmState.danger && (
              <p className="text-xs text-destructive font-medium mt-2">{confirmState.danger}</p>
            )}
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="outline" size="sm" onClick={() => setConfirmState(null)}>취소</Button>
              <Button variant="destructive" size="sm"
                onClick={() => { confirmState.onConfirm(); setConfirmState(null) }}>
                확인
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 파싱 변환 로그 모달 */}
      {parseLogOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setParseLogOpen(false)} />
          <div
            className="fixed z-[51] flex flex-col bg-background rounded-lg shadow-2xl border border-border overflow-hidden"
            style={{ left: logPos.x, top: logPos.y, width: logSize.w, height: logSize.h }}
          >
            {/* 드래그 핸들 (헤더) */}
            <div
              className="flex items-center justify-between px-4 py-3 border-b bg-muted/30 shrink-0 cursor-grab active:cursor-grabbing select-none"
              onMouseDown={e => {
                e.preventDefault()
                logDragRef.current = { type: "drag", ox: e.clientX, oy: e.clientY, px: logPos.x, py: logPos.y }
              }}
            >
              <div className="flex items-center gap-2 min-w-0 pointer-events-none">
                <span className="font-semibold text-sm">파싱 변환 로그 — {activeRec}레코드 ({year})</span>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => setLogicOpen(v => !v)}
                  className="pointer-events-auto shrink-0 flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span>{logicOpen ? "▾" : "▸"}</span>
                  <span>변환 로직</span>
                </button>
              </div>
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={() => setParseLogOpen(false)}
                className="pointer-events-auto p-1 rounded hover:bg-muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {logicOpen && (
              <div className="px-4 py-2.5 border-b bg-muted/30 text-[11px] text-muted-foreground space-y-0.5 shrink-0">
                <div>① HWP 아티팩트 · 제어문자 · 보이지 않는 문자 제거 <span className="font-mono">(\x00-\x1F, ​-‏, ㅤ 등)</span></div>
                <div>② 선행 한자 접두사 제거 <span className="font-mono">(一-鿿)</span></div>
                <div>③ 선행 원문자 제거 <span className="font-mono">(①-⒇)</span></div>
                <div>④ <span className="font-mono">-원문자 / -가나다</span> 마커 제거 — 단어 내부 <span className="font-mono">(-사립)</span> 등은 제외</div>
                <div>⑤ 숫자 접두 필드 마커 제거 <span className="font-mono">(-5 G01… → G01…)</span></div>
                <div>⑥ 원형 한글 접두 마커 제거 <span className="font-mono">(-㉮공적연금… → 공적연금…)</span></div>
                <div>⑦ 최종 공백 전체 제거</div>
              </div>
            )}

            <div className="overflow-auto flex-1">
              {parseLogLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
                </div>
              ) : (() => {
                const filtered = parseLogs.filter(l => l.recordType === activeRec)
                return filtered.length === 0 ? (
                  <div className="py-10 text-center text-muted-foreground text-sm">변환 로그가 없습니다.</div>
                ) : (
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="px-2 py-1.5 border-b border-r text-center w-14">코드</th>
                        <th className="px-2 py-1.5 border-b border-r text-left">원본</th>
                        <th className="px-2 py-1.5 border-b text-left">변환값</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filtered.map((l, i) => {
                        const sel = parseLogSelIdx === i
                        return (
                          <tr key={i}
                            onClick={() => setParseLogSelIdx(sel ? null : i)}
                            className={cn("cursor-pointer transition-colors", sel ? "bg-blue-100" : "hover:bg-muted")}
                          >
                            <td className="px-2 py-1.5 border-r text-center font-mono">{l.code}</td>
                            <td className="px-2 py-1.5 border-r break-all">
                              {diffOrig(l.origText, l.cleanText).map((seg, si) =>
                                seg.removed
                                  ? <span key={si} className="bg-red-100 text-red-600 line-through rounded-sm">{seg.text}</span>
                                  : <span key={si} className="text-muted-foreground">{seg.text}</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 break-all">{l.cleanText ?? <span className="text-muted-foreground/50 italic">삭제됨</span>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
              })()}
            </div>

            {/* 리사이즈 핸들 (4방향 모서리) */}
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
                  logDragRef.current = { type: "resize", dir, ox: e.clientX, oy: e.clientY, px: logPos.x, py: logPos.y, pw: logSize.w, ph: logSize.h }
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
                  logDragRef.current = { type: "resize", dir, ox: e.clientX, oy: e.clientY, px: logPos.x, py: logPos.y, pw: logSize.w, ph: logSize.h }
                }}
              />
            ))}
          </div>
        </>
      )}

      {/* 업로드 — 한 줄 */}
      <div className="flex items-center gap-2">

        {/* 귀속연도 */}
        <select
          value={year}
          onChange={e => { setYear(parseInt(e.target.value)); setParseLogs([]) }}
          className="h-8 border rounded px-2 font-mono text-sm bg-background cursor-pointer shrink-0"
        >
          {Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - 1 - i).map(y => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>

        {/* 파일 선택 */}
        <div
          onClick={() => fileRef.current?.click()}
          className="flex-1 flex items-center gap-2 h-8 px-3 border rounded cursor-pointer hover:bg-muted/50 transition-colors text-sm min-w-0"
        >
          {file ? (
            <><FileText className="h-4 w-4 text-primary shrink-0" /><span className="truncate font-medium">{file.name}</span></>
          ) : checking ? (
            <><Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" /><span className="text-muted-foreground">확인 중...</span></>
          ) : hwpFile ? (
            <><CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" /><span className="truncate text-green-700">{hwpFile.hwpFileName}</span><span className="text-xs text-muted-foreground shrink-0 ml-auto pl-2">{hwpFile.rowCount.toLocaleString()}행 · {(() => { const d = new Date(hwpFile.uploadedAt); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}` })()}</span></>
          ) : (
            <span className="text-muted-foreground text-xs">파일 없음 — 클릭하여 선택</span>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".hwp" className="hidden" onChange={handleFile} />

        {/* 버튼 */}
        <Button onClick={handleUpload} disabled={!file || uploading} size="sm" className="shrink-0">
          {uploading ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />저장 중...</> : "업로드"}
        </Button>
        {hwpFile && (
          <Button onClick={handleDelete} disabled={deleting} variant="destructive" size="sm" className="shrink-0">
            {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </Button>
        )}

        {/* 사용법 아이콘 */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setHelpOpen(p => !p)}
            className={cn(
              "h-8 w-8 rounded flex items-center justify-center border transition-colors",
              helpOpen
                ? "bg-blue-50 border-blue-300 text-blue-600"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
            title="사용법 안내"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          {helpOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setHelpOpen(false)} />
              <div className="absolute right-0 top-9 z-30 w-[600px] bg-background border rounded-lg shadow-lg text-xs">
                {/* 탭 헤더 */}
                <div className="flex border-b">
                  {(["usage", "how"] as const).map(tab => (
                    <button
                      key={tab}
                      type="button"
                      onClick={e => { e.stopPropagation(); setHelpTab(tab) }}
                      className={cn(
                        "flex-1 py-2 text-xs font-medium transition-colors",
                        helpTab === tab
                          ? "border-b-2 border-primary text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {tab === "usage" ? "사용법" : "프로그램 설명"}
                    </button>
                  ))}
                </div>

                {/* 탭 콘텐츠 */}
                <div className="p-4 space-y-3">
                  {helpTab === "usage" ? (
                    <>
                      <p className="text-muted-foreground leading-relaxed">
                        국세청 전산매체제출요령 HWP 파일을 파싱하여 레코드별 항목 구조를 확인하고 번호·서식항목을 수정합니다.
                      </p>
                      <div>
                        <p className="font-semibold mb-1.5">사용 순서</p>
                        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                          <li>귀속연도 선택 후 HWP 파일을 클릭하여 선택 → <strong className="text-foreground">업로드</strong></li>
                          <li>레코드 탭(A~K)에서 각 레코드의 항목 목록 확인</li>
                          <li>서식항목 헤더의 <span className="inline-flex items-center gap-0.5 font-medium text-foreground">🗂 아이콘</span> 클릭 → 파싱 변환 로그 확인 (원본→변환값)</li>
                          <li>구조설정에서 Header / Body / Footer 구간 지정 후 <strong className="text-foreground">설정 적용</strong></li>
                          <li>번호·서식항목 셀을 클릭해 직접 수정 → <strong className="text-foreground">저장</strong></li>
                          <li>세법개정 등 주의 항목은 서식항목 앞 <span className="text-yellow-500 font-medium">📄 아이콘</span> 클릭 → 메모 작성 → <strong className="text-foreground">저장</strong></li>
                        </ol>
                      </div>
                      <div>
                        <p className="font-semibold mb-1.5">그리드 컬럼 설명</p>
                        <table className="w-full border rounded text-[11px]">
                          <thead>
                            <tr className="bg-muted/60">
                              <th className="px-2 py-1 text-left border-b border-r font-semibold w-28">컬럼</th>
                              <th className="px-2 py-1 text-left border-b font-semibold">설명</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            <tr><td className="px-2 py-1.5 border-r font-medium">번호 ✎</td><td className="px-2 py-1.5 text-muted-foreground">레코드 항목 코드 (예: A01) — 직접 수정 가능</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-medium">서식항목 ✎ 🗂</td><td className="px-2 py-1.5 text-muted-foreground">항목명 — 직접 수정 가능. 좌측 <span className="text-yellow-500">📄</span> 주목 메모 / 우측 🗂 클릭 시 파싱 변환 로그 팝업</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-medium">데이터타입</td><td className="px-2 py-1.5 text-muted-foreground">HWP에서 파싱된 데이터 유형</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-medium">길이</td><td className="px-2 py-1.5 text-muted-foreground">필드 바이트 길이</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-medium">누적(HWP)</td><td className="px-2 py-1.5 text-muted-foreground">HWP 원본 누적 바이트</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-medium">누적(계산)</td><td className="px-2 py-1.5 text-muted-foreground">길이 합산 누적 바이트 — <span className="text-red-600 font-medium">빨간색</span>이면 HWP 원본과 불일치</td></tr>
                          </tbody>
                        </table>
                      </div>
                      <div>
                        <p className="font-semibold mb-1.5">주목 메모</p>
                        <p className="text-muted-foreground mb-1.5">세법개정으로 수정이 필요한 항목에 메모를 남겨 비교검증 시 주의집중에 활용합니다.</p>
                        <table className="w-full border rounded text-[11px]">
                          <tbody className="divide-y">
                            <tr><td className="px-2 py-1.5 border-r font-medium w-24">아이콘 색상</td><td className="px-2 py-1.5 text-muted-foreground"><span className="text-yellow-500 font-medium">노란색</span> — 메모 있음 / 회색(행 hover 시) — 메모 없음(클릭하여 추가)</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-medium">저장</td><td className="px-2 py-1.5 text-muted-foreground">메모 입력 후 저장 버튼 클릭. 외부 클릭 시 내용 없으면 자동 삭제</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-medium">완료 체크</td><td className="px-2 py-1.5 text-muted-foreground">처리 완료된 항목 표시 — 아이콘이 회색으로 변경됨</td></tr>
                          </tbody>
                        </table>
                      </div>
                      <div>
                        <p className="font-semibold mb-1.5">수정 상태 표시</p>
                        <div className="flex flex-wrap gap-4">
                          <span className="inline-flex items-center gap-2">
                            <span className="inline-block w-14 h-4 rounded bg-amber-100 border border-amber-200" />
                            <span className="text-muted-foreground">편집 중 (미저장)</span>
                          </span>
                          <span className="inline-flex items-center gap-2">
                            <span className="inline-block w-14 h-4 rounded bg-blue-50 border border-blue-200" />
                            <span className="text-muted-foreground">저장된 수정값 (HWP 원본과 다름)</span>
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <p className="font-semibold mb-1.5">주요 처리사항</p>
                        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                          <li>HWP 업로드 → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">POST /api/.../upload</span> → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">parseHwpBuffer()</span> 호출</li>
                          <li>OLE(CFB) → BodyText 섹션 → UTF-16LE 텍스트 추출 (압축 시 zlib 해제)</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">제1절 근로소득</span> 영역만 파싱, 제2절 이상 감지 시 중단</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">A레코드【</span> 패턴으로 레코드 전환, 항목번호→항목명→타입→누적 순서로 행 구성. GUBUN(【...】) 추출 시 내부 공백 전체 제거 후 저장</li>
                          <li>파싱 결과 → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">saveHwpFile()</span> → MLAY_HWP_FILE + MLAY_TAX INSERT. 원본과 달라진 항목명은 MLAY_HWP_PARSE_LOG에 저장</li>
                          <li>화면에서 번호·서식항목 수정 → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">PATCH /api/.../tax-rows</span> → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">updateTaxRows() + upsertTaxEdit()</span> → MLAY_TAX_CODE_EDIT / MLAY_TAX_ITEM_EDIT MERGE</li>
                          <li>구조설정 적용 → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">PUT /api/.../sect-config</span> → MLAY_SECT_CONFIG 저장 + MLAY_TAX.SECT 갱신</li>
                          <li><strong className="text-foreground">구간 자동설정</strong> — 전체 레코드를 순회하며 <span className="font-mono text-[10px] bg-muted px-0.5 rounded">detectInterval()</span>으로 반복 구간 감지 후 병렬 저장</li>
                          <li>주목 메모 → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">PUT /api/.../item-notes</span> → MLAY_ITEM_NOTE UPSERT. 외부 클릭 닫힘 시 빈 메모는 자동 DELETE</li>
                        </ol>
                      </div>

                      <div>
                        <p className="font-semibold mb-1.5">관련 table</p>
                        <table className="w-full border rounded text-[11px]">
                          <thead><tr className="bg-muted/60">
                            <th className="px-2 py-1 text-left border-b border-r font-semibold w-36">테이블</th>
                            <th className="px-2 py-1 text-left border-b font-semibold">주요 컬럼 / 역할</th>
                          </tr></thead>
                          <tbody className="divide-y">
                            <tr><td className="px-2 py-1.5 border-r font-mono text-[10px]">MLAY_HWP_FILE</td><td className="px-2 py-1.5 text-muted-foreground">YEAR, USER_ID, FILE_NAME, ROW_COUNT, UPLOADED_AT — 파일 메타</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-mono text-[10px]">MLAY_TAX</td><td className="px-2 py-1.5 text-muted-foreground">SEQ(PK), RECORD_TYPE, CODE, ITEM, FIELD_TYPE, FIELD_LEN, HWP_CUM, GUBUN, SECT — 파싱 항목 원본. GUBUN은 공백 제거된 값으로 저장</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-mono text-[10px]">MLAY_TAX_CODE_EDIT</td><td className="px-2 py-1.5 text-muted-foreground">YEAR, USER_ID, RECORD_TYPE, ORG_CODE, CODE — 번호(코드) 수정값 + 원본 보존</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-mono text-[10px]">MLAY_TAX_ITEM_EDIT</td><td className="px-2 py-1.5 text-muted-foreground">YEAR, USER_ID, RECORD_TYPE, ORG_ITEM, ITEM — 서식항목명 수정값 + 원본 보존</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-mono text-[10px]">MLAY_SECT_CONFIG</td><td className="px-2 py-1.5 text-muted-foreground">RECORD, TARGET, SECT_MODE, BODY_START, BODY_END, REPEAT_COUNT — 섹션 구조 설정</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-mono text-[10px]">MLAY_ITEM_NOTE</td><td className="px-2 py-1.5 text-muted-foreground">YEAR, USER_ID, RECORD_TYPE, CODE, MEMO, IS_DONE, COLOR — 항목별 주목 메모</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-mono text-[10px]">MLAY_HWP_PARSE_LOG</td><td className="px-2 py-1.5 text-muted-foreground">YEAR, USER_ID, RECORD_TYPE, CODE, LOG_SEQ, ORIG_TEXT, CLEAN_TEXT — 항목명 파싱 변환 로그. 재업로드 시 초기화</td></tr>
                          </tbody>
                        </table>
                      </div>

                      <div>
                        <p className="font-semibold mb-1.5">핵심적인 로직</p>
                        <ul className="space-y-1.5 text-muted-foreground">
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">isValidNext(prev, curr)</span> — 항목번호 연속성 검증. A01→A02, A02→A02ⓐ→A03 등 규칙 처리. 비연속이면 해당 행 스킵</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">GUBUN 공백 제거</span> — <span className="font-mono text-[10px] bg-muted px-0.5 rounded">gm[0].replace(/\s+/g, "")</span> 적용. HWP 텍스트에서 추출된 【 자료 관리 번호 】 → 【자료관리번호】로 정규화. <span className="font-mono text-[10px] bg-muted px-0.5 rounded">currentGubun</span>이 설정되는 3곳 모두 적용</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">accumulated + dlen !== proposedCum</span> — HWP 원본 오타 대응. 누적 불일치 시 HWP 값으로 재동기화</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">upsertTaxEdit()</span> — MLAY_TAX_CODE_EDIT / MLAY_TAX_ITEM_EDIT MERGE INTO. ORG_CODE/ORG_ITEM은 최초 수정 시 한 번만 기록, 이후 덮어쓰지 않음. 수정값이 원본과 같아지면 해당 EDIT 행 자동 삭제</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">detectInterval(rows)</span> — item을 앵커로 반복 구간 자동 감지. ① 동일 item이 복수 등장하는 위치로 unitLen 산출 ② fieldLen 시퀀스 일치로 반복 횟수 검증 ③ 앞으로 확장하여 진짜 bodyStart 탐색. 공란·예비 등 패딩 item은 앵커에서 제외</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">applyBulk()</span> (클라이언트) — bodyStart·bodyEnd·divideBy로 행별 SECT 계산 후 서버에 일괄 저장. MLAY_SECT_CONFIG와 동기화 필수</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">cleanText()</span> 변환 파이프라인 — ① HWP 아티팩트·제어문자·보이지 않는 문자 제거 ② 한자 접두사 제거 ③ ①-⒇ 원문자 제거 ④ <span className="font-mono text-[10px] bg-muted px-0.5 rounded">-가나다</span> 마커 제거(단어 내부 제외) ⑤ 숫자 접두 마커 제거(<span className="font-mono text-[10px] bg-muted px-0.5 rounded">-5 G01→G01</span>) ⑥ 원형 한글 마커 제거(<span className="font-mono text-[10px] bg-muted px-0.5 rounded">-㉮→</span>) ⑦ 최종 공백 전체 제거. 변환 전후가 다른 경우 MLAY_HWP_PARSE_LOG에 기록</li>
                          <li>재업로드 시 MLAY_HWP_FILE CASCADE DELETE → MLAY_TAX·MLAY_TAX_CODE_EDIT·MLAY_TAX_ITEM_EDIT·MLAY_TAX_JAVA_MAP·MLAY_HWP_PARSE_LOG 전체 삭제됨</li>
                        </ul>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

      </div>

      {uploadErr && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />{uploadErr}
        </div>
      )}

      {/* 편집 리스트 */}
      {hasRows && (
        <div className="flex flex-col flex-1 min-h-0 gap-2">

          {/* 바이트 검증 */}
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {(() => {
              const totals = recList.map(r => ({
                r, bytes: byRecord[r]?.reduce((s, row) => s + (row.fieldLen ?? 0), 0) ?? 0,
              }))
              const base = totals[0]?.bytes ?? 0
              return (
                <>
                  <span className="text-muted-foreground font-medium shrink-0">
                    총 바이트 검증 (기준 {base} byte):
                  </span>
                  {totals.map(({ r, bytes }) => {
                    const ok = bytes === base
                    return (
                      <span key={r}
                        className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-mono font-semibold ${ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
                      >
                        {r}:{bytes}
                      </span>
                    )
                  })}
                </>
              )
            })()}
          </div>

          {/* 탭 + 콘텐츠 */}
          <div className={cn("flex flex-col flex-1 min-h-0", isFullscreen && "fixed inset-y-0 right-0 z-40 bg-background p-3 left-(--sidebar-width-icon)")}>
            <div className="flex items-end border-b border-border gap-0.5">
              {/* 탭 목록 — 공간 부족 시 줄임표 */}
              <div className="flex items-end gap-0.5 min-w-0">
                {recList.map(r => {
                  const isActive = r === activeRec
                  const isHbf   = sectConfigs[r]?.sectMode === "hbf"
                  const baseBg  = isHbf ? "bg-purple-100 text-purple-700" : "bg-sky-50 text-sky-700"
                  const hoverBg = isHbf ? "hover:bg-purple-200" : "hover:bg-sky-100"
                  const topLine = isHbf ? "border-t-[3px] border-t-purple-500" : "border-t-[3px] border-t-sky-500"
                  return (
                    <button key={r} type="button" onClick={() => handleTabChange(r)}
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors shrink min-w-[36px] truncate max-w-[80px]",
                        baseBg,
                        isActive
                          ? cn("font-semibold border border-border border-b-white -mb-px relative z-10", topLine)
                          : hoverBg
                      )}
                    >
                      {r}-레코드
                      {byRecord[r]?.some(row => dirty.has(row.seq)) ? (
                        <span className="ml-1 text-amber-500 font-bold">*</span>
                      ) : byRecord[r]?.some(row => row.원본코드 != null || row.원본항목 != null) ? (
                        <span className="ml-1 text-muted-foreground/70 font-bold">*</span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
              <div className="ml-auto flex items-center gap-2 pb-0.5">
                {autoMsg && (
                  <span className={`text-xs font-medium ${autoMsg.ok ? "text-green-600" : "text-destructive"}`}>
                    {autoMsg.ok ? <><CheckCircle2 className="inline h-3 w-3 mr-1" />{autoMsg.text}</> : autoMsg.text}
                  </span>
                )}
                {saveMsg && (
                  <span className={`text-xs ${saveMsg.ok ? "text-green-600" : "text-destructive"}`}>
                    {saveMsg.ok ? <><CheckCircle2 className="inline h-3 w-3 mr-1" />{saveMsg.text}</> : saveMsg.text}
                  </span>
                )}
                <Button onClick={handleAutoDetect} disabled={sectApplying || !hasRows} size="sm" variant="outline" className="text-xs h-7 px-2 text-purple-700 border-purple-300 hover:bg-purple-50">
                  구간 자동설정
                </Button>
                <Badge variant="outline" className="text-xs">
                  {dirty.size > 0 ? `${dirty.size}행 미저장` : "변경 없음"}
                </Badge>
                <Button onClick={handleSave} disabled={saving || dirty.size === 0} size="sm" variant="default">
                  {saving
                    ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />저장 중...</>
                    : <><Save className="h-3 w-3 mr-1" />저장</>}
                </Button>
                <Button onClick={() => loadRows(year)} disabled={dirty.size === 0 || checking} size="sm" variant="outline">
                  <RotateCcw className="h-3 w-3 mr-1" />변경취소
                </Button>
                <Button size="sm" variant="outline"
                  className={cn("h-7 w-7 p-0 shrink-0", isFullscreen && "bg-slate-100 border-slate-400")}
                  onClick={handleToggleFullscreen}
                  title={isFullscreen ? "전체화면 해제" : "전체화면"}>
                  {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <div className="border border-t-0 border-border rounded-b bg-white flex flex-col flex-1 min-h-0">
              {/* 구조 설정 */}
              <BulkSectPanel
                key={`${activeRec}-${panelKey}`}
                totalRows={byRecord[activeRec]?.length ?? 0}
                recFields={byRecord[activeRec] ?? []}
                applying={sectApplying}
                msg={sectMsg}
                config={sectConfigs[activeRec] ?? null}
                onApply={cfg => handleSectApply(activeRec, cfg)}
                codeModCount={byRecord[activeRec]?.filter(r => r.원본코드 != null).length ?? 0}
                itemModCount={byRecord[activeRec]?.filter(r => r.원본항목 != null).length ?? 0}
              />

              {/* 편집 테이블 */}
              <div ref={scrollDivRef} className="overflow-auto flex-1 text-xs">
                <table className="w-full border-collapse table-fixed">
                  <colgroup>
                    <col className="w-28" />
                    <col />
                    <col className="w-20" />
                    <col className="w-10" />
                    <col className="w-16" />
                    <col className="w-16" />
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr>
                      <th className="px-2 py-1.5 border-b border-r text-center">번호 <span className="text-muted-foreground/50 inline-block" style={{transform:"scaleX(-1)"}}>✎</span></th>
                      <th className="pl-1 pr-2 py-1.5 border-b border-r text-left">
                        <span className="flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                          서식항목 <span className="text-muted-foreground/50 inline-block" style={{transform:"scaleX(-1)"}}>✎</span>
                          <button
                            onClick={e => { e.stopPropagation(); handleParseLogOpen() }}
                            title="파싱 변환 로그"
                            className="ml-0.5 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Table2 className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      </th>
                      <th className="px-2 py-1.5 border-b border-r text-center">데이터타입</th>
                      <th className="px-1 py-1.5 border-b border-r text-center">길이</th>
                      <th className="px-1 py-1.5 border-b border-r text-center whitespace-nowrap">누적(HWP)</th>
                      <th className="px-1 py-1.5 border-b text-center whitespace-nowrap">누적(계산)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renderTable(byRecord[activeRec] ?? [])}
                  </tbody>
                </table>
              </div>

            </div>
          </div>

        </div>
      )}
    </div>
  )
}
