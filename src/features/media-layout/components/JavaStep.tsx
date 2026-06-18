"use client"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Upload, FileCode, CheckCircle2, AlertCircle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { JavaField } from "../types"

const RECORD_TYPES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "K"]

// ── 섹션 설정 ─────────────────────────────────────────────────

interface BulkConfig {
  bodyStart: number
  bodyEnd: number
  divideBy: number
}

function applyBulkSect(fields: JavaField[], bodyStart: number, bodyEnd: number, divideBy: number): JavaField[] {
  const totalLen = Math.max(1, bodyEnd - bodyStart + 1)
  const unitLen  = Math.max(1, Math.floor(totalLen / divideBy))
  return fields.map((f, i) => {
    const rowNum = i + 1
    if (rowNum < bodyStart) return { ...f, sect: "header" }
    if (rowNum > bodyEnd)   return { ...f, sect: "footer" }
    const offset  = rowNum - bodyStart
    const bodyNum = Math.min(divideBy, Math.floor(offset / unitLen) + 1)
    return { ...f, sect: `body_${bodyNum}` }
  })
}

// ── 배경색 / 구분선 ───────────────────────────────────────────

const BODY_BG = ["bg-purple-50", "bg-violet-50", "bg-indigo-50", "bg-blue-50"]

function bodyNum(sect: string) { const m = sect.match(/^body_(\d+)$/); return m ? parseInt(m[1]) : 0 }

function sectRowBg(sect: string): string {
  if (sect === "header" || sect === "HEAD") return "bg-gray-50"
  if (sect === "footer" || sect === "FOOTER") return "bg-teal-50"
  if (sect.startsWith("body_")) return BODY_BG[(bodyNum(sect) - 1) % BODY_BG.length]
  return ""
}

function SectSep({ sect, totalBody }: { sect: string; totalBody: number }) {
  const isHead = sect === "header" || sect === "HEAD"
  const isFoot = sect === "footer" || sect === "FOOTER"
  const isBody = sect.startsWith("body_") || sect.startsWith("BODY_")
  const num    = isBody ? bodyNum(sect) : 0
  const bg     = isHead ? "bg-gray-200" : isFoot ? "bg-teal-100" : BODY_BG[(num - 1) % BODY_BG.length]
  const text   = isHead ? "text-gray-600" : isFoot ? "text-teal-700" : "text-purple-700"
  const label  = isHead ? "▸ HEADER" : isFoot ? "▸ FOOTER" : `▸ BODY ${totalBody > 1 ? `${num}/${totalBody}` : ""}`
  return (
    <tr className={`${bg} border-y`}>
      <td colSpan={8} className={`px-3 py-0.5 text-[11px] font-semibold ${text} select-none`}>{label}</td>
    </tr>
  )
}

// ── 순서 검증 ─────────────────────────────────────────────────

const _FP = /^([A-K])([0-9]+)([ⓐ-ⓩ]?)$/
const _SF = "ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ"
function seqOk(prev: string, curr: string): boolean {
  const pm = _FP.exec(prev), cm = _FP.exec(curr)
  if (!pm || !cm) return true
  const [, pL, pNs, pS] = pm, [, cL, cNs, cS] = cm
  const pN = parseInt(pNs), cN = parseInt(cNs)
  if (pL !== cL) return true
  if (pS === "" && cS === "") return cN === pN + 1
  if (pS === "" && cS !== "") return (cN === pN || cN === pN + 1) && cS === "ⓐ"
  if (pS !== "" && cS === "") return cN === pN + 1
  if (cN === pN) { const pi = _SF.indexOf(pS), ci = _SF.indexOf(cS); return pi >= 0 && ci === pi + 1 }
  return cN === pN + 1 && cS === "ⓐ"
}

// ── BulkSectPanel ─────────────────────────────────────────────

