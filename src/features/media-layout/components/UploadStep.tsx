"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Upload, FileText, FileCode, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react"
import type { TaxLayoutRow } from "../types"
import type { HwpFileRow, TaxSectConfigRow } from "@/lib/tax-oracle"

const RECORD_TYPES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "K"]

// ── 섹션 적용 (미리보기용) ────────────────────────────────────

function applySect(raw: TaxLayoutRow[], cfg: TaxSectConfigRow | null): TaxLayoutRow[] {
  if (!cfg || cfg.sectMode === "body") return raw.map(r => ({ ...r, sect: "BODY_1" }))
  const { bodyStart, bodyEnd, repeatCount } = cfg
  const bodyLen = Math.max(1, bodyEnd - bodyStart + 1)
  return raw.map((r, i) => {
    const rowNum = i + 1
    if (rowNum < bodyStart) return { ...r, sect: "HEAD" }
    const offset  = rowNum - bodyStart
    const bodyNum = Math.floor(offset / bodyLen) + 1
    if (bodyNum <= repeatCount) return { ...r, sect: `BODY_${bodyNum}` }
    return { ...r, sect: "FOOT" }
  })
}

function sectLabel(sect: string): { text: string; cls: string } {
  if (sect === "HEAD")           return { text: "H", cls: "text-gray-500 bg-gray-100" }
  if (sect === "FOOT")           return { text: "F", cls: "text-teal-700 bg-teal-50" }
  if (sect.startsWith("BODY_")) return { text: "B", cls: "text-purple-700 bg-purple-50" }
  return { text: "", cls: "" }
}

// ── UploadStep ────────────────────────────────────────────────

interface FileState { file: File | null; status: "idle" | "ok" | "error"; message?: string }

interface Props {
  initialYear?:   number
  initialUpload?: HwpFileRow | null
}

