"use client"

import { useRef, useState, useCallback, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2, XCircle, Loader2, RefreshCw, Download, AlertTriangle, Save, RotateCcw, Code2, X, HelpCircle, FileText, Maximize2, Minimize2 } from "lucide-react"
import { toast } from "sonner"
import { SectionBox, sectColors, sectionLineCount } from "./SectionBox"
import { cn } from "@/lib/utils"
import type { HwpFileRow, JavaFileRow, TaxSectConfigRow, ItemNoteRow } from "@/lib/tax-oracle"
import type { TaxLayoutRow, JavaField, CompareRow } from "../types"
import { ItemNoteSticker, NoteMarkButton } from "./ItemNoteSticker"

const RECORD_TYPES = ["A","B","C","D","E","F","G","H","I","K"]

// ── 섹션 배경색 ───────────────────────────────────────────────

const BODY_BG = ["bg-purple-50","bg-violet-50","bg-indigo-50","bg-blue-50"]
function bodyIdx(sect: string) { const m = sect.match(/^body_(\d+)$/); return m ? parseInt(m[1]) : 0 }
function taxSectBg(sect: string, isHbf: boolean) {
  if (sect === "footer" || (isHbf && sect === "header")) return "bg-teal-50"
  return ""
}

// ── 섹션 구분선 ───────────────────────────────────────────────

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

const MAKE_STR_RE = /^makeStr\s*\(\s*"([X9])"\s*,\s*(\d{1,4})\s*,\s*[\s\S]+\)\s*$/

function parseMakeStr(raw: string): { dtype: string; len: number } | null {
  const m = MAKE_STR_RE.exec(raw.trim())
  if (!m) return null
  return { dtype: m[1].toLowerCase(), len: parseInt(m[2]) }
}

function canonicalize(s: string): string {
  const norm = (x: string) => x.replace(/\s+\)/g, ")")
  const m = /^makeStr\s*\(\s*"([9xX])"\s*,\s*(\d+)\s*,\s*([\s\S]+)\)\s*$/.exec(s.trim())
  if (!m) return s.trim()
  return `makeStr("${m[1]}", ${m[2]}, ${norm(m[3].trimEnd())})`
}

// ── makeStr 정렬 ─────────────────────────────────────────────

function alignMakeStrs(strs: string[]): string[] {
  const norm = (s: string) => s.replace(/\s+\)/g, ")")
  const parsed = strs.map(s => {
    const m = /^makeStr\("([9xX])",\s*(\d+),\s*([\s\S]+)\)$/.exec(s)
    return m ? { type: m[1], len: m[2], arg: norm(m[3].trimEnd()) } : null
  })
  const maxLen = Math.max(...parsed.map(p => p ? p.len.length : 0), 0)
  const maxArg = Math.max(...parsed.map(p => p ? p.arg.length : 0), 0)
  return strs.map((s, i) => {
    const p = parsed[i]
    return p ? `makeStr("${p.type}", ${p.len.padStart(maxLen)}, ${p.arg.padEnd(maxArg)})` : s
  })
}

// ── EditOp: D/I 편집 연산 (추가/제거만, 배열 수정 없음) ──────

type EditOp =
  | { id: string; type: 'D'; javaSeq: number; fromDB: boolean }
  | { id: string; type: 'I'; afterJavaSeq: number | null; editedRaw: string; fromDB: boolean }

// ── DisplayRow: computeDisplay의 파생 결과 ────────────────────

interface DisplayRow {
  key:        string
  opId:       string | null
  tax:        TaxLayoutRow | null
  java:       JavaField | null
  cmd:        'D' | 'I' | null
  editedRaw:  string
  loadedRaw:  string
  fromDB:     boolean
  isOverflow: boolean
}

// ── applySectConfig ───────────────────────────────────────────

function applySectConfig(rows: (TaxLayoutRow | null)[], cfg: TaxSectConfigRow | null): (TaxLayoutRow | null)[] {
  if (!cfg || cfg.sectMode === "body" || cfg.bodyStart == null || cfg.bodyEnd == null || cfg.repeatCount == null)
    return rows.map(r => r ? { ...r, sect: "header" } : null)
  const { bodyStart, bodyEnd, repeatCount } = cfg as { bodyStart: number; bodyEnd: number; repeatCount: number } & typeof cfg
  const unitLen = Math.max(1, Math.floor(Math.max(1, bodyEnd - bodyStart + 1) / repeatCount))
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

// ── computeDisplay: baseTax + baseJava + ops → DisplayRow[] ──

function computeDisplay(
  baseTax:  TaxLayoutRow[],
  baseJava: JavaField[],
  ops:      EditOp[],
  mEdits:   Map<number, string>,
  mLoaded:  Map<number, string>,
  cfg:      TaxSectConfigRow | null,
): DisplayRow[] {
  const deletedSeqs = new Set(
    ops.filter(o => o.type === 'D').map(o => (o as {type:'D';javaSeq:number}).javaSeq)
  )
  const insertMap = new Map<number | null, (EditOp & {type:'I'})[]>()
  for (const op of ops) {
    if (op.type !== 'I') continue
    const k = op.afterJavaSeq
    if (!insertMap.has(k)) insertMap.set(k, [])
    insertMap.get(k)!.push(op as EditOp & {type:'I'})
  }

  type JEntry =
    | { kind: 'existing'; java: JavaField }
    | { kind: 'deleted';  java: JavaField; opId: string; fromDB: boolean }
    | { kind: 'inserted'; op: EditOp & {type:'I'} }

  const jSeq: JEntry[] = []
  for (const op of (insertMap.get(null) ?? [])) jSeq.push({ kind: 'inserted', op })
  for (const j of baseJava) {
    if (deletedSeqs.has(j.seq)) {
      const dOp = ops.find(o => o.type === 'D' && (o as any).javaSeq === j.seq)!
      jSeq.push({ kind: 'deleted', java: j, opId: dOp.id, fromDB: dOp.fromDB })
    } else {
      jSeq.push({ kind: 'existing', java: j })
    }
    for (const op of (insertMap.get(j.seq) ?? [])) jSeq.push({ kind: 'inserted', op })
  }

  const rawTaxItems: (TaxLayoutRow | null)[] = []
  const partials: Omit<DisplayRow, 'tax' | 'isOverflow'>[] = []
  let taxIdx = 0

  for (const entry of jSeq) {
    if (entry.kind === 'deleted') {
      rawTaxItems.push(null)
      partials.push({ key: entry.opId, opId: entry.opId, java: entry.java, cmd: 'D', editedRaw: entry.java.raw, loadedRaw: entry.java.raw, fromDB: entry.fromDB })
    } else if (entry.kind === 'inserted') {
      rawTaxItems.push(baseTax[taxIdx] ?? null)
      taxIdx++
      const raw = entry.op.editedRaw
      partials.push({ key: entry.op.id, opId: entry.op.id, java: null, cmd: 'I', editedRaw: raw, loadedRaw: raw, fromDB: entry.op.fromDB })
    } else {
      rawTaxItems.push(baseTax[taxIdx] ?? null)
      taxIdx++
      const raw    = mEdits.get(entry.java.seq) ?? entry.java.raw
      const loaded = mLoaded.get(entry.java.seq) ?? entry.java.raw
      partials.push({ key: `j${entry.java.seq}`, opId: null, java: entry.java, cmd: null, editedRaw: raw, loadedRaw: loaded, fromDB: false })
    }
  }
  while (taxIdx < baseTax.length) {
    const t = baseTax[taxIdx++]!
    rawTaxItems.push(t)
    partials.push({ key: `t${t.seq}-jnull`, opId: null, java: null, cmd: null, editedRaw: '', loadedRaw: '', fromDB: false })
  }

  const taxWithSect = applySectConfig(rawTaxItems, cfg)
  return taxWithSect.map((tax, i) => ({ ...partials[i]!, tax, isOverflow: tax?.seq === 0 }))
}

// ── 구조 분석 ─────────────────────────────────────────────────

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

// ── 구조 표시 + 오류 통계 ─────────────────────────────────────

function TaxSectInfo({ rows, rightContent }: { rows: DisplayRow[]; rightContent?: React.ReactNode }) {
  const info = analyzeFromItems(rows.map(r => r.tax))
  if (rows.length === 0) return null

  let itemDiff = 0, typeDiff = 0
  for (const row of rows) {
    const { tax, cmd, editedRaw, java, isOverflow } = row
    if (!tax || cmd === "D" || isOverflow) continue
    const parsed   = editedRaw ? parseMakeStr(editedRaw) : null
    const effDtype = parsed?.dtype ?? java?.dtype ?? ""
    const effLen   = parsed?.len   ?? java?.len   ?? 0
    if (cmd === "I") {
      if (effDtype && effLen && (tax.타입 !== effDtype || tax.길이 !== effLen)) typeDiff++
      continue
    }
    if (!java) continue
    if (tax.항목?.replace(/\s+/g, '') !== java.name?.replace(/\s+/g, '')) itemDiff++
    if (effDtype && effLen && (tax.타입 !== effDtype || tax.길이 !== effLen)) typeDiff++
  }

  const errBadge = rows.length > 0 ? (
    <span className="flex items-center gap-1.5 ml-2 pl-2 border-l border-border">
      <span className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
        itemDiff > 0 ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"
      )}>
        서식항목 {itemDiff}
      </span>
      <span className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
        typeDiff > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
      )}>
        데이터타입 {typeDiff}
      </span>
    </span>
  ) : null

  if (!info.isHbf) {
    return (
      <div className="flex items-center gap-3 text-xs bg-muted/30 px-3 py-2 border-b text-muted-foreground flex-wrap">
        <span className="font-medium text-sky-700">Header 구조</span>
        <span>· 전체 {info.total}행</span>
        {errBadge}
        {rightContent && <span className="ml-auto flex items-center gap-2">{rightContent}</span>}
      </div>
    )
  }
  const recLetter = rows.find(r => r.tax)?.tax?.코드[0] ?? ""
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
      {rightContent && <span className="ml-auto flex items-center gap-2">{rightContent}</span>}
    </div>
  )
}