function BulkSectPanel({ totalRows, config, recFields, onApply }: {
  totalRows: number
  config: BulkConfig
  recFields: JavaField[]
  onApply: (cfg: BulkConfig | null) => void
}) {
  const recLetter = recFields[0]?.record ?? ""
  function rowToNum(row: number) {
    const no = recFields[row - 1]?.no ?? ""; return no.startsWith(recLetter) ? no.slice(recLetter.length) : no
  }
  function numToRow(num: string): number | null {
    const idx = recFields.findIndex(f => f.no === recLetter + num.trim()); return idx >= 0 ? idx + 1 : null
  }

  const [mode, setMode]         = useState<"body" | "hbf">(config.bodyStart === 1 && config.bodyEnd <= 1 ? "body" : "hbf")
  const [cfg,  setCfg]          = useState<BulkConfig>(config)
  const [startNum, setStartNum] = useState(() => rowToNum(config.bodyStart))
  const [endNum,   setEndNum]   = useState(() => rowToNum(config.bodyEnd))
  const [startErr, setStartErr] = useState(false)
  const [endErr,   setEndErr]   = useState(false)

  function handleStart(val: string) { setStartNum(val); const r = numToRow(val); if (r) { setStartErr(false); setCfg(p => ({ ...p, bodyStart: r })) } else setStartErr(true) }
  function handleEnd(val: string)   { setEndNum(val);   const r = numToRow(val); if (r) { setEndErr(false);   setCfg(p => ({ ...p, bodyEnd: r }))   } else setEndErr(true) }

  const totalBodyLen = Math.max(0, cfg.bodyEnd - cfg.bodyStart + 1)
  const unitLen      = cfg.divideBy > 0 ? Math.floor(totalBodyLen / cfg.divideBy) : 0
  const headRows     = cfg.bodyStart - 1
  const footRows     = Math.max(0, totalRows - cfg.bodyEnd)
  const hasErr       = startErr || endErr

  return (
    <div className="flex items-center gap-3 text-xs flex-wrap bg-muted/30 px-3 py-2 border-b">
      <label className="flex items-center gap-1 cursor-pointer shrink-0">
        <input type="radio" name="java-bulk-mode" checked={mode === "body"} onChange={() => setMode("body")} className="w-3 h-3" />
        HEADER 구조
      </label>
      <label className="flex items-center gap-1 cursor-pointer shrink-0">
        <input type="radio" name="java-bulk-mode" checked={mode === "hbf"} onChange={() => setMode("hbf")} className="w-3 h-3" />
        <span className={mode === "hbf" ? "text-purple-700 font-medium" : ""}>HEADER / BODY / FOOTER 구조</span>
      </label>

      {mode === "hbf" && (
        <>
          <span className="text-muted-foreground shrink-0 ml-2">BODY 구간</span>
          <div className="flex items-center">
            <span className="font-mono text-sm font-semibold text-muted-foreground pr-0.5">{recLetter}</span>
            <input type="text" value={startNum} onChange={e => handleStart(e.target.value)}
              className={cn("w-16 h-6 border rounded px-1 text-center bg-background font-mono", startErr && "border-red-400 text-red-600")} />
          </div>
          <span className="text-muted-foreground">~</span>
          <div className="flex items-center">
            <span className="font-mono text-sm font-semibold text-muted-foreground pr-0.5">{recLetter}</span>
            <input type="text" value={endNum} onChange={e => handleEnd(e.target.value)}
              className={cn("w-16 h-6 border rounded px-1 text-center bg-background font-mono", endErr && "border-red-400 text-red-600")} />
          </div>
          <span className="text-muted-foreground shrink-0">분할</span>
          <input type="number" min={1} value={cfg.divideBy}
            onChange={e => setCfg(p => ({ ...p, divideBy: Math.max(1, +e.target.value) }))}
            className="w-14 h-6 border rounded px-1 text-center bg-background" />
          {!hasErr && totalRows > 0 && (
            <span className="text-muted-foreground tabular-nums">
              전체 {totalRows}행
              {headRows > 0 && <> · <span className="text-gray-600">HEADER {headRows}행</span></>}
              {totalBodyLen > 0 && <> · <span className="text-purple-600">BODY {totalBodyLen}행 ÷ {cfg.divideBy} = {unitLen}행×{cfg.divideBy}</span></>}
              {footRows > 0 && <> · <span className="text-teal-600">FOOTER {footRows}행</span></>}
            </span>
          )}
          {hasErr && <span className="text-red-500">{recLetter}? — 항목 번호를 찾을 수 없습니다</span>}
        </>
      )}

      <Button size="sm" className="h-6 text-xs px-3" disabled={mode === "hbf" && hasErr}
        onClick={() => onApply(mode === "hbf" ? cfg : null)}>
        적용
      </Button>
    </div>
  )
}

// ── makeStr 열 맞춤 ───────────────────────────────────────────

function alignMakeStrs(raws: string[]): string[] {
  const parsed = raws.map(raw => {
    const m = /^makeStr\("([9xX])",\s*(\d+),\s*([\s\S]+)\)$/.exec(raw)
    if (!m) return null
    return { type: m[1], len: m[2], arg: m[3].trimEnd() }
  })
  const maxLen = Math.max(...parsed.map(p => p ? p.len.length : 0), 0)
  const maxArg = Math.max(...parsed.map(p => p ? p.arg.length : 0), 0)
  return raws.map((raw, i) => {
    const p = parsed[i]
    if (!p) return raw
    return `makeStr("${p.type}", ${p.len.padStart(maxLen)}, ${p.arg.padEnd(maxArg)})`
  })
}

// ── JavaFieldTable ────────────────────────────────────────────

