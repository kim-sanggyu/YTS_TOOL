"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FileCode, CheckCircle2, AlertCircle, Loader2, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { JavaRow, JavaFileRow } from "@/lib/tax-oracle"

const RECORD_TYPES = ["A","B","C","D","E","F","G","H","I","K"]

// ── 섹션 배경색 ───────────────────────────────────────────────

const BODY_BG = ["bg-purple-50","bg-violet-50","bg-indigo-50","bg-blue-50"]
function bodyNum(sect: string) { const m = sect.match(/^body_(\d+)$/); return m ? parseInt(m[1]) : 0 }
function sectRowBg(sect: string): string {
  if (sect === "header") return "bg-gray-50"
  if (sect === "footer") return "bg-teal-50"
  if (sect.startsWith("body_")) return BODY_BG[(bodyNum(sect) - 1) % BODY_BG.length]
  return ""
}

// ── 섹션 구분선 ───────────────────────────────────────────────

function SectSep({ sect, maxBody }: { sect: string; maxBody: number }) {
  const isHead = sect === "header"
  const isFoot = sect === "footer"
  const num   = bodyNum(sect)
  const treatAsHead = isHead || (num === 1 && maxBody === 1)
  const bg    = treatAsHead ? "bg-gray-200" : isFoot ? "bg-teal-100" : BODY_BG[(num - 1) % BODY_BG.length]
  const txt   = treatAsHead ? "text-gray-600" : isFoot ? "text-teal-700" : "text-purple-700"
  const label = treatAsHead ? "▸ Header" : isFoot ? "▸ Footer" : `▸ Body-${num}${maxBody > 1 ? `/${maxBody}` : ""}`
  return (
    <tr className={`${bg} border-y`}>
      <td colSpan={6} className={`px-3 py-0.5 text-[11px] font-semibold ${txt} select-none`}>{label}</td>
    </tr>
  )
}

// ── 구조 분석 ─────────────────────────────────────────────────

function analyzeStruct(rows: JavaRow[]) {
  const maxBody   = rows.reduce((m, r) => Math.max(m, bodyNum(r.sect)), 0)
  const hasFooter = rows.some(r => r.sect === "footer")
  const isHbf     = maxBody > 1 || hasFooter
  if (!isHbf) return { isHbf: false as const, total: rows.length }
  const headRows   = rows.filter(r => r.sect === "header")
  const body1Rows  = rows.filter(r => r.sect === "body_1")
  const footRows   = rows.filter(r => r.sect === "footer")
  const bodyStart  = body1Rows[0]?.code ?? ""
  const bodyEnd    = body1Rows.at(-1)?.code ?? ""
  return { isHbf: true as const, maxBody, headRows: headRows.length, body1Rows: body1Rows.length, footRows: footRows.length, bodyStart, bodyEnd, total: rows.length }
}

// ── 구조 표시 (읽기전용) ──────────────────────────────────────

function JavaSectInfo({ rows }: { rows: JavaRow[] }) {
  const info = analyzeStruct(rows)
  if (!info.isHbf) {
    return (
      <div className="flex items-center gap-3 text-xs bg-muted/30 px-3 py-2 border-b text-muted-foreground">
        <span className="font-medium text-sky-700">Header 구조</span>
        <span>· 전체 {info.total}행</span>
      </div>
    )
  }
  const recLetter = rows[0]?.code[0] ?? ""
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
    </div>
  )
}

// ── makeStr 열 맞춤 ───────────────────────────────────────────

function alignMakeStrs(raws: (string | undefined)[]): string[] {
  // ) 앞 공백 제거 — 원본 소스의 내부 정렬 공백이 arg 길이를 부풀리는 것을 방지
  const norm = (s: string) => s.replace(/\s+\)/g, ")")
  const parsed = raws.map(raw => {
    if (!raw) return null
    const m = /^makeStr\("([9xX])",\s*(\d+),\s*([\s\S]+)\)$/.exec(raw)
    if (!m) return null
    return { type: m[1], len: m[2], arg: norm(m[3].trimEnd()) }
  })
  const maxLen = Math.max(...parsed.map(p => p?.len.length ?? 0), 0)
  const maxArg = Math.max(...parsed.map(p => p?.arg.length ?? 0), 0)
  return raws.map((raw, i) => {
    const p = parsed[i]
    if (!p || !raw) return raw ?? ""
    return `makeStr("${p.type}", ${p.len.padStart(maxLen)}, ${p.arg.padEnd(maxArg)})`
  })
}

// ── JavaStep ──────────────────────────────────────────────────