// ── MediaStep ─────────────────────────────────────────────────

export function MediaStep() {
  const scrollDivRef  = useRef<HTMLDivElement>(null)
  const scrollPosRef  = useRef<Record<string, number>>({})

  const [year,      setYear]      = useState(() => new Date().getFullYear() - 1)
  const [hwpFile,   setHwpFile]   = useState<HwpFileRow | null>(null)
  const [javaFile,  setJavaFile]  = useState<JavaFileRow | null>(null)
  const [helpOpen,    setHelpOpen]    = useState(false)
  const [helpTab,     setHelpTab]     = useState<"usage" | "how">("usage")

  // 주목 노트
  const [notes,              setNotes]              = useState<Record<string, ItemNoteRow>>({})
  const [openNoteKey,        setOpenNoteKey]        = useState<string | null>(null)
  const [showSeq,            setShowSeq]            = useState(false)
  const [isFullscreen,       setIsFullscreen]       = useState(false)

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

  async function handleNoteSave(rec: string, code: string, patch: Partial<Pick<ItemNoteRow, "memo" | "isDone" | "color">>) {
    const key  = `${rec}-${code}`
    const cur  = notes[key]
    const next: ItemNoteRow = {
      year, userId: 0, recordType: rec, code,
      memo:      patch.memo    ?? cur?.memo    ?? "",
      isDone:    patch.isDone  ?? cur?.isDone  ?? false,
      color:     patch.color   ?? cur?.color   ?? "yellow",
      createdAt: cur?.createdAt ?? "",
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

  const [activeRec,    setActiveRec]    = useState("A")
  const [sectConfig,   setSectConfig]   = useState<TaxSectConfigRow | null>(null)
  const [comparing,    setComparing]    = useState(false)
  const [generating,   setGenerating]   = useState(false)
  const [dirtyTax,     setDirtyTax]     = useState<Map<string, { orgItem: string; item: string }>>(new Map())
  const [selectedIdx,  setSelectedIdx]  = useState<number | null>(null)

  // ── ops 기반 상태 ─────────────────────────────────────────────
  const [baseTax,  setBaseTax]  = useState<TaxLayoutRow[]>([])
  const [baseJava, setBaseJava] = useState<JavaField[]>([])
  const [ops,      setOps]      = useState<EditOp[]>([])
  const [mEdits,   setMEdits]   = useState<Map<number, string>>(new Map())
  const [mLoaded,  setMLoaded]  = useState<Map<number, string>>(new Map())

  // displayRows: baseTax + baseJava + ops → 파생 뷰 (절대 직접 세트하지 않음)
  const displayRows = useMemo(
    () => computeDisplay(baseTax, baseJava, ops, mEdits, mLoaded, sectConfig),
    [baseTax, baseJava, ops, mEdits, mLoaded, sectConfig]
  )

  // 레코드별 비교 캐시
  type CachedRecord = {
    baseTax:    TaxLayoutRow[]
    baseJava:   JavaField[]
    ops:        EditOp[]
    mEdits:     Map<number, string>
    mLoaded:    Map<number, string>
    sectConfig: TaxSectConfigRow | null
  }
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

  const recList = RECORD_TYPES.filter(r => compareCache[r])

  // ── API 응답 → ops 기반 캐시 항목 변환 ───────────────────────

  function loadOpsFromRows(rows: CompareRow[], cfg: TaxSectConfigRow | null): CachedRecord {
    const bt: TaxLayoutRow[] = []
    const bj: JavaField[]    = []
    const opList: EditOp[]   = []
    const me = new Map<number, string>()
    const ml = new Map<number, string>()
    let lastJavaSeq: number | null = null

    for (const row of rows) {
      if (row.tax && row.tax.seq !== 0) bt.push(row.tax)
      if (row.cmd === 'D' && row.java) {
        bj.push(row.java)
        lastJavaSeq = row.java.seq
        opList.push({ id: crypto.randomUUID(), type: 'D', javaSeq: row.java.seq, fromDB: true })
      } else if (row.cmd === 'I') {
        const raw = canonicalize(row.editedRaw ?? '')
        opList.push({ id: crypto.randomUUID(), type: 'I', afterJavaSeq: lastJavaSeq, editedRaw: raw, fromDB: true })
      } else if (row.java && (row.java.lineNo ?? 0) !== 0) {
        bj.push(row.java)
        lastJavaSeq = row.java.seq
        const raw  = canonicalize(row.editedRaw ?? row.java.raw ?? '')
        const orig = canonicalize(row.java.raw ?? '')
        if (raw !== orig) { me.set(row.java.seq, raw); ml.set(row.java.seq, raw) }
      }
    }
    return { baseTax: bt, baseJava: bj, ops: opList, mEdits: me, mLoaded: ml, sectConfig: cfg }
  }

  // ── 탭 스크롤 위치 복원 ──────────────────────────────────────

  function handleTabChange(rec: string) {
    if (scrollDivRef.current) scrollPosRef.current[activeRec] = scrollDivRef.current.scrollTop
    setActiveRec(rec)
    setTimeout(() => { if (scrollDivRef.current) scrollDivRef.current.scrollTop = scrollPosRef.current[rec] ?? 0 }, 0)
  }

  // ── 전체 레코드 한 번에 로드 ──────────────────────────────────

  const loadAllCompare = useCallback(async (y: number) => {
    setComparing(true)
    try {
      const res  = await fetch(`/api/tools/media-layout/compare?year=${y}`)
      const data = await res.json()
      setHwpFile(data.hwpFile ?? null)
      setJavaFile(data.javaFile ?? null)
      const byRecord = data.byRecord as Record<string, { rows: CompareRow[]; sectConfig: TaxSectConfigRow | null }> | undefined
      if (!byRecord) { setCompareCache({}); return }
      const newCache: Record<string, CachedRecord> = {}
      for (const [rec, rd] of Object.entries(byRecord)) {
        newCache[rec] = loadOpsFromRows(rd.rows, rd.sectConfig)
      }
      setCompareCache(newCache)
    } finally { setComparing(false) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 단일 레코드 로드 ──────────────────────────────────────────

  const loadCompare = useCallback(async (y: number, rec: string): Promise<CachedRecord | null> => {
    setComparing(true)
    try {
      const res  = await fetch(`/api/tools/media-layout/compare?record=${rec}&year=${y}`)
      const data = await res.json()
      const rows: CompareRow[] = data.rows ?? []
      const cfg:  TaxSectConfigRow | null = data.sectConfig ?? null
      const cached = loadOpsFromRows(rows, cfg)
      setCompareCache(prev => ({ ...prev, [rec]: cached }))
      return cached
    } catch { return null }
    finally { setComparing(false) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 캐시 → 표시 상태 동기화
  useEffect(() => {
    const cached = compareCache[activeRec]
    if (!cached) {
      setBaseTax([]); setBaseJava([]); setOps([])
      setMEdits(new Map()); setMLoaded(new Map()); setSectConfig(null)
      return
    }
    setBaseTax(cached.baseTax); setBaseJava(cached.baseJava)
    setOps(cached.ops); setMEdits(cached.mEdits); setMLoaded(cached.mLoaded)
    setSectConfig(cached.sectConfig); setDirtyTax(new Map())
  }, [compareCache, activeRec])

  useEffect(() => {
    setCompareCache({})
    loadAllCompare(year)
  }, [year]) // eslint-disable-line react-hooks/exhaustive-deps

  // 모달 드래그 / 리사이즈
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

  function handleD(javaSeq: number) {
    setOps(prev => [...prev, { id: crypto.randomUUID(), type: 'D', javaSeq, fromDB: false }])
  }
  function handleCancelD(opId: string) {
    setOps(prev => prev.filter(o => o.id !== opId))
  }
  function handleI(afterJavaSeq: number | null) {
    setOps(prev => [...prev, { id: crypto.randomUUID(), type: 'I', afterJavaSeq, editedRaw: '', fromDB: false }])
  }
  function handleCancelI(opId: string) {
    setOps(prev => prev.filter(o => o.id !== opId))
  }
  function handleEditI(opId: string, raw: string) {
    setOps(prev => prev.map(o => o.id === opId && o.type === 'I' ? { ...o, editedRaw: raw, fromDB: false } : o))
    setSaveMsg(null)
  }
  function handleEditM(javaSeq: number, raw: string) {
    setMEdits(prev => { const m = new Map(prev); m.set(javaSeq, raw); return m })
    setSaveMsg(null)
  }

  function handleTaxItemEdit(code: string, orgItem: string, item: string) {
    setDirtyTax(prev => {
      const next = new Map(prev)
      const existing = next.get(code)
      next.set(code, { orgItem: existing?.orgItem ?? orgItem, item })
      return next
    })
    setSaveMsg(null)
  }

  // ── 저장 ─────────────────────────────────────────────────────

  async function handleSave() {
    const badI = ops.filter(o => o.type === 'I' && (!o.editedRaw.trim() || !parseMakeStr(o.editedRaw)))
    if (badI.length > 0) {
      toast.error(`I 행 ${badI.length}건: makeStr 입력이 없거나 형식이 올바르지 않습니다.`)
      return
    }
    setSaving(true); setSaveMsg(null)
    try {
      const y = year
      const taxItemUpdates = Array.from(dirtyTax.entries()).map(([, { orgItem, item }]) => ({ recordType: activeRec, orgItem, item }))
      const javaCodeUpdates: { seq: number; javaCode: string }[] = []
      const javaCodeResets:  { seq: number }[] = []
      for (const [seq, raw] of mEdits) {
        const loaded = mLoaded.get(seq) ?? ''
        if (canonicalize(raw) !== canonicalize(loaded)) javaCodeUpdates.push({ seq, javaCode: canonicalize(raw) })
      }
      for (const seq of mLoaded.keys()) {
        if (!mEdits.has(seq)) javaCodeResets.push({ seq })
      }
      const hasOpsChange = ops.length > 0
      const mapRows = hasOpsChange
        ? displayRows
            .map((r, i) => ({
              sortOrder:  i + 1,
              recordType: activeRec,
              taxSeq:     r.isOverflow ? null : (r.tax?.seq ?? null),
              javaSeq:    r.cmd === 'I' ? null : (r.java?.seq ?? null),
              editedRaw:  r.cmd === 'I' ? (r.editedRaw || null) : null,
              rowType:    (r.cmd === 'D' ? 'D' : r.isOverflow ? 'O' : null) as 'D' | 'O' | null,
            }))
            .filter(r => r.taxSeq !== null || r.javaSeq !== null)
        : undefined

      const res = await fetch("/api/tools/media-layout/compare", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: y, taxItemUpdates, javaCodeUpdates, javaCodeResets, mapRows }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      const total = (data.taxUpdated ?? 0) + (data.javaUpdated ?? 0) + (data.mapSaved ?? 0)
      setSaveMsg({ ok: true, text: `저장 완료 (${total}건)` })
      const newCached = await loadCompare(y, activeRec)
      if (newCached) {
        setBaseTax(newCached.baseTax); setBaseJava(newCached.baseJava)
        setOps(newCached.ops); setMEdits(newCached.mEdits); setMLoaded(newCached.mLoaded)
        setSectConfig(newCached.sectConfig); setDirtyTax(new Map())
      }
      setTimeout(() => setSaveMsg(null), 3000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "저장 중 오류가 발생했습니다.")
    } finally { setSaving(false) }
  }

  // ── 편집 초기화 ───────────────────────────────────────────────

  async function handleReset() {
    if (!confirm(`${activeRec}-레코드의 D/I/M 편집 내역을 모두 초기화하시겠습니까?`)) return
    setSaving(true); setSaveMsg(null)
    try {
      const res  = await fetch(`/api/tools/media-layout/compare?record=${activeRec}&year=${year}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setSaveMsg({ ok: true, text: `초기화 완료 (${data.deleted}건 삭제)` })
      const newCached = await loadCompare(year, activeRec)
      if (newCached) {
        setBaseTax(newCached.baseTax); setBaseJava(newCached.baseJava)
        setOps(newCached.ops); setMEdits(newCached.mEdits); setMLoaded(newCached.mLoaded)
        setSectConfig(newCached.sectConfig); setDirtyTax(new Map())
      }
      setTimeout(() => setSaveMsg(null), 3000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "초기화 중 오류가 발생했습니다.")
    } finally { setSaving(false) }
  }

  // ── body_1 → body_N 동기화 ────────────────────────────────────

  function handleCopyBody1ToAll() {
    const body1Rows: DisplayRow[] = []
    let lastSect = ""
    for (const row of displayRows) {
      if (row.tax?.sect) lastSect = row.tax.sect
      if ((row.tax?.sect ?? lastSect) !== "body_1") continue
      body1Rows.push(row)
    }
    if (body1Rows.length === 0) return

    type BodyInfo = { sect: string; rows: DisplayRow[] }
    const bodyInfoMap = new Map<string, BodyInfo>()
    lastSect = ""
    for (const row of displayRows) {
      if (row.tax?.sect) lastSect = row.tax.sect
      const sect = row.tax?.sect ?? lastSect
      if (!/^body_\d+$/.test(sect) || sect === "body_1") continue
      if (!bodyInfoMap.has(sect)) bodyInfoMap.set(sect, { sect, rows: [] })
      bodyInfoMap.get(sect)!.rows.push(row)
    }
    if (bodyInfoMap.size === 0) return

    if (!confirm(`body_1 구조를 ${[...bodyInfoMap.keys()].join(", ")} 영역에 복사하시겠습니까?`)) return

    const body1BaseJava = baseJava.filter(j => j.sect === "body_1")

    let newOps = [...ops]
    const newMEdits = new Map(mEdits)

    for (const { sect, rows: bodyNRows } of bodyInfoMap.values()) {
      const bodyNBaseJava = baseJava.filter(j => j.sect === sect)

      const bodyNAllSeqs = new Set(bodyNRows.map(r => r.java?.seq).filter((s): s is number => s !== undefined))
      newOps = newOps.filter(op => {
        if (op.type === 'D') return !bodyNAllSeqs.has(op.javaSeq)
        if (op.type === 'I') return op.afterJavaSeq === null || !bodyNAllSeqs.has(op.afterJavaSeq)
        return true
      })
      for (const seq of bodyNAllSeqs) newMEdits.delete(seq)

      let lastBodyNSeq: number | null = null
      for (const row of body1Rows) {
        if (row.cmd === 'D' && row.java) {
          const allIdx = body1BaseJava.findIndex(j => j.seq === row.java!.seq)
          const bodyNSeq = bodyNBaseJava[allIdx]?.seq
          if (bodyNSeq !== undefined) {
            newOps.push({ id: crypto.randomUUID(), type: 'D', javaSeq: bodyNSeq, fromDB: false })
            lastBodyNSeq = bodyNSeq
          }
        } else if (row.cmd === 'I') {
          newOps.push({ id: crypto.randomUUID(), type: 'I', afterJavaSeq: lastBodyNSeq, editedRaw: row.editedRaw, fromDB: false })
        } else if (row.java) {
          const allIdx = body1BaseJava.findIndex(j => j.seq === row.java!.seq)
          const bodyNSeq = bodyNBaseJava[allIdx]?.seq
          if (bodyNSeq !== undefined) {
            lastBodyNSeq = bodyNSeq
            if (mEdits.has(row.java.seq)) newMEdits.set(bodyNSeq, mEdits.get(row.java.seq)!)
          }
        }
      }
    }

    setOps(newOps)
    setMEdits(newMEdits)
    setSaveMsg(null)
  }

  function handleCancel() {
    const cached = compareCache[activeRec]
    if (cached) {
      setBaseTax(cached.baseTax); setBaseJava(cached.baseJava)
      setOps(cached.ops); setMEdits(cached.mEdits); setMLoaded(cached.mLoaded)
      setSectConfig(cached.sectConfig)
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
      toast.error(err instanceof Error ? err.message : "소스 생성 중 오류가 발생했습니다.")
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

  const maxLen = displayRows.length

  const parsedSlots = useMemo(
    () => displayRows.map(r => r.editedRaw ? parseMakeStr(r.editedRaw) : null),
    [displayRows],
  )

  const cumData = useMemo(() => {
    let tc = 0, jc = 0
    return displayRows.map((r, i) => {
      if (!r.isOverflow && r.tax?.길이) tc += r.tax.길이
      if (r.cmd !== 'D' && (r.java || r.cmd === 'I')) {
        jc += parsedSlots[i]?.len ?? r.java?.len ?? 0
      }
      return { tc, jc }
    })
  }, [displayRows, parsedSlots])

  const alignedRaws = useMemo(
    () => alignMakeStrs(displayRows.map(r => r.editedRaw)),
    [displayRows],
  )

  const sectBounds = useMemo(() => {
    const s = new Set<number>()
    let prev = ""
    for (let i = 0; i < displayRows.length; i++) {
      const sect = displayRows[i].tax?.sect ?? ""
      if (sect && sect !== prev) { s.add(i); prev = sect }
    }
    return s
  }, [displayRows])

  const gubunBounds = useMemo(() => {
    const m = new Map<number, string>()
    let prev = ""
    for (let i = 0; i < displayRows.length; i++) {
      const g = displayRows[i].tax?.구분 ?? ""
      if (g && g !== prev) { m.set(i, g); prev = g }
    }
    return m
  }, [displayRows])

  const recCacheBytes = useMemo(() => {
    const out: Record<string, { tax: number; java: number }> = {}
    for (const [rec, cached] of Object.entries(compareCache)) {
      const rows = computeDisplay(cached.baseTax, cached.baseJava, cached.ops, cached.mEdits, cached.mLoaded, cached.sectConfig)
      let tc = 0, jc = 0
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        if (!r.isOverflow && r.tax?.길이) tc += r.tax.길이
        if (r.cmd !== 'D' && (r.java || r.cmd === 'I')) {
          const parsed = r.editedRaw ? parseMakeStr(r.editedRaw) : null
          jc += parsed?.len ?? r.java?.len ?? 0
        }
      }
      out[rec] = { tax: tc, java: jc }
    }
    return out
  }, [compareCache])

  const finalTaxBytes  = cumData[maxLen - 1]?.tc ?? 0
  const finalJavaBytes = cumData[maxLen - 1]?.jc ?? 0

  const hasChanges = useMemo(() => {
    if (dirtyTax.size > 0) return true
    if (ops.some(o => !o.fromDB)) return true
    for (const [seq, raw] of mEdits) {
      if (canonicalize(raw) !== canonicalize(mLoaded.get(seq) ?? '')) return true
    }
    for (const seq of mLoaded.keys()) {
      if (!mEdits.has(seq)) return true
    }
    return false
  }, [dirtyTax, ops, mEdits, mLoaded])

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

        <div className="flex items-center gap-1.5 h-8 px-3 border rounded text-sm flex-1 min-w-0 bg-orange-50">
          {comparing ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
           : hwpFile ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
           : <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
          <span className="text-xs text-orange-800 font-medium shrink-0">HWP</span>
          <span className="text-xs truncate text-muted-foreground">
            {hwpFile ? `${hwpFile.hwpFileName} · ${hwpFile.rowCount.toLocaleString()}행` : "미업로드"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 h-8 px-3 border rounded text-sm flex-1 min-w-0 bg-blue-50">
          {comparing ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
           : javaFile ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
           : <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
          <span className="text-xs text-blue-800 font-medium shrink-0">Java</span>
          <span className="text-xs truncate text-muted-foreground">
            {javaFile ? `${javaFile.javaFileName} · ${javaFile.rowCount.toLocaleString()}행` : "미업로드"}
          </span>
        </div>

        <Button variant="outline" size="sm" className="shrink-0 h-8"
          onClick={() => { setCompareCache({}); loadAllCompare(year) }}
          disabled={comparing}>
          <RefreshCw className={cn("h-3 w-3 mr-1", comparing && "animate-spin")} />
          새로고침
        </Button>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setHelpOpen(p => !p)}
            className={cn(
              "h-8 w-8 rounded flex items-center justify-center border transition-colors",
              helpOpen ? "bg-blue-50 border-blue-300 text-blue-600" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
            title="사용법 안내"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          {helpOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setHelpOpen(false)} />
              <div className="absolute right-0 top-9 z-30 w-[600px] bg-background border rounded-lg shadow-lg text-xs">
                <div className="flex border-b">
                  {(["usage", "how"] as const).map(tab => (
                    <button key={tab} type="button"
                      onClick={e => { e.stopPropagation(); setHelpTab(tab) }}
                      className={cn("flex-1 py-2 text-xs font-medium transition-colors",
                        helpTab === tab ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}>
                      {tab === "usage" ? "사용법" : "프로그램 설명"}
                    </button>
                  ))}
                </div>
                <div className="p-4 space-y-3">
                  {helpTab === "usage" ? (
                    <>
                      <p className="text-muted-foreground leading-relaxed">
                        HWP 항목과 Java makeStr을 나란히 비교하고, 항목명·makeStr을 직접 수정하여 저장합니다.
                      </p>
                      <div>
                        <p className="font-semibold mb-1.5">비교 대상</p>
                        <table className="w-full border rounded text-[11px]">
                          <tbody className="divide-y">
                            <tr><td className="px-2 py-1.5 border-r font-medium w-28">서식항목명</td><td className="px-2 py-1.5 text-muted-foreground">HWP↔Java 항목명 불일치 시 <span className="text-orange-600 font-medium">주황색</span> 강조 + 상단 뱃지 카운트</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-medium">데이터타입·길이</td><td className="px-2 py-1.5 text-muted-foreground">타입(X/9) 또는 byte 길이 불일치 시 <span className="text-red-600 font-medium">적색</span> 강조 + 상단 뱃지 카운트</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-medium">누적 바이트</td><td className="px-2 py-1.5 text-muted-foreground">HWP·Java 누적 합계가 다른 행은 <span className="text-red-600 font-medium">적색</span> 표시, 레코드별 차이는 상단 배지에 표시</td></tr>
                          </tbody>
                        </table>
                      </div>
                      <div>
                        <p className="font-semibold mb-1.5">편집 방법</p>
                        <table className="w-full border rounded text-[11px]">
                          <tbody className="divide-y">
                            <tr><td className="px-2 py-1.5 border-r font-bold w-6 text-center bg-red-50 text-red-600">D</td><td className="px-2 py-1.5 text-muted-foreground"><strong className="text-foreground">행 삭제</strong> — Java 행을 소스에서 제외. 클릭 시 해당 행이 취소선으로 표시되고 다음 Java 행이 위 HWP 행과 매치됨</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-bold text-center bg-yellow-50 text-yellow-600">I</td><td className="px-2 py-1.5 text-muted-foreground"><strong className="text-foreground">행 추가</strong> — Java 빈 행 삽입. makeStr을 직접 입력하면 해당 HWP 항목에 새 Java 코드가 추가됨</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-bold text-center bg-blue-50 text-blue-600">M</td><td className="px-2 py-1.5 text-muted-foreground"><strong className="text-foreground">수정 자동 표시</strong> — makeStr 셀을 직접 수정하면 자동으로 M 상태가 됨. 저장 전 변경취소로 원본 복원 가능</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-medium text-center">항목명</td><td className="px-2 py-1.5 text-muted-foreground">HWP 서식항목 셀을 직접 클릭하여 수정. 수정값은 저장 시 DB에 반영되며 원본은 별도 보존됨</td></tr>
                          </tbody>
                        </table>
                      </div>
                      <div>
                        <p className="font-semibold mb-1.5">사용 순서</p>
                        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                          <li>레코드 탭 선택</li>
                          <li>HWP·Java 양쪽 항목 비교 — 서식항목·데이터타입 불일치 확인</li>
                          <li>D·I 버튼으로 Java 행 위치 조정</li>
                          <li>항목명·makeStr 셀 직접 수정 → <strong className="text-foreground">저장</strong></li>
                        </ol>
                      </div>
                      <div>
                        <p className="font-semibold mb-1.5">D · I · M 버튼</p>
                        <table className="w-full border rounded text-[11px]">
                          <tbody className="divide-y">
                            <tr><td className="px-2 py-1.5 border-r font-bold w-6 text-center">D</td><td className="px-2 py-1.5 text-muted-foreground">Java 행 삭제 — 다음 Java 행이 이 국세청 행과 매치됨</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-bold text-center">I</td><td className="px-2 py-1.5 text-muted-foreground">Java 빈 행 삽입 — 아래 Java 행이 한 칸 밀림</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-bold text-center">M</td><td className="px-2 py-1.5 text-muted-foreground">makeStr 내용 수정됨 (셀 편집 시 자동 표시)</td></tr>
                          </tbody>
                        </table>
                      </div>
                      <div>
                        <p className="font-semibold mb-1.5">오류 뱃지</p>
                        <div className="flex gap-3">
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 bg-orange-100 text-orange-700 text-[11px] font-bold">서식항목 N</span>
                          <span className="text-muted-foreground">항목명이 다른 행 수</span>
                        </div>
                        <div className="flex gap-3 mt-1">
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 bg-red-100 text-red-700 text-[11px] font-bold">데이터타입 N</span>
                          <span className="text-muted-foreground">타입 또는 길이가 다른 행 수</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <p className="font-semibold mb-1.5">주요 처리사항</p>
                        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">loadAllCompare()</span> — 전체 레코드 비교 데이터 한 번에 로드, <span className="font-mono text-[10px] bg-muted px-0.5 rounded">compareCache</span>에 레코드별 캐시</li>
                          <li>화면 표시: baseTax + baseJava + ops → computeDisplay() → DisplayRow[] 렌더링</li>
                          <li>서식항목 수정 → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">dirtyTax Map</span> 업데이트 / makeStr 수정 → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">mEdits Map</span> 업데이트</li>
                          <li>M 감지: <span className="font-mono text-[10px] bg-muted px-0.5 rounded">mLoaded</span>(로드 시점 고정) ≠ <span className="font-mono text-[10px] bg-muted px-0.5 rounded">mEdits</span>(현재 값) → M 상태</li>
                          <li>저장 → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">PATCH /api/.../compare</span> — taxItemUpdates + javaCodeUpdates + javaCodeResets + mapRows 동시 전송</li>
                          <li>편집초기화 → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">DELETE /api/.../compare?record=A</span> → MAP 1:1 리셋 → 화면 재로드</li>
                        </ol>
                      </div>
                      <div>
                        <p className="font-semibold mb-1.5">관련 table</p>
                        <table className="w-full border rounded text-[11px]">
                          <thead><tr className="bg-muted/60"><th className="px-2 py-1 text-left border-b border-r font-semibold w-36">테이블</th><th className="px-2 py-1 text-left border-b font-semibold">주요 컬럼 / 역할</th></tr></thead>
                          <tbody className="divide-y">
                            <tr><td className="px-2 py-1.5 border-r font-mono text-[10px]">MLAY_TAX_JAVA_MAP</td><td className="px-2 py-1.5 text-muted-foreground">TAX_SEQ, JAVA_SEQ, SORT_ORDER, ROW_TYPE — 행 매핑 순서. D/I 저장 후 새 순서로 재저장</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-mono text-[10px]">MLAY_JAVA_CODE_EDIT</td><td className="px-2 py-1.5 text-muted-foreground">SEQ, JAVA_CODE — makeStr 수정값 보관</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-mono text-[10px]">MLAY_TAX_ITEM_EDIT</td><td className="px-2 py-1.5 text-muted-foreground">ORG_ITEM, ITEM — 서식항목 수정값 + 원본 보존</td></tr>
                          </tbody>
                        </table>
                      </div>
                      <div>
                        <p className="font-semibold mb-1.5">핵심적인 로직</p>
                        <ul className="space-y-1.5 text-muted-foreground">
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">EditOp[]</span> — D/I 연산 목록. 추가/제거만 하며 배열 직접 수정 없음. D 취소 = filter(id), I 취소 = filter(id)</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">computeDisplay()</span> — baseTax+baseJava+ops를 받아 DisplayRow[]를 파생 계산. 상태 세트 없음</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">compareCache</span> — 레코드별 비교 결과 클라이언트 캐시 (Record&lt;string, CachedRecord&gt;). 탭 전환 시 캐시 있으면 재요청 없음</li>
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

      {/* 바이트 행 + 탭 + 비교 테이블 */}
      {recList.length > 0 && (
        <div className="flex flex-col flex-1 min-h-0 gap-2">
        <div className="flex flex-wrap items-center gap-1 text-xs shrink-0">
          <span className="text-muted-foreground font-medium shrink-0">레코드별 바이트 차이:</span>
          {recList.map(r => {
            const t = r === activeRec ? finalTaxBytes  : (recCacheBytes[r]?.tax  ?? 0)
            const j = r === activeRec ? finalJavaBytes : (recCacheBytes[r]?.java ?? 0)
            const ok = t > 0 && j > 0 && t === j
            const none = !t && !j
            return (
              <span key={r} className={cn(
                "inline-flex items-center rounded-full px-1.5 py-0.5 font-mono font-semibold",
                none ? "bg-gray-100 text-gray-400" : ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
              )}>
                {r}:{none ? "?" : ok ? "일치" : ((j - t) >= 0 ? `+${j - t}` : `${j - t}`)}
              </span>
            )
          })}
        </div>

        <div className={cn("flex flex-col flex-1 min-h-0", isFullscreen && "fixed inset-0 z-40 bg-background p-3")}>
          <div className="flex items-end border-b border-border gap-0.5">
            <div className="flex items-end gap-0.5 min-w-0">
              {recList.map(r => {
                const isActive = r === activeRec
                const isHbf   = compareCache[r]?.sectConfig?.sectMode === "hbf"
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

            <div className="ml-auto flex items-center gap-2 pb-0.5 shrink-0">
              {saveMsg && (
                <span className={`text-xs ${saveMsg.ok ? "text-green-600" : "text-destructive"}`}>{saveMsg.text}</span>
              )}
              <>
                <Button size="sm" variant="outline"
                  className={cn("h-7 text-xs", showSeq && "bg-slate-100 border-slate-400")}
                  onClick={() => setShowSeq(v => !v)}>
                  키값보기
                </Button>
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
              {ops.some(o => o.fromDB) && (
                <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive"
                  onClick={handleReset} disabled={saving}>
                  <RotateCcw className="h-3 w-3 mr-1" />편집초기화
                </Button>
              )}
              {sectConfig?.sectMode === "hbf" && displayRows.some(r => bodyIdx(r.tax?.sect ?? "") > 1) && (
                <Button size="sm" variant="outline"
                  className="h-7 text-xs text-purple-700 border-purple-300 hover:bg-purple-50"
                  onClick={handleCopyBody1ToAll} disabled={saving || hasChanges}
                  title="body_1 Java 내용을 body_2 이후 모든 body 영역에 복사">
                  Body 동기화
                </Button>
              )}
              <Button size="sm" variant="outline"
                className={cn("h-7 w-7 p-0 shrink-0", isFullscreen && "bg-slate-100 border-slate-400")}
                onClick={() => setIsFullscreen(v => !v)}
                title={isFullscreen ? "전체화면 해제" : "전체화면"}>
                {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          <div className="border border-t-0 border-border rounded-b bg-white flex flex-col flex-1 min-h-0">
            <TaxSectInfo rows={displayRows} rightContent={maxLen > 0 ? (
              <>
                <span className={cn("text-xs font-mono", finalTaxBytes !== finalJavaBytes ? "text-red-500 font-bold" : "text-green-600")}>
                  HWP {finalTaxBytes} {finalTaxBytes !== finalJavaBytes ? <><AlertTriangle className="inline h-3 w-3" /> Java {finalJavaBytes}</> : "= Java"}
                </span>
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  onClick={handleGenerate} disabled={generating}>
                  {generating ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />생성 중...</> : <><Code2 className="h-3 w-3 mr-1" />Java 미리보기</>}
                </Button>
              </>
            ) : undefined} />
            <div ref={scrollDivRef} className="overflow-auto flex-1 text-xs">
              <table className="w-full border-collapse table-fixed">
                <colgroup>
                  <col className="w-24" />
                  <col className="w-[18%]" />
                  <col className="w-16" />
                  <col className="w-10" />
                  <col className="w-12" />
                  <col className="w-[18%]" />
                  <col />
                  <col className="w-16" />
                  <col className="w-9" />
                  <col className="w-10" />
                </colgroup>
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="px-2 py-1.5 border-b border-r bg-orange-50 text-orange-800 text-center">번호</th>
                    <th className="pl-1 pr-2 py-1.5 border-b border-r bg-orange-50 text-orange-800 text-left">
                      <span className="flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                        서식항목 <span className="opacity-40 inline-block" style={{transform:"scaleX(-1)"}}>✎</span>
                      </span>
                    </th>
                    <th className="px-2 py-1.5 border-b border-r bg-orange-50 text-orange-800 text-center whitespace-nowrap">데이터타입</th>
                    <th className="px-2 py-1.5 border-b border-r bg-orange-100 text-orange-800 text-center">누적</th>
                    <th className="px-1 py-1.5 border-b border-r bg-muted text-center">D·I·M</th>
                    <th className="px-2 py-1.5 border-b border-r bg-blue-50 text-blue-800 text-left">서식항목</th>
                    <th className="px-2 py-1.5 border-b border-r bg-blue-50 text-blue-800 text-left whitespace-nowrap">makeStr <span className="opacity-40 inline-block" style={{transform:"scaleX(-1)"}}>✎</span></th>
                    <th className="px-2 py-1.5 border-b border-r bg-blue-50 text-blue-800 text-center whitespace-nowrap">데이터타입</th>
                    <th className="px-2 py-1.5 border-b border-r bg-blue-50 text-blue-800 text-center">행</th>
                    <th className="px-2 py-1.5 border-b bg-blue-100 text-blue-800 text-center">누적</th>
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
                    displayRows.flatMap((row, i) => {
                      const { tax, java, cmd, editedRaw, loadedRaw, fromDB, isOverflow, key, opId } = row
                      const isD = cmd === 'D'
                      const isI = cmd === 'I'
                      const isM = !isD && !isI && !!java && canonicalize(editedRaw) !== canonicalize(loadedRaw)
                      const parsedMake   = parsedSlots[i]
                      const makeValid    = !editedRaw || parsedMake !== null
                      const effDtype     = parsedMake?.dtype ?? java?.dtype ?? ""
                      const effLen       = parsedMake?.len   ?? java?.len   ?? 0
                      const mismatch     = !isD && !isOverflow && !!tax && !!effDtype && !!effLen &&
                        (tax.타입 !== effDtype || tax.길이 !== effLen)
                      const itemMismatch = !isD && !isI && !isOverflow && !!tax && !!java &&
                        tax.항목?.replace(/\s+/g, '') !== java.name?.replace(/\s+/g, '')
                      const { tc, jc } = cumData[i] ?? { tc: 0, jc: 0 }
                      const cumMismatch = !isD && !isI && !isOverflow && !!java && tc > 0 && jc > 0 && tc !== jc
                      const isSelected  = selectedIdx === i
                      const rowBg = isSelected ? "bg-blue-100" : isD ? "bg-red-50" : isI ? "bg-yellow-50" : isOverflow ? "bg-pink-50" : (mismatch || cumMismatch) ? "bg-gray-300" : isM ? "bg-blue-50" : taxSectBg(tax?.sect ?? "", sectConfig?.sectMode === "hbf")

                      const noteKey = tax && tax.seq !== 0 ? `${activeRec}-${tax.코드}` : null
                      const note    = noteKey ? notes[noteKey] : undefined

                      const onClickD   = isD ? () => { if (opId) handleCancelD(opId) } : (java ? () => handleD(java.seq) : undefined)
                      const dDisabled  = isI || (!java && !isD)
                      const onClickI   = isI ? () => { if (opId) handleCancelI(opId) } : () => handleI(java?.seq ?? null)
                      const iDisabled  = isD
                      const onChangeMakeStr = isI
                        ? (e: React.ChangeEvent<HTMLInputElement>) => { if (opId) handleEditI(opId, e.target.value) }
                        : (java ? (e: React.ChangeEvent<HTMLInputElement>) => handleEditM(java.seq, e.target.value) : undefined)

                      const nodes = []
                      if (sectBounds.has(i)) nodes.push(<SectSep key={`sep-${i}`} sect={tax?.sect ?? ""} colSpan={10} />)
                      if (gubunBounds.has(i)) {
                        nodes.push(
                          <tr key={`gubun-${i}`} className="bg-sky-50 border-y border-sky-200">
                            <td colSpan={10} className="px-3 py-0.5 text-[11px] font-semibold text-sky-700 select-none">
                              {gubunBounds.get(i)}
                            </td>
                          </tr>
                        )
                      }
                      nodes.push(
                        <tr key={key} onClick={() => setSelectedIdx(isSelected ? null : i)}
                          className={cn(
                            "border-b hover:brightness-[0.97] transition-colors cursor-pointer group",
                            noteKey && openNoteKey === noteKey ? "relative z-[25]" : "",
                            rowBg
                          )}>
                          {/* HWP */}
                          <td className="px-1 py-1 border-r font-mono font-semibold text-center cursor-default">
                            {!isOverflow && (
                              <div className="flex items-center gap-1 justify-center">
                                {showSeq && <span className="text-[9px] text-slate-400 font-normal tabular-nums">{i + 1}</span>}
                                <span>{tax?.코드 ?? ""}</span>
                                {tax?.원본코드 && (
                                  <span title={`원본: ${tax.원본코드}`}
                                    className="text-[9px] leading-none px-0.5 rounded bg-sky-100 text-sky-600 font-medium select-none">수정</span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="pl-1 pr-1 py-0.5 border-r cursor-text align-top">
                            {tax && !isOverflow ? (
                              <div className="flex items-start gap-0 min-w-0">
                                {showSeq && <span className="text-[9px] text-slate-400 tabular-nums shrink-0 self-center pr-0.5">{tax.seq}</span>}
                                <div className="relative shrink-0 self-center" data-note-popup onClick={e => e.stopPropagation()}>
                                  <NoteMarkButton
                                    hasNote={!!note}
                                    isDone={note?.isDone}
                                    onClick={() => tax && (note
                                      ? setOpenNoteKey(openNoteKey === noteKey ? null : noteKey!)
                                      : handleNoteCreate(activeRec, tax.코드)
                                    )}
                                  />
                                  {openNoteKey === noteKey && note && tax && (
                                    <div className="absolute left-0 top-5 z-30">
                                        <ItemNoteSticker
                                          note={note}
                                          item={tax.항목}
                                          onSave={patch => handleNoteSave(activeRec, tax.코드, patch)}
                                          onDelete={() => handleNoteDelete(activeRec, tax.코드)}
                                          onClose={() => setOpenNoteKey(null)}
                                        />
                                    </div>
                                  )}
                                </div>
                                <textarea
                                  ref={el => { if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px` } }}
                                  value={tax.항목 ?? ""}
                                  onChange={e => {
                                    e.target.style.height = "auto"
                                    e.target.style.height = `${e.target.scrollHeight}px`
                                    handleTaxItemEdit(tax.코드, tax.원본항목 ?? tax.항목, e.target.value)
                                  }}
                                  spellCheck={false}
                                  rows={1}
                                  className={cn("flex-1 min-w-0 text-xs px-1 py-0.5 rounded border-0 bg-transparent focus:border focus:border-primary outline-none resize-none overflow-hidden leading-tight break-keep",
                                    itemMismatch && "text-orange-600 font-medium",
                                    dirtyTax.has(tax.코드) && "bg-amber-50")}
                                />
                                {tax.원본항목 && !dirtyTax.has(tax.코드) && (
                                  <span title={`원본: ${tax.원본항목}`}
                                    className="shrink-0 text-[9px] leading-none px-0.5 rounded bg-sky-100 text-sky-600 font-medium select-none mt-0.5">수정</span>
                                )}
                              </div>
                            ) : ""}
                          </td>
                          <td className={cn("px-2 py-1 border-r text-center font-mono cursor-default", mismatch && "text-red-600 font-bold")}
                            title={mismatch ? `Java: ${effDtype}(${effLen})` : undefined}>
                            {tax && !isOverflow ? `${tax.타입 ?? "?"}(${tax.길이 ?? "?"})` : ""}
                            {mismatch && <span className="ml-0.5 text-[10px]">≠</span>}
                          </td>
                          <td className={cn("px-2 py-1 border-r text-right font-mono tabular-nums cursor-default", !tax || isOverflow ? "text-muted-foreground/40" : tc !== jc && tc > 0 ? "text-red-600 font-bold" : tc > 0 ? "text-green-700" : "")}>
                            {!tax || isOverflow ? "" : tc > 0 ? tc : ""}
                          </td>
                          {/* D·I·M */}
                          <td className="px-1 py-0.5 border-r cursor-default">
                            <div className="flex gap-0.5 justify-center">
                              <button onClick={onClickD} disabled={dDisabled}
                                className={cn("w-5 h-5 rounded text-[10px] font-bold transition-colors disabled:opacity-20",
                                  isD ? "bg-red-500 text-white" : "border border-border text-muted-foreground hover:border-red-400 hover:text-red-500")}>D</button>
                              <button onClick={onClickI} disabled={iDisabled}
                                className={cn("w-5 h-5 rounded text-[10px] font-bold transition-colors disabled:opacity-20",
                                  isI ? "bg-yellow-500 text-white" : "border border-border text-muted-foreground hover:border-yellow-400 hover:text-yellow-600")}>I</button>
                              <span className={cn("w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center select-none",
                                isM ? "bg-blue-500 text-white" : "border border-border text-muted-foreground/30")}>M</span>
                            </div>
                          </td>
                          {/* Java */}
                          <td className={cn("px-1 py-0.5 border-r text-xs break-keep cursor-default", itemMismatch && "text-orange-600 font-medium")}>
                            <span className="flex items-start gap-0.5">
                              {showSeq && <span className="text-[9px] text-slate-400 tabular-nums shrink-0 mt-0.5">{java?.seq ?? ""}</span>}
                              <span className="break-keep">{java?.name ?? ""}</span>
                            </span>
                          </td>
                          {/* makeStr */}
                          <td className="px-2 py-0 border-r font-mono whitespace-nowrap cursor-text">
                            {isD ? (
                              <span className="line-through text-red-400 text-[11px]">{alignedRaws[i]}</span>
                            ) : isI ? (
                              <input value={editedRaw} onChange={onChangeMakeStr}
                                placeholder='makeStr("9"|"X", 길이(4자리이하), 값/메소드)'
                                spellCheck={false}
                                className={cn(
                                  "w-full rounded px-1 py-0.5 font-mono text-[11px] outline-none",
                                  editedRaw.trim() && !parseMakeStr(editedRaw)
                                    ? "bg-red-50 border border-red-400 focus:border-red-500"
                                    : "bg-yellow-50 border border-yellow-300 focus:border-yellow-500"
                                )} />
                            ) : java ? (
                              <input value={editedRaw} onChange={onChangeMakeStr}
                                spellCheck={false}
                                className={cn("w-full bg-transparent outline-none font-mono text-[11px] py-0.5",
                                  makeValid
                                    ? "border-0 focus:border focus:border-primary focus:rounded focus:px-1"
                                    : "border border-red-400 rounded px-1 bg-red-50",
                                  isM && makeValid && "text-blue-700")} />
                            ) : null}
                          </td>
                          <td className={cn("px-2 py-1 border-r text-center font-mono cursor-default", mismatch && "text-red-600 font-bold", !makeValid && "text-red-400 line-through")}
                            title={mismatch ? `HWP: ${tax?.타입}(${tax?.길이})` : undefined}>
                            {effDtype && effLen ? `${effDtype}(${effLen})` : ""}
                            {mismatch && <span className="ml-0.5 text-[10px]">≠</span>}
                          </td>
                          <td className="px-2 py-1 border-r text-center text-muted-foreground/60 tabular-nums cursor-default">{java?.lineNo ?? ""}</td>
                          <td className={cn("px-2 py-1 text-right font-mono tabular-nums cursor-default", isD ? "text-muted-foreground/40" : (java || isI) && tc !== jc && jc > 0 ? "text-red-600 font-bold" : (java || isI) && jc > 0 ? "text-green-700" : "")}>
                            {isD ? "-" : (java || isI) && jc > 0 ? jc : ""}
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
        </div>
      )}

      {/* 데이터 없을 때 안내 */}
      {recList.length === 0 && !comparing && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          HWP 파일과 Java 소스를 먼저 업로드하세요.
        </div>
      )}

      {/* Java 소스 미리보기 — 드래그·리사이즈 가능 */}
      {previewCode !== null && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" />
          <div
            className="fixed z-[51] flex flex-col bg-white rounded-lg shadow-2xl border border-border overflow-hidden"
            style={{ left: modalPos.x, top: modalPos.y, width: modalSize.w, height: modalSize.h }}
          >
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

            <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3 bg-gray-50">
              {previewSections.map((sec, si) => (
                <SectionBox key={si} sect={sec.sect} label={sec.label} lines={sec.lines} />
              ))}
            </div>

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
