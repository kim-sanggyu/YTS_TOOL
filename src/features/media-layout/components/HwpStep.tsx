"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FileText, CheckCircle2, AlertCircle, Loader2, Save, Trash2, RotateCcw, HelpCircle } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { TaxRow, HwpFileRow, TaxSectConfigRow, ItemNoteRow } from "@/lib/tax-oracle"
import { ItemNoteSticker, NoteMarkButton } from "./ItemNoteSticker"

const RECORD_TYPES = ["A","B","C","D","E","F","G","H","I","K"]

// ── 일괄 섹션 적용 ─────────────────────────────────────────────

interface BulkConfig { bodyStart: number; bodyEnd: number; divideBy: number }

// ── 반복 구간 자동 감지 ────────────────────────────────────────
// item(서식항목명) 시퀀스의 반복 패턴 + 바이트 합 일치로 body 구간 확정.
// 가장 많이 반복되는 후보를 최적 결과로 선택.

function detectInterval(rows: TaxRow[]): BulkConfig | null {
  if (rows.length < 2) return null

  // item 이름을 앵커로, fieldLen 시퀀스로 검증하는 방식.
  // A 레코드: 모든 item이 유일 → null
  // E/F/G/K 레코드: 반복 body의 첫 item(예: "성명")이 N번 등장 → 간격=unitLen, fieldLen 일치 시 반복 확정
  const items = rows.map(r => (r.item ?? "").replace(/\s+/g, " ").trim())
  const lens  = rows.map(r => r.fieldLen ?? 0)

  // 패딩·예비 용도 item은 앵커 후보에서 제외
  const PADDING = new Set(["공란", "예비", "여백", "미사용", "사용안함", "reserved"])

  // 동일 item이 등장하는 위치 목록 (빈 문자열·패딩 제외)
  const itemPos = new Map<string, number[]>()
  for (let i = 0; i < items.length; i++) {
    const v = items[i]
    if (!v || PADDING.has(v)) continue
    const arr = itemPos.get(v) ?? []
    arr.push(i)
    itemPos.set(v, arr)
  }

  let best: BulkConfig | null = null

  for (const positions of itemPos.values()) {
    if (positions.length < 2) continue  // 유일한 item → 스킵 (A 레코드)

    const s       = positions[0]
    const unitLen = positions[1] - s
    if (unitLen <= 0) continue

    const unitKey = lens.slice(s, s + unitLen).join(",")

    // unitLen 간격으로 fieldLen 시퀀스가 몇 번 연속 일치하는지 카운트
    let repeatCount = 0
    let pos = s
    while (pos + unitLen <= rows.length &&
           lens.slice(pos, pos + unitLen).join(",") === unitKey) {
      repeatCount++
      pos += unitLen
    }

    if (repeatCount < 2) continue

    // 앵커가 body 단위 내부 행일 수 있으므로 앞으로 확장하여 진짜 bodyStart 탐색.
    // unitLen 간격 앞 행의 fieldLen이 일치하는 한 계속 확장.
    let actualStart = s
    while (actualStart > 0) {
      const prev = actualStart - 1
      if (prev + unitLen >= rows.length) break
      if (lens[prev] !== lens[prev + unitLen]) break
      actualStart--
    }

    // 반복 횟수 많은 것 우선, 동점이면 unitLen 긴 것 우선
    const curUnitLen = best
      ? (best.bodyEnd - best.bodyStart + 1) / best.divideBy
      : 0
    if (!best || repeatCount > best.divideBy ||
        (repeatCount === best.divideBy && unitLen > curUnitLen)) {
      best = {
        bodyStart: actualStart + 1,
        bodyEnd:   actualStart + unitLen * repeatCount,
        divideBy:  repeatCount,
      }
    }
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
  const [autoMsg,   setAutoMsg]   = useState<{ ok: boolean; text: string } | null>(null)

  // 주목 노트
  const [notes,       setNotes]       = useState<Record<string, ItemNoteRow>>({}) // key: `${rec}-${code}`
  const [openNoteKey, setOpenNoteKey] = useState<string | null>(null)

  const hasRows = Object.keys(byRecord).length > 0
  const recList = RECORD_TYPES.filter(r => byRecord[r]?.length)

  const scrollDivRef  = useRef<HTMLDivElement>(null)
  const scrollPosRef  = useRef<Record<string, number>>({})

  function handleTabChange(rec: string) {
    if (scrollDivRef.current) {
      scrollPosRef.current[activeRec] = scrollDivRef.current.scrollTop
    }
    setActiveRec(rec)
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

  const notesRef = useRef(notes)
  useEffect(() => { notesRef.current = notes }, [notes])

  useEffect(() => {
    if (!openNoteKey) return
    function handle(e: PointerEvent) {
      if (!(e.target as Element).closest?.("[data-note-popup]")) {
        const note = notesRef.current[openNoteKey]
        if (note && !note.memo.trim()) {
          const sep = openNoteKey.indexOf("-")
          handleNoteDelete(openNoteKey.slice(0, sep), openNoteKey.slice(sep + 1))
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

  async function handleUpload() {
    if (!file) return
    if (hwpFile) {
      const ok = confirm(
        `이미 ${year}년 데이터가 존재합니다.\n\n` +
        `현재 파일: ${hwpFile.hwpFileName} (${hwpFile.rowCount.toLocaleString()}행)\n` +
        `새 파일:   ${file.name}\n\n` +
        `기존 데이터를 모두 삭제하고 새 파일로 덮어쓰시겠습니까?`
      )
      if (!ok) return
    }
    setUploading(true); setUploadErr(""); setSaveMsg(null)
    try {
      const form = new FormData()
      form.append("year", String(year))
      form.append("hwp",  file)
      const res  = await fetch("/api/tools/media-layout/upload", { method: "POST", body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      // 리스트 초기화 후 재로드 — 갱신 느낌 명확히
      setByRecord({})
      setSectConfigs({})
      setDirty(new Map())
      setSaveMsg(null)
      setSectMsg(null)
      await loadRows(year)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ""
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : "업로드 오류")
    } finally { setUploading(false) }
  }

  // ── 삭제 ───────────────────────────────────────────────────

  async function handleDelete() {
    if (!confirm(`${year}년 HWP 업로드 데이터를 삭제하시겠습니까?\n(MLAY_TAX 전체 삭제)`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/tools/media-layout/upload?year=${year}`, { method: "DELETE" })
      if (!res.ok) { const d = await res.json(); throw new Error(d.message) }
      setHwpFile(null)
      setByRecord({})
      setDirty(new Map())
      setSaveMsg(null)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ""
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "삭제 중 오류가 발생했습니다.")
    } finally { setDeleting(false) }
  }

  // ── 셀 편집 ────────────────────────────────────────────────

  function editRow(rec: string, seq: number, patch: Partial<TaxRow>) {
    setByRecord(prev => {
      const rows = prev[rec]?.map(r => r.seq === seq ? { ...r, ...patch } : r) ?? []
      return { ...prev, [rec]: rows }
    })
    setDirty(prev => {
      const next = new Map(prev)
      const cur  = byRecord[rec]?.find(r => r.seq === seq)
      if (cur) next.set(seq, { ...cur, ...patch })
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
        seq: r.seq, code: r.code, item: r.item,
        fieldType: r.fieldType, fieldLen: r.fieldLen,
      }))
      const res  = await fetch("/api/tools/media-layout/tax-rows", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, updates }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setSaveMsg({ ok: true, text: `${data.updated}행 저장 완료` })
      setDirty(new Map())
      await loadRows(year)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "저장 중 오류가 발생했습니다.")
    } finally { setSaving(false) }
  }

  // ── 구간 자동 감지 (전체 레코드 일괄) ────────────────────────

  async function handleAutoDetect() {
    if (!hasRows) return

    // 레코드별 감지 + 새 행 계산
    const detections: { rec: string; cfg: BulkConfig; newRows: TaxRow[] }[] = []
    for (const rec of recList) {
      const rows = byRecord[rec] ?? []
      const cfg  = detectInterval(rows)
      if (!cfg) continue
      detections.push({ rec, cfg, newRows: applyBulk(rows, cfg) })
    }

    if (detections.length === 0) {
      setAutoMsg({ ok: false, text: "반복 구간을 감지하지 못했습니다" })
      setTimeout(() => setAutoMsg(null), 3000)
      return
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
            sectMode:    "hbf",
            bodyStart:   cfg.bodyStart,
            bodyEnd:     cfg.bodyEnd,
            repeatCount: cfg.divideBy,
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
            sectMode: "hbf",
            bodyStart:   cfg.bodyStart,
            bodyEnd:     cfg.bodyEnd,
            repeatCount: cfg.divideBy,
          }
        }
        return next
      })

      setPanelKey(k => k + 1)
      const summary = detections.map(d => `${d.rec}(×${d.cfg.divideBy})`).join("  ")
      setAutoMsg({ ok: true, text: `${detections.length}개 레코드 적용 — ${summary}` })
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
                  "w-14 font-mono font-semibold text-xs px-1 py-0.5 rounded border-0 bg-transparent focus:border focus:border-primary outline-none text-center",
                  (isDirty || r.원본코드) ? "text-amber-700 font-bold" : ""
                )}
                value={r.code}
                spellCheck={false}
                onChange={e => editRow(activeRec, r.seq, { code: e.target.value })}
              />
              {r.원본코드 && !dirty.has(r.seq) && (
                <span title={`원본: ${r.원본코드}`}
                  className="shrink-0 text-[9px] leading-none px-0.5 rounded bg-amber-100 text-amber-700 font-medium select-none">수정</span>
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
                  (isDirty || r.원본항목) ? "text-amber-700 font-bold" : ""
                )}
                value={r.item}
                spellCheck={false}
                onChange={e => editRow(activeRec, r.seq, { item: e.target.value })}
              />
              {r.원본항목 && !dirty.has(r.seq) && (
                <span title={`원본: ${r.원본항목}`}
                  className="shrink-0 text-[9px] leading-none px-0.5 rounded bg-amber-100 text-amber-700 font-medium select-none">수정</span>
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

      {/* 업로드 — 한 줄 */}
      <div className="flex items-center gap-2">

        {/* 귀속연도 */}
        <select
          value={year}
          onChange={e => setYear(parseInt(e.target.value))}
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
                          <li>구조설정에서 Header / Body / Footer 구간 지정 후 <strong className="text-foreground">설정 적용</strong></li>
                          <li>번호·서식항목 셀을 클릭해 직접 수정 → <strong className="text-foreground">저장</strong></li>
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
                            <tr><td className="px-2 py-1.5 border-r font-medium">서식항목 ✎</td><td className="px-2 py-1.5 text-muted-foreground">항목명 — 직접 수정 가능</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-medium">데이터타입</td><td className="px-2 py-1.5 text-muted-foreground">HWP에서 파싱된 데이터 유형</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-medium">길이</td><td className="px-2 py-1.5 text-muted-foreground">필드 바이트 길이</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-medium">누적(HWP)</td><td className="px-2 py-1.5 text-muted-foreground">HWP 원본 누적 바이트</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-medium">누적(계산)</td><td className="px-2 py-1.5 text-muted-foreground">길이 합산 누적 바이트 — <span className="text-red-600 font-medium">빨간색</span>이면 HWP 원본과 불일치</td></tr>
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
                          <li>파싱 결과 → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">saveHwpFile()</span> → MLAY_HWP_FILE + MLAY_TAX INSERT</li>
                          <li>화면에서 번호·서식항목 수정 → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">PATCH /api/.../tax-rows</span> → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">updateTaxRows()</span> → MLAY_TAX_EDIT MERGE</li>
                          <li>구조설정 적용 → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">PUT /api/.../sect-config</span> → MLAY_SECT_CONFIG 저장 + MLAY_TAX.SECT 갱신</li>
                          <li><strong className="text-foreground">구간 자동설정</strong> — 전체 레코드를 순회하며 <span className="font-mono text-[10px] bg-muted px-0.5 rounded">detectInterval()</span>으로 반복 구간 감지 후 병렬 저장</li>
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
                            <tr><td className="px-2 py-1.5 border-r font-mono text-[10px]">MLAY_TAX_EDIT</td><td className="px-2 py-1.5 text-muted-foreground">SEQ(FK→TAX), CODE, ITEM, ORG_CODE, ORG_ITEM — 수정값 + HWP 원본값 보존</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-mono text-[10px]">MLAY_SECT_CONFIG</td><td className="px-2 py-1.5 text-muted-foreground">RECORD, TARGET, SECT_MODE, BODY_START, BODY_END, REPEAT_COUNT — 섹션 구조 설정</td></tr>
                          </tbody>
                        </table>
                      </div>

                      <div>
                        <p className="font-semibold mb-1.5">핵심적인 로직</p>
                        <ul className="space-y-1.5 text-muted-foreground">
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">isValidNext(prev, curr)</span> — 항목번호 연속성 검증. A01→A02, A02→A02ⓐ→A03 등 규칙 처리. 비연속이면 해당 행 스킵</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">GUBUN 공백 제거</span> — <span className="font-mono text-[10px] bg-muted px-0.5 rounded">gm[0].replace(/\s+/g, "")</span> 적용. HWP 텍스트에서 추출된 【 자료 관리 번호 】 → 【자료관리번호】로 정규화. <span className="font-mono text-[10px] bg-muted px-0.5 rounded">currentGubun</span>이 설정되는 3곳 모두 적용</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">accumulated + dlen !== proposedCum</span> — HWP 원본 오타 대응. 누적 불일치 시 HWP 값으로 재동기화</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">updateTaxRows()</span> — MLAY_TAX_EDIT MERGE INTO. ORG_CODE/ORG_ITEM은 최초 수정 시 한 번만 기록, 이후 덮어쓰지 않음</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">detectInterval(rows)</span> — item을 앵커로 반복 구간 자동 감지. ① 동일 item이 복수 등장하는 위치로 unitLen 산출 ② fieldLen 시퀀스 일치로 반복 횟수 검증 ③ 앞으로 확장하여 진짜 bodyStart 탐색. 공란·예비 등 패딩 item은 앵커에서 제외</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">applyBulk()</span> (클라이언트) — bodyStart·bodyEnd·divideBy로 행별 SECT 계산 후 서버에 일괄 저장. MLAY_SECT_CONFIG와 동기화 필수</li>
                          <li>재업로드 시 MLAY_HWP_FILE CASCADE DELETE → MLAY_TAX·MLAY_TAX_EDIT·MLAY_TAX_JAVA_MAP 전체 삭제됨</li>
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
          <div className="flex flex-col flex-1 min-h-0">
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
                        "px-2 py-1.5 text-xs font-medium rounded-t-md transition-colors shrink min-w-[36px] truncate max-w-[100px]",
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