export function JavaStep() {
  const fileRef = useRef<HTMLInputElement>(null)
  const scrollDivRef = useRef<HTMLDivElement>(null)
  const scrollPosRef = useRef<Record<string, number>>({})

  const [file,      setFile]      = useState<File | null>(null)
  const [year,      setYear]      = useState(() => new Date().getFullYear() - 1)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState("")
  const [checking,  setChecking]  = useState(false)
  const [javaFile,  setJavaFile]  = useState<JavaFileRow | null>(null)
  const [byRecord,     setByRecord]     = useState<Record<string, JavaRow[]>>({})
  const [activeRec,    setActiveRec]    = useState("A")
  const [deleting,     setDeleting]     = useState(false)
  const [selectedSeq,  setSelectedSeq]  = useState<number | null>(null)

  const hasRows = Object.keys(byRecord).length > 0
  const recList = RECORD_TYPES.filter(r => byRecord[r]?.length)

  // ── 탭 스크롤 위치 복원 ──────────────────────────────────────

  function handleTabChange(rec: string) {
    if (scrollDivRef.current) scrollPosRef.current[activeRec] = scrollDivRef.current.scrollTop
    setActiveRec(rec)
    setTimeout(() => { if (scrollDivRef.current) scrollDivRef.current.scrollTop = scrollPosRef.current[rec] ?? 0 }, 0)
  }

  // ── 로드 ─────────────────────────────────────────────────────

  const loadRows = useCallback(async (y: number) => {
    setChecking(true)
    try {
      const res  = await fetch(`/api/tools/java-layout?year=${y}`)
      const data = await res.json()
      setJavaFile(data.upload ?? null)
      const all: JavaRow[] = data.rows ?? []
      const grouped: Record<string, JavaRow[]> = {}
      for (const row of all) {
        if (!grouped[row.recordType]) grouped[row.recordType] = []
        grouped[row.recordType].push(row)
      }
      setByRecord(grouped)
      if (Object.keys(grouped).length > 0) setActiveRec(Object.keys(grouped).sort()[0])
    } finally { setChecking(false) }
  }, [])

  useEffect(() => { loadRows(year) }, [year, loadRows])

  // ── 파일 선택 ────────────────────────────────────────────────

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.match(/\.(java|txt)$/i)) { setUploadErr(".java 또는 .txt 파일만 허용됩니다."); return }
    setFile(f); setUploadErr("")
  }

  // ── 업로드 ───────────────────────────────────────────────────

  async function handleUpload() {
    if (!file) return
    if (javaFile) {
      const ok = confirm(
        `이미 ${year}년 데이터가 존재합니다.\n\n` +
        `현재 파일: ${javaFile.javaFileName} (${javaFile.rowCount.toLocaleString()}행)\n` +
        `새 파일:   ${file.name}\n\n` +
        `기존 데이터를 모두 삭제하고 새 파일로 덮어쓰시겠습니까?`
      )
      if (!ok) return
    }
    setUploading(true); setUploadErr("")
    try {
      const form = new FormData()
      form.append("year", String(year))
      form.append("java", file)
      const res  = await fetch("/api/tools/java-layout", { method: "POST", body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setByRecord({}); setFile(null)
      if (fileRef.current) fileRef.current.value = ""
      await loadRows(year)
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : "업로드 오류")
    } finally { setUploading(false) }
  }

  // ── 삭제 ─────────────────────────────────────────────────────

  async function handleDelete() {
    if (!confirm(`${year}년 Java 소스 데이터를 삭제하시겠습니까?\n(MLAY_JAVA 전체 삭제)`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/tools/java-layout?year=${year}`, { method: "DELETE" })
      if (!res.ok) { const d = await res.json(); throw new Error(d.message) }
      setJavaFile(null); setByRecord({}); setFile(null)
      if (fileRef.current) fileRef.current.value = ""
    } catch (err) {
      alert(`삭제 오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`)
    } finally { setDeleting(false) }
  }

  // ── 테이블 렌더 ──────────────────────────────────────────────

  function renderTable(rows: JavaRow[]) {
    const nodes: React.ReactNode[] = []
    let prevSect = ""
    let cumBytes = 0
    let maxBody  = 0
    for (const r of rows) { const n = bodyNum(r.sect); if (n > maxBody) maxBody = n }

    const aligned = alignMakeStrs(rows.map(r => r.javaCode))

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r.sect !== prevSect) { nodes.push(<SectSep key={`sep-${r.seq}`} sect={r.sect} maxBody={maxBody} />); prevSect = r.sect }
      cumBytes += r.fieldLen ?? 0
      const isSelected = selectedSeq === r.seq
      const rowBg = isSelected ? "bg-blue-100" : sectRowBg(r.sect)
      nodes.push(
        <tr key={r.seq} onClick={() => setSelectedSeq(isSelected ? null : r.seq)}
          className={cn("border-b hover:brightness-95 transition-colors cursor-pointer", rowBg)}>
          {/* 번호 */}
          <td className="px-2 py-1 border-r font-mono font-semibold text-xs text-center">{r.code}</td>
          {/* 항목명 */}
          <td className="px-2 py-0.5 border-r text-xs">{r.item}</td>
          {/* makeStr */}
          <td className="px-2 py-1 border-r font-mono text-[11px] whitespace-pre text-sky-800">{aligned[i]}</td>
          {/* 타입 */}
          <td className="px-2 py-1 border-r text-center font-mono text-xs">{r.fieldType ?? ""}</td>
          {/* 길이 */}
          <td className="px-2 py-1 border-r text-right font-mono text-xs">{r.fieldLen ?? ""}</td>
          {/* 누적 */}
          <td className="px-2 py-1 text-right font-mono text-xs tabular-nums text-muted-foreground/60">{cumBytes > 0 ? cumBytes : ""}</td>
        </tr>
      )
    }
    return nodes
  }

  // ── JSX ───────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">

      {/* 업로드 한 줄 */}
      <div className="flex items-center gap-2 shrink-0">

        {/* 귀속연도 */}
        <select value={year} onChange={e => setYear(parseInt(e.target.value))}
          className="h-8 border rounded px-2 font-mono text-sm bg-background cursor-pointer shrink-0">
          {Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - 1 - i).map(y => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>

        {/* 파일 상태 */}
        <div onClick={() => fileRef.current?.click()}
          className="flex-1 flex items-center gap-2 h-8 px-3 border rounded cursor-pointer hover:bg-muted/50 transition-colors text-sm min-w-0">
          {file ? (
            <><FileCode className="h-4 w-4 text-primary shrink-0" /><span className="truncate font-medium">{file.name}</span></>
          ) : checking ? (
            <><Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" /><span className="text-muted-foreground">확인 중...</span></>
          ) : javaFile ? (
            <><CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" /><span className="truncate text-green-700">{javaFile.javaFileName}</span>
              <span className="text-xs text-muted-foreground shrink-0 ml-auto pl-2">
                {javaFile.rowCount.toLocaleString()}행 · {(() => { const d = new Date(javaFile.uploadedAt); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}` })()}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground text-xs">파일 없음 — 클릭하여 선택</span>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".java,.txt" className="hidden" onChange={handleFile} />

        {/* 버튼 */}
        <Button onClick={handleUpload} disabled={!file || uploading} size="sm" className="shrink-0">
          {uploading ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />저장 중...</> : "업로드"}
        </Button>
        {javaFile && (
          <Button onClick={handleDelete} disabled={deleting} variant="destructive" size="sm" className="shrink-0">
            {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </Button>
        )}
      </div>

      {uploadErr && (
        <div className="flex items-center gap-2 text-sm text-destructive shrink-0">
          <AlertCircle className="h-4 w-4" />{uploadErr}
        </div>
      )}

      {/* 리스트 */}
      {hasRows && (
        <div className="flex flex-col flex-1 min-h-0 gap-2">

          {/* 총 바이트 검증 */}
          <div className="flex flex-wrap items-center gap-1 text-xs shrink-0">
            {(() => {
              const totals = recList.map(r => ({
                r, bytes: byRecord[r]?.reduce((s, row) => s + (row.fieldLen ?? 0), 0) ?? 0,
              }))
              const base = totals[0]?.bytes ?? 0
              return (
                <>
                  <span className="text-muted-foreground font-medium shrink-0">총 바이트 검증 (기준 {base} byte):</span>
                  {totals.map(({ r, bytes }) => {
                    const ok = bytes === base
                    return (
                      <span key={r} className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-mono font-semibold ${ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {r}:{bytes}
                      </span>
                    )
                  })}
                </>
              )
            })()}
          </div>

          {/* 탭 + 테이블 */}
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-end border-b border-border gap-0.5">
              <div className="flex items-end gap-0.5 min-w-0">
                {recList.map(r => {
                  const isActive = r === activeRec
                  const info     = analyzeStruct(byRecord[r] ?? [])
                  const isHbf    = info.isHbf
                  const baseBg   = isHbf ? "bg-purple-100 text-purple-700" : "bg-sky-50 text-sky-700"
                  const hoverBg  = isHbf ? "hover:bg-purple-200" : "hover:bg-sky-100"
                  const topLine  = isHbf ? "border-t-[3px] border-t-purple-500" : "border-t-[3px] border-t-sky-500"
                  const borderB  = isHbf ? "border-b-purple-100" : "border-b-sky-50"
                  return (
                    <button key={r} type="button" onClick={() => handleTabChange(r)}
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors shrink min-w-[36px] truncate max-w-[80px]",
                        baseBg,
                        isActive
                          ? cn("font-semibold border border-border -mb-px relative z-10", topLine, borderB)
                          : hoverBg
                      )}>
                      {r}-레코드
                    </button>
                  )
                })}
              </div>
              <div className="ml-auto flex items-center gap-2 pb-0.5 shrink-0">
                <Badge variant="outline" className="text-xs">
                  {byRecord[activeRec]?.length ?? 0}행
                </Badge>
              </div>
            </div>

            <div className="border border-t-0 border-border rounded-b bg-white flex flex-col flex-1 min-h-0">
              <JavaSectInfo rows={byRecord[activeRec] ?? []} />
              <div ref={scrollDivRef} className="overflow-auto flex-1 text-xs">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr>
                      <th className="px-2 py-1.5 border-b border-r text-center w-20">번호</th>
                      <th className="px-2 py-1.5 border-b border-r text-left min-w-[120px]">서식항목</th>
                      <th className="px-2 py-1.5 border-b border-r text-left">makeStr</th>
                      <th className="px-1 py-1.5 border-b border-r text-center w-10">타입</th>
                      <th className="px-1 py-1.5 border-b border-r text-center w-10">길이</th>
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
