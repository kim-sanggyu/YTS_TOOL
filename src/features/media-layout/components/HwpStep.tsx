"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FileText, CheckCircle2, AlertCircle, Loader2, Save, Trash2, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import type { TaxRow, HwpFileRow, TaxSectConfigRow } from "@/lib/tax-oracle"

const RECORD_TYPES = ["A","B","C","D","E","F","G","H","I","K"]
const SECT_OPTIONS  = ["header","body_1","body_2","body_3","footer"]

// ── 일괄 섹션 적용 ─────────────────────────────────────────────

interface BulkConfig { bodyStart: number; bodyEnd: number; divideBy: number }

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
  if (sect === "header" || sect === "HEAD" || sect === "HEADER") return "bg-gray-50"
  if (sect === "footer" || sect === "FOOT" || sect === "FOOTER") return "bg-teal-50"
  if (sect.startsWith("body_")) return BODY_BG[(bodyIdx(sect) - 1) % BODY_BG.length]
  return ""
}

// ── 섹션 구분선 ───────────────────────────────────────────────

function SectSep({ sect }: { sect: string }) {
  const isHead = sect === "header" || sect === "HEAD" || sect === "HEADER"
  const isFoot = sect === "footer" || sect === "FOOT" || sect === "FOOTER"
  const num   = bodyIdx(sect)
  const bg    = isHead ? "bg-gray-200"  : isFoot ? "bg-teal-100"  : BODY_BG[(num - 1) % BODY_BG.length]
  const txt   = isHead ? "text-gray-600": isFoot ? "text-teal-700": "text-purple-700"
  const label = isHead ? "▸ Header"     : isFoot ? "▸ Footer"     : `▸ Body-${num}`
  return (
    <tr className={`${bg} border-y`}>
      <td colSpan={6} className={`px-3 py-0.5 text-[11px] font-semibold ${txt} select-none`}>
        {label}
      </td>
    </tr>
  )
}

// ── BulkSectPanel ─────────────────────────────────────────────