function JavaFieldTable({ recFields }: { recFields: JavaField[] }) {
  const boundaries = new Set<number>()
  let prevSect = "", maxBody = 0
  for (let i = 0; i < recFields.length; i++) {
    const s = recFields[i].sect
    if (s !== prevSect) { boundaries.add(i); prevSect = s }
    if (s.startsWith("body_")) maxBody = Math.max(maxBody, bodyNum(s))
  }

  const alignedRaws = alignMakeStrs(recFields.map(f => f.raw))

  let lastRealNo: string | null = null
  const seqBreak = recFields.map(f => {
    if (f.no.includes("(")) return false
    const broken = lastRealNo !== null && !seqOk(lastRealNo, f.no)
    lastRealNo = f.no
    return broken
  })

  return (
    <div className="overflow-auto max-h-[65vh] text-xs">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            <th className="px-1 py-1.5 border-b border-r text-center w-8">#</th>
            <th className="px-2 py-1.5 border-b border-r text-center w-20">번호</th>
            <th className="px-2 py-1.5 border-b border-r text-left">makeStr</th>
            <th className="px-2 py-1.5 border-b border-r text-left">항목명</th>
            <th className="px-2 py-1.5 border-b border-r text-center w-16">타입</th>
            <th className="px-2 py-1.5 border-b border-r text-center w-12">길이</th>
            <th className="px-2 py-1.5 border-b border-r text-center w-16">누적</th>
            <th className="px-2 py-1.5 border-b text-center w-16 text-muted-foreground">소스행</th>
          </tr>
        </thead>
        <tbody>
          {recFields.map((f, idx) => (
            <>
              {boundaries.has(idx) && (
                <SectSep key={`sep-${idx}`} sect={f.sect} totalBody={maxBody} />
              )}
              <tr key={idx} className={`border-b hover:brightness-95 transition-colors ${
                seqBreak[idx]        ? "bg-red-100"
                : f.no.includes("(") ? "bg-amber-50"
                : sectRowBg(f.sect)
              }`}>
                <td className="px-1 py-1 border-r text-center text-muted-foreground">{idx + 1}</td>
                <td className={`px-2 py-1 border-r font-mono font-semibold text-center ${
                  seqBreak[idx] ? "text-red-600" : f.no.includes("(") ? "text-amber-600" : ""
                }`}>{f.no}</td>
                <td className="px-2 py-1 border-r font-mono text-[11px] whitespace-pre">{alignedRaws[idx]}</td>
                <td className="px-2 py-1 border-r">{f.name}</td>
                <td className="px-2 py-1 border-r text-center font-mono">{f.dtype}</td>
                <td className="px-2 py-1 border-r text-right font-mono">{f.len}</td>
                <td className="px-2 py-1 border-r text-right font-mono tabular-nums">{f.cum}</td>
                <td className="px-2 py-1 text-center text-muted-foreground/60 tabular-nums">{f.lineNo}</td>
              </tr>
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── JavaStep ──────────────────────────────────────────────────

type ParseResult = {
  total: number
  skipped: number
  records: string[]
  byRecord: Record<string, JavaField[]>
}

export function JavaStep() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file,    setFile]    = useState<File | null>(null)
  const [status,  setStatus]  = useState<"idle" | "loading" | "ok" | "error">("idle")
  const [errMsg,  setErrMsg]  = useState("")
  const [result,  setResult]  = useState<ParseResult | null>(null)
  const [fields,  setFields]  = useState<Record<string, JavaField[]>>({})
  const [activeRec, setActiveRec] = useState("A")
  const [bulkCfg, setBulkCfg]    = useState<Record<string, BulkConfig>>({})

  const [year,    setYear]    = useState(() => new Date().getFullYear() - 1)
  const [saving,  setSaving]  = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function handleSave() {
    if (!file || !result) return
    setSaving(true); setSaveMsg(null)
    try {
      const form = new FormData()
      form.append("year", String(year))
      form.append("java", file)
      const res  = await fetch("/api/tools/media-layout/upload", { method: "POST", body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setSaveMsg({ ok: true, text: `${year}년 저장 완료 (${data.javaRows?.toLocaleString()}행)` })
    } catch (err) {
      setSaveMsg({ ok: false, text: err instanceof Error ? err.message : "저장 오류" })
    } finally { setSaving(false) }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.match(/\.(java|txt)$/i)) {
      setStatus("error"); setErrMsg("java 또는 txt 파일만 허용됩니다."); return
    }
    setFile(f); setStatus("idle"); setResult(null)
  }

  async function handleParse() {
    if (!file) return
    setStatus("loading")
    try {
      const form = new FormData()
      form.append("java", file)
      const res  = await fetch("/api/tools/java-layout", { method: "POST", body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setResult(data)
      setFields(JSON.parse(JSON.stringify(data.byRecord)))
      setActiveRec(data.records[0] ?? "A")
      setStatus("ok")
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "파싱 오류")
      setStatus("error")
    }
  }

  function handleBulkApply(rec: string, cfg: BulkConfig | null) {
    if (!cfg) {
      setFields(prev => ({ ...prev, [rec]: (prev[rec] ?? []).map(f => ({ ...f, sect: "header" })) }))
      return
    }
    setBulkCfg(prev => ({ ...prev, [rec]: cfg }))
    setFields(prev => ({ ...prev, [rec]: applyBulkSect(prev[rec] ?? [], cfg.bodyStart, cfg.bodyEnd, cfg.divideBy) }))
  }

  function getBulkCfg(rec: string): BulkConfig {
    return bulkCfg[rec] ?? { bodyStart: 1, bodyEnd: 1, divideBy: 1 }
  }

  const recList = result?.records ?? []

  return (
    <div className="space-y-4">

      {/* 파일 업로드 */}
      <div className="flex items-start gap-4">
        <div onClick={() => fileRef.current?.click()}
          className="flex-1 cursor-pointer rounded-lg border-2 border-dashed p-6 text-center hover:border-primary/50 hover:bg-muted/40 transition-colors">
          {status === "ok" ? (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <p className="text-sm font-medium text-green-600">{file?.name}</p>
              <p className="text-xs text-muted-foreground">총 {result?.total.toLocaleString()}개 필드 파싱 완료{result?.skipped ? ` (주석 없는 makeStr ${result.skipped}행 제외)` : ""}</p>
            </div>
          ) : status === "error" ? (
            <div className="flex flex-col items-center gap-2">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-destructive">{errMsg}</p>
            </div>
          ) : file ? (
            <div className="flex flex-col items-center gap-2">
              <FileCode className="h-8 w-8 text-primary" />
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">아래 [파싱 시작] 버튼을 클릭하세요</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">전산매체 생성 Java 소스 파일 선택 (.java / .txt)</p>
            </div>
          )}
          <input ref={fileRef} type="file" accept=".java,.txt" className="hidden" onChange={handleFile} />
        </div>

        <div className="flex flex-col gap-2 mt-2">
          <Button onClick={handleParse} disabled={!file || status === "loading"} size="lg">
            {status === "loading" ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />파싱 중...</> : "파싱 시작"}
          </Button>

          {result && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium shrink-0">귀속연도</span>
              <input
                type="number" value={year} min={2020} max={2099}
                onChange={e => setYear(parseInt(e.target.value) || year)}
                className="w-20 h-9 border rounded px-2 text-center font-mono text-sm bg-background"
              />
              <Button onClick={handleSave} disabled={saving} variant="default">
                {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />저장 중...</> : "Oracle 저장"}
              </Button>
              {saveMsg && (
                <span className={`text-xs ${saveMsg.ok ? "text-green-600" : "text-destructive"}`}>
                  {saveMsg.text}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 파싱 결과 */}
      {result && (
        <div className="space-y-2">

          {/* 총 바이트 검증 */}
          {(() => {
            const totals = recList.map(r => {
              const recs = result.byRecord[r] ?? []
              return { r, total: recs.length > 0 ? recs[recs.length - 1].cum : 0 }
            })
            const base = totals[0]?.total ?? 0
            return (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground font-medium">총 바이트 검증 (기준 {base} byte):</span>
                {totals.map(({ r, total }) => {
                  const ok = total === base
                  return (
                    <span key={r} title={`${r}레코드: ${total} byte${ok ? " ✓" : ` — 기준(${base})과 불일치`}`}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono font-semibold ${ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                      {r}: {total}{ok ? " ✓" : " ✗"}
                    </span>
                  )
                })}
              </div>
            )
          })()}

          {/* 브라우저 탭 */}
          <div>
            <div className="flex items-end border-b border-border gap-0.5">
              {RECORD_TYPES.filter(r => recList.includes(r)).map(r => (
                <button key={r} type="button" onClick={() => setActiveRec(r)}
                  className={cn(
                    "px-4 py-1.5 text-xs font-medium rounded-t-md transition-colors",
                    r === activeRec
                      ? "bg-white text-blue-600 font-semibold border border-border border-b-0 -mb-px relative z-10"
                      : "bg-gray-100 text-muted-foreground hover:bg-gray-200"
                  )}>
                  {r}-레코드
                </button>
              ))}
            </div>

            {RECORD_TYPES.filter(r => recList.includes(r)).map(r =>
              r === activeRec ? (
                <div key={r} className="border border-t-0 border-border rounded-b bg-white">
                  <BulkSectPanel
                    totalRows={fields[r]?.length ?? 0}
                    config={getBulkCfg(r)}
                    recFields={fields[r] ?? []}
                    onApply={cfg => handleBulkApply(r, cfg)}
                  />
                  <JavaFieldTable recFields={fields[r] ?? []} />
                </div>
              ) : null
            )}
          </div>

        </div>
      )}
    </div>
  )
}