export function UploadStep({ initialYear, initialUpload }: Props = {}) {
  const [year, setYear] = useState(() => initialYear ?? new Date().getFullYear() - 1)

  const [hwpFile,  setHwpFile]  = useState<FileState>({ file: null, status: "idle" })
  const [javaFile, setJavaFile] = useState<FileState>({ file: null, status: "idle" })
  const [loading,  setLoading]  = useState(false)

  const [existingUpload, setExistingUpload] = useState<HwpFileRow | null>(initialUpload ?? null)
  const [infoLoading,    setInfoLoading]    = useState(false)

  const [uploaded,     setUploaded]     = useState(!!initialUpload)
  const [activeRecord, setActiveRecord] = useState("A")
  const [taxItems,     setTaxItems]     = useState<TaxLayoutRow[]>([])
  const [itemLoading,  setItemLoading]  = useState(false)
  const [sectCfg,      setSectCfg]      = useState<TaxSectConfigRow | null>(null)

  const [formMode,   setFormMode]   = useState<"body" | "hbf">("body")
  const [formStart,  setFormStart]  = useState(1)
  const [formEnd,    setFormEnd]    = useState(1)
  const [formRepeat, setFormRepeat] = useState(1)

  const hwpRef  = useRef<HTMLInputElement>(null)
  const javaRef = useRef<HTMLInputElement>(null)

  // ── 연도 변경 시 기존 데이터 확인 ────────────────────────────

  const checkExisting = useCallback(async (y: number) => {
    setInfoLoading(true)
    try {
      const res  = await fetch(`/api/tools/media-layout/upload?year=${y}`)
      const data = await res.json()
      setExistingUpload(data.upload ?? null)
      if (data.exists) { setUploaded(true); setActiveRecord("A") }
      else             { setUploaded(false); setTaxItems([]) }
    } finally { setInfoLoading(false) }
  }, [])

  const isInitialMount = useRef(true)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      if (initialUpload !== undefined && (initialYear ?? new Date().getFullYear() - 1) === year) return
    }
    checkExisting(year)
  }, [year, checkExisting]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 레코드 탭 전환 ────────────────────────────────────────────

  const loadRecord = useCallback(async (record: string, y: number) => {
    setItemLoading(true)
    try {
      const [cmpRes, cfgRes] = await Promise.all([
        fetch(`/api/tools/media-layout/compare?record=${record}&year=${y}`),
        fetch(`/api/tools/media-layout/sect-config?year=${y}&record=${record}&target=TAX`),
      ])
      const cmpData = await cmpRes.json()
      const cfgData = await cfgRes.json()

      const rows: TaxLayoutRow[] = cmpData.rows
        ?.map((r: any) => r.tax as TaxLayoutRow | null)
        .filter(Boolean) ?? []

      const cfg: TaxSectConfigRow | null = cfgData.config ?? null
      setSectCfg(cfg)
      setFormMode(cfg?.sectMode   ?? "body")
      setFormStart(cfg?.bodyStart  ?? 1)
      setFormEnd(cfg?.bodyEnd      ?? 1)
      setFormRepeat(cfg?.repeatCount ?? 1)
      setTaxItems(rows)
    } finally { setItemLoading(false) }
  }, [])

  useEffect(() => {
    if (uploaded) loadRecord(activeRecord, year)
  }, [activeRecord, uploaded, year, loadRecord])

  // ── 파일 선택 ──────────────────────────────────────────────

  function handleHwpChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.match(/\.hwp$/i)) {
      setHwpFile({ file: null, status: "error", message: "hwp 파일만 허용됩니다." }); return
    }
    setHwpFile({ file: f, status: "ok", message: f.name })
  }

  function handleJavaChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.match(/\.java$/i)) {
      setJavaFile({ file: null, status: "error", message: "java 파일만 허용됩니다." }); return
    }
    setJavaFile({ file: f, status: "ok", message: f.name })
  }

  // ── 업로드 ────────────────────────────────────────────────

  async function handleUpload() {
    if (!hwpFile.file && !javaFile.file) return
    setLoading(true)
    try {
      const form = new FormData()
      form.append("year", String(year))
      if (hwpFile.file)  form.append("hwp",  hwpFile.file)
      if (javaFile.file) form.append("java", javaFile.file)

      const res  = await fetch("/api/tools/media-layout/upload", { method: "POST", body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)

      await checkExisting(year)
    } catch (err) {
      alert(`오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`)
    } finally { setLoading(false) }
  }

  // ── 섹션 설정 저장 ─────────────────────────────────────────

  async function handleApply() {
    const body = {
      year, record: activeRecord, target: "TAX",
      sectMode: formMode, bodyStart: formStart, bodyEnd: formEnd, repeatCount: formRepeat,
    }
    await fetch("/api/tools/media-layout/sect-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    setSectCfg(prev => prev ? { ...prev, sectMode: formMode, bodyStart: formStart, bodyEnd: formEnd, repeatCount: formRepeat } : null)
  }

  const isDirty =
    formMode   !== (sectCfg?.sectMode   ?? "body") ||
    formStart  !== (sectCfg?.bodyStart   ?? 1) ||
    formEnd    !== (sectCfg?.bodyEnd     ?? 1) ||
    formRepeat !== (sectCfg?.repeatCount ?? 1)

  const canUpload   = hwpFile.status === "ok" || javaFile.status === "ok"
  const previewItems = applySect(taxItems, sectCfg)

  return (
    <div className="space-y-4">

      {/* ── 연도 선택 ── */}
      <div className="flex items-center gap-3 px-1">
        <label className="text-sm font-semibold shrink-0">작업 연도</label>
        <input
          type="number"
          value={year}
          min={2020} max={2099}
          onChange={e => setYear(parseInt(e.target.value) || year)}
          className="w-24 h-8 border rounded px-2 text-center font-mono text-sm bg-background"
        />
        {infoLoading ? (
          <span className="text-xs text-muted-foreground">확인 중...</span>
        ) : existingUpload ? (
          <Badge variant="outline" className="gap-1 text-green-700 border-green-300 bg-green-50">
            <CheckCircle2 className="h-3 w-3" />
            {year}년 데이터 있음 — {existingUpload.hwpFileName}
            <span className="text-muted-foreground ml-1">
              ({existingUpload.rowCount.toLocaleString()}행,{" "}
              {new Date(existingUpload.uploadedAt).toLocaleDateString("ko-KR")})
            </span>
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            {year}년 데이터 없음
          </Badge>
        )}
      </div>

      {/* ── 파일 업로드 ── */}
      <div className="grid gap-4 md:grid-cols-2">
        <FileUploadCard
          title="국세청 전산매체 HWP"
          description="전산매체제출요령 HWP 파일"
          icon={FileText}
          accept=".hwp"
          state={hwpFile}
          inputRef={hwpRef}
          onChange={handleHwpChange}
          hint="국세청에서 배포한 귀속연도 전산매체제출요령 파일"
        />
        <FileUploadCard
          title="기존 Java 소스 (선택)"
          description="전산매체 생성 Java 소스 파일"
          icon={FileCode}
          accept=".java"
          state={javaFile}
          inputRef={javaRef}
          onChange={handleJavaChange}
          hint="Java 소스는 'Java 소스 파싱' 메뉴에서 별도 업로드도 가능"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={handleUpload} disabled={!canUpload || loading} size="lg">
          {loading ? (
            <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />파싱 중...</>
          ) : existingUpload ? (
            `${year}년 데이터 재업로드`
          ) : (
            "파일 업로드 및 파싱"
          )}
        </Button>
        {existingUpload && (
          <span className="text-xs text-muted-foreground">
            재업로드 시 {year}년 기존 데이터가 초기화됩니다
          </span>
        )}
      </div>

      {/* ── 파싱 결과 + 섹션 설정 ── */}
      {uploaded && (
        <div className="space-y-3 border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">
            {year}년 레코드별 섹션(H/B/F)을 설정하세요. 설정값은 서버에 저장됩니다.
          </p>

          <Tabs value={activeRecord} onValueChange={setActiveRecord}>
            <TabsList>
              {RECORD_TYPES.map(r => (
                <TabsTrigger key={r} value={r} className="text-xs px-3">{r}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-3 text-xs flex-wrap bg-muted/40 rounded-md px-3 py-2">
            <span className="font-medium text-muted-foreground shrink-0">섹션 구분:</span>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name={`fm-${activeRecord}`} checked={formMode === "body"} onChange={() => setFormMode("body")} className="w-3 h-3" />
              전체 BODY
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name={`fm-${activeRecord}`} checked={formMode === "hbf"} onChange={() => setFormMode("hbf")} className="w-3 h-3" />
              <span className={formMode === "hbf" ? "text-purple-700 font-medium" : ""}>H / B / F</span>
            </label>

            {formMode === "hbf" && (
              <>
                <span className="text-muted-foreground ml-2 shrink-0">BODY 구간:</span>
                <input type="number" min={1} value={formStart}
                  onChange={e => setFormStart(Math.max(1, +e.target.value))}
                  className="w-16 h-6 border rounded px-1 text-center bg-background" />
                <span className="text-muted-foreground">~</span>
                <input type="number" min={1} value={formEnd}
                  onChange={e => setFormEnd(Math.max(1, +e.target.value))}
                  className="w-16 h-6 border rounded px-1 text-center bg-background" />
                <span className="text-muted-foreground shrink-0">행, 반복</span>
                <input type="number" min={1} value={formRepeat}
                  onChange={e => setFormRepeat(Math.max(1, +e.target.value))}
                  className="w-14 h-6 border rounded px-1 text-center bg-background" />
                <span className="text-muted-foreground">회</span>
              </>
            )}

            <Button size="sm" variant={isDirty ? "default" : "outline"} onClick={handleApply}
              className="h-6 text-xs px-3 ml-1">
              적용 저장
            </Button>
            {isDirty  && <span className="text-amber-600 text-[11px]">* 미저장</span>}
            {!isDirty && sectCfg && <span className="text-green-600 text-[11px]">✓ 저장됨</span>}
          </div>

          <div className="rounded-md border overflow-auto max-h-[50vh] text-xs">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-1.5 border-b border-r bg-muted text-center w-10">#</th>
                  <th className="px-2 py-1.5 border-b border-r bg-muted text-center w-8">구분</th>
                  <th className="px-2 py-1.5 border-b border-r bg-orange-50 text-orange-800 text-center w-20">번호</th>
                  <th className="px-2 py-1.5 border-b border-r bg-orange-50 text-orange-800 text-left">서식항목</th>
                  <th className="px-2 py-1.5 border-b bg-orange-50 text-orange-800 text-center w-24">타입(길이)</th>
                </tr>
              </thead>
              <tbody>
                {itemLoading ? (
                  <tr><td colSpan={5} className="text-center text-muted-foreground py-8">불러오는 중...</td></tr>
                ) : previewItems.length === 0 ? (
                  <tr><td colSpan={5} className="text-center text-muted-foreground py-8">{activeRecord}-레코드 항목 없음</td></tr>
                ) : (() => {
                  let prevSect = ""
                  return previewItems.map((item, i) => {
                    const sl = sectLabel(item.sect)
                    const showSep = sectCfg?.sectMode === "hbf" && item.sect !== prevSect
                    prevSect = item.sect
                    return [
                      showSep && (
                        <tr key={`sep-${i}`} className={`border-b border-t ${
                          item.sect === "HEAD" ? "bg-gray-100" : item.sect === "FOOT" ? "bg-teal-50" : "bg-purple-50"
                        }`}>
                          <td colSpan={5} className={`px-3 py-0.5 text-[11px] font-semibold select-none ${
                            item.sect === "HEAD" ? "text-gray-600" : item.sect === "FOOT" ? "text-teal-700" : "text-purple-700"
                          }`}>
                            ▸ {item.sect === "HEAD" ? "HEAD (H)" : item.sect === "FOOT" ? "FOOT (F)" : `${item.sect.replace("_", " ")} (B)`}
                          </td>
                        </tr>
                      ),
                      <tr key={i} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="px-2 py-1 border-r text-center text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-1 border-r text-center">
                          {sectCfg?.sectMode === "hbf" && sl.text && (
                            <span className={`inline-block w-5 h-5 rounded text-[10px] font-bold leading-5 text-center ${sl.cls}`}>{sl.text}</span>
                          )}
                        </td>
                        <td className="px-2 py-1 border-r font-mono font-semibold text-center">{item.코드}</td>
                        <td className="px-2 py-1 border-r">{item.항목}</td>
                        <td className="px-2 py-1 text-center font-mono">
                          {item.타입 && item.길이 ? `${item.타입}(${item.길이})` : ""}
                        </td>
                      </tr>
                    ]
                  })
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── FileUploadCard ────────────────────────────────────────────

function FileUploadCard({ title, description, icon: Icon, accept, state, inputRef, onChange, hint }: {
  title: string; description: string; icon: React.ElementType; accept: string
  state: FileState; inputRef: React.RefObject<HTMLInputElement | null>
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; hint: string
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors">
          {state.status === "ok" ? (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <span className="text-sm font-medium text-green-600">{state.message}</span>
            </div>
          ) : state.status === "error" ? (
            <div className="flex flex-col items-center gap-2">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <span className="text-sm text-destructive">{state.message}</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">클릭하여 파일 선택</span>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{hint}</p>
        <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={onChange} />
      </CardContent>
    </Card>
  )
}