function BulkSectPanel({ totalRows, recFields, applying, msg, config, onApply }: {
  totalRows: number
  recFields: TaxRow[]
  applying:  boolean
  msg:       { ok: boolean; text: string } | null
  config:    TaxSectConfigRow | null
  onApply:   (cfg: BulkConfig | null) => void
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
        <span className={mode === "body" ? "text-sky-700 font-medium" : ""}>전체 Body 구조</span>
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
  const [deleting,  setDeleting]  = useState(false)

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
      if (Object.keys(grouped).length > 0)
        setActiveRec(Object.keys(grouped).sort()[0])
    } finally { setChecking(false) }
  }, [])

  // 마운트 및 연도 변경 시 기존 데이터 자동 로드
  useEffect(() => { loadRows(year) }, [year, loadRows])

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
      alert(`삭제 오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`)
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
    const newRows = cfg ? applyBulk(rows, cfg) : rows.map(r => ({ ...r, sect: "body_1" }))
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
          bodyStart:   cfg?.bodyStart  ?? null,
          bodyEnd:     cfg?.bodyEnd    ?? null,
          repeatCount: cfg?.divideBy   ?? null,
        },
      }))
      setSectMsg({ ok: true, text: "구조 설정 저장됨" })
      setTimeout(() => setSectMsg(null), 2000)
    } catch (err) {
      setSectMsg({ ok: false, text: err instanceof Error ? err.message : "저장 오류" })
      setTimeout(() => setSectMsg(null), 3000)
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
    } catch (err) {
      setSaveMsg({ ok: false, text: err instanceof Error ? err.message : "저장 오류" })
    } finally { setSaving(false) }
  }

  // ── 렌더: 섹션 구분선 계산 ────────────────────────────────

  function renderTable(rows: TaxRow[]) {
    const nodes: React.ReactNode[] = []
    let prevSect  = ""
    let prevGubun = ""
    let cumBytes  = 0
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r.sect !== prevSect) { nodes.push(<SectSep key={`sep-${r.seq}`} sect={r.sect} />); prevSect = r.sect }
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
      const isDirty = dirty.has(r.seq)
      const rowBg = isDirty ? "bg-amber-50" : sectRowBg(r.sect)
      nodes.push(
        <tr key={r.seq} className={cn("border-b hover:brightness-95 transition-colors", rowBg)}>
          {/* 번호 */}
          <td className="px-1 py-0.5 border-r">
            <input
              className="w-full font-mono font-semibold text-xs px-1 py-0.5 rounded border-0 bg-transparent focus:bg-white focus:border focus:border-primary outline-none text-center"
              value={r.code}
              onChange={e => editRow(activeRec, r.seq, { code: e.target.value })}
            />
          </td>
          {/* 서식항목 */}
          <td className="px-1 py-0.5 border-r">
            <input
              className="w-full text-xs px-1 py-0.5 rounded border-0 bg-transparent focus:bg-white focus:border focus:border-primary outline-none"
              value={r.item}
              onChange={e => editRow(activeRec, r.seq, { item: e.target.value })}
            />
          </td>
          {/* 데이터타입 */}
          <td className="px-2 py-1 border-r text-center font-mono text-xs">{r.val ?? ""}</td>
          {/* 길이 */}
          <td className="px-2 py-1 border-r text-right font-mono text-xs">{r.fieldLen ?? ""}</td>
          {/* 누적(HWP) */}
          <td className="px-2 py-1 border-r text-right font-mono text-xs tabular-nums text-muted-foreground/60">
            {r.hwpCum ?? ""}
          </td>
          {/* 누적(계산) */}
          {(() => {
            const mismatch = r.hwpCum !== undefined && r.hwpCum !== cumBytes
            return (
              <td className={cn("px-2 py-1 text-right font-mono text-xs tabular-nums", mismatch ? "text-red-500 font-bold" : "text-muted-foreground/60")}>
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
                        "px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors shrink min-w-[36px] truncate max-w-[80px]",
                        baseBg,
                        isActive
                          ? cn("font-semibold border border-border border-b-white -mb-px relative z-10", topLine)
                          : hoverBg
                      )}
                    >
                      {r}-레코드
                      {byRecord[r]?.some(row => dirty.has(row.seq)) && (
                        <span className="ml-1 text-amber-500 font-bold">*</span>
                      )}
                    </button>
                  )
                })}
              </div>
              <div className="ml-auto flex items-center gap-2 pb-0.5">
                {saveMsg && (
                  <span className={`text-xs ${saveMsg.ok ? "text-green-600" : "text-destructive"}`}>
                    {saveMsg.ok ? <><CheckCircle2 className="inline h-3 w-3 mr-1" />{saveMsg.text}</> : saveMsg.text}
                  </span>
                )}
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
                key={activeRec}
                totalRows={byRecord[activeRec]?.length ?? 0}
                recFields={byRecord[activeRec] ?? []}
                applying={sectApplying}
                msg={sectMsg}
                config={sectConfigs[activeRec] ?? null}
                onApply={cfg => handleSectApply(activeRec, cfg)}
              />

              {/* 편집 테이블 */}
              <div ref={scrollDivRef} className="overflow-auto flex-1 text-xs">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr>
                      <th className="px-2 py-1.5 border-b border-r text-center w-20">번호</th>
                      <th className="px-2 py-1.5 border-b border-r text-left min-w-[160px]">서식항목</th>
                      <th className="px-2 py-1.5 border-b border-r text-center w-20">데이터타입</th>
                      <th className="px-1 py-1.5 border-b border-r text-center w-10">길이</th>
                      <th className="px-1 py-1.5 border-b border-r text-center w-16 whitespace-nowrap">누적(HWP)</th>
                      <th className="px-1 py-1.5 border-b text-center w-16 whitespace-nowrap">누적(계산)</th>
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
