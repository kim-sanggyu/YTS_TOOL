"use client"

import { useRef, useState, useCallback, useEffect, useLayoutEffect } from "react"
import { Button } from "@/components/ui/button"
import { CheckCircle2, XCircle, Loader2, RefreshCw, Download, Code2, FileDiff, HelpCircle, Maximize2, Minimize2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { SectionBox } from "./SectionBox"
import { useSidebar } from "@/components/ui/sidebar"
import type { HwpFileRow, JavaFileRow, TaxSectConfigRow } from "@/lib/tax-oracle"

const RECORD_TYPES = ["A","B","C","D","E","F","G","H","I","K"]

type PreviewSection = { sect: string; label: string; lines: string[]; bodyRepeatCount?: number }
type CachedRecord   = { sections: PreviewSection[]; code: string; bytes: number; lines: number }

export function GenerateStep() {
  const scrollDivRef = useRef<HTMLDivElement>(null)
  const scrollPosRef = useRef<Record<string, number>>({})

  const [year,      setYear]      = useState(() => new Date().getFullYear() - 1)
  const yearRef = useRef(year)
  useEffect(() => { yearRef.current = year }, [year])
  const [hwpFile,   setHwpFile]   = useState<HwpFileRow | null>(null)
  const [javaFile,  setJavaFile]  = useState<JavaFileRow | null>(null)
  const [taxBytes,     setTaxBytes]     = useState<Record<string, number>>({})
  const [javaBytes,    setJavaBytes]    = useState<Record<string, number>>({})
  const [typeMismatch, setTypeMismatch] = useState<Record<string, number>>({})
  const [allSectConfigs, setAllSectConfigs] = useState<Record<string, TaxSectConfigRow>>({})
  const [checking,  setChecking]  = useState(false)

  const [activeRec,  setActiveRec]  = useState("A")
  const [sections,   setSections]   = useState<PreviewSection[]>([])
  const [code,       setCode]       = useState("")
  const [stats,      setStats]      = useState<{ lines: number; bytes: number } | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genCache,   setGenCache]   = useState<Record<string, CachedRecord>>({})
  const [helpOpen,   setHelpOpen]   = useState(false)
  const [helpTab,    setHelpTab]    = useState<"usage" | "how">("usage")
  const [patching,   setPatching]   = useState(false)
  const [patchStats, setPatchStats] = useState<{ editCount: number; linesBefore: number; linesAfter: number } | null>(null)

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

  const recList = RECORD_TYPES.filter(r => taxBytes[r] || javaBytes[r])

  // ── 요약 로드 ──────────────────────────────────────────────

  const loadSummary = useCallback(async (y: number) => {
    setChecking(true)
    try {
      const res  = await fetch(`/api/tools/media-layout/summary?year=${y}`)
      const data = await res.json()
      setHwpFile(data.hwpFile ?? null)
      setJavaFile(data.javaFile ?? null)
      setTaxBytes(data.taxBytes ?? {})
      setJavaBytes(data.javaBytes ?? {})
      setTypeMismatch(data.typeMismatch ?? {})
      setAllSectConfigs(data.sectConfigs ?? {})
    } finally { setChecking(false) }
  }, [])

  // ── 레코드 생성 (캐시 없을 때만 API 호출) ──────────────────

  const generateRecord = useCallback(async (y: number, rec: string) => {
    setGenerating(true)
    try {
      const res  = await fetch("/api/tools/media-layout/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record: rec, year: y }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      const cached: CachedRecord = {
        sections: data.sections ?? [],
        code:     data.code     ?? "",
        bytes:    data.bytes    ?? 0,
        lines:    data.lines    ?? 0,
      }
      setGenCache(prev => ({ ...prev, [rec]: cached }))
      setSections(cached.sections)
      setCode(cached.code)
      setStats({ lines: cached.lines, bytes: cached.bytes })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "소스 생성 중 오류가 발생했습니다.")
      setSections([]); setCode(""); setStats(null)
    } finally { setGenerating(false) }
  }, [])

  // ── 탭 전환: 스크롤 복원 + 캐시 우선, 없으면 생성 ──────────

  function handleTabChange(rec: string) {
    if (scrollDivRef.current) scrollPosRef.current[activeRec] = scrollDivRef.current.scrollTop
    setActiveRec(rec)
    setTimeout(() => {
      if (scrollDivRef.current) scrollDivRef.current.scrollTop = scrollPosRef.current[rec] ?? 0
    }, 0)
  }

  useEffect(() => {
    const cached = genCache[activeRec]
    if (cached) {
      setSections(cached.sections); setCode(cached.code)
      setStats({ lines: cached.lines, bytes: cached.bytes })
    } else {
      generateRecord(yearRef.current, activeRec) // yearRef로 stale closure 방지
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRec])

  useEffect(() => {
    loadSummary(year)
    setGenCache({})
    setPatchStats(null)
    generateRecord(year, activeRec)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, loadSummary])

  // ── 원본 소스 패치 다운로드 ────────────────────────────────

  async function handlePatch() {
    setPatching(true); setPatchStats(null)
    try {
      const res  = await fetch("/api/tools/media-layout/patch-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year }),
      })
      const text = await res.text()
      let data: Record<string, unknown>
      try { data = JSON.parse(text) } catch {
        throw new Error(`서버 응답 파싱 실패 (HTTP ${res.status}): ${text.slice(0, 200)}`)
      }
      if (!res.ok) throw new Error((data.message as string) ?? `HTTP ${res.status}`)
      setPatchStats({
        editCount:   data.editCount   as number,
        linesBefore: data.linesBefore as number,
        linesAfter:  data.linesAfter  as number,
      })
      setTimeout(() => setPatchStats(null), 5000)
      // 즉시 다운로드
      const blob = new Blob([data.code as string], { type: "text/plain;charset=utf-8" })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href = url; a.download = `patched_${data.year as number}.java`; a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "소스 패치 중 오류가 발생했습니다.")
    } finally { setPatching(false) }
  }

  // ── makeStr 신규 생성 다운로드 ─────────────────────────────

  function handleDownload() {
    if (!code) return
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement("a")
    a.href = url; a.download = `${activeRec}_record.java`; a.click()
    URL.revokeObjectURL(url)
  }

  // Escape 키: help 팝업 닫기
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && helpOpen) setHelpOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [helpOpen])

  // ── JSX ───────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">

      {/* 상태 바 */}
      <div className="flex items-center gap-2 shrink-0">
        <select value={year} onChange={e => setYear(parseInt(e.target.value))}
          className="h-8 border rounded px-2 font-mono text-sm bg-background cursor-pointer shrink-0">
          {Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - 1 - i).map(y => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>

        <div className="flex items-center gap-1.5 h-8 px-3 border rounded text-sm flex-1 min-w-0 bg-orange-50">
          {checking ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
           : hwpFile ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
           : <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
          <span className="text-xs text-orange-800 font-medium shrink-0">HWP</span>
          <span className="text-xs truncate text-muted-foreground">
            {hwpFile ? `${hwpFile.hwpFileName} · ${hwpFile.rowCount.toLocaleString()}행` : "미업로드"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 h-8 px-3 border rounded text-sm flex-1 min-w-0 bg-blue-50">
          {checking ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
           : javaFile ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
           : <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
          <span className="text-xs text-blue-800 font-medium shrink-0">Java</span>
          <span className="text-xs truncate text-muted-foreground">
            {javaFile ? `${javaFile.javaFileName} · ${javaFile.rowCount.toLocaleString()}행` : "미업로드"}
          </span>
        </div>

        <Button variant="outline" size="sm" className="shrink-0 h-8"
          onClick={() => { loadSummary(year); setGenCache({}); generateRecord(year, activeRec) }}
          disabled={checking || generating}>
          <RefreshCw className={cn("h-3 w-3 mr-1", (checking || generating) && "animate-spin")} />
          새로고침
        </Button>

        {/* 원본 소스 패치 */}
        <div className="flex items-center gap-2 ml-2 pl-2 border-l border-border shrink min-w-0">
          <Button variant="outline" size="sm" className="h-8 text-xs min-w-0 overflow-hidden"
            onClick={handlePatch} disabled={patching || !javaFile}>
            {patching
              ? <><Loader2 className="h-3 w-3 mr-1 shrink-0 animate-spin" /><span className="truncate">패치 중...</span></>
              : <><FileDiff className="h-3 w-3 mr-1 shrink-0" /><span className="truncate">원본 소스 패치 다운로드</span></>}
          </Button>
          {patchStats && (
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              편집 {patchStats.editCount}건 적용 · {patchStats.linesBefore}→{patchStats.linesAfter}행
            </span>
          )}
        </div>

        {/* 사용법 아이콘 */}
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
                        저장된 편집 내용을 반영하여 레코드별 makeStr 소스 코드를 생성하고 미리봅니다.
                      </p>
                      <div>
                        <p className="font-semibold mb-1.5">사용 순서</p>
                        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                          <li>귀속연도 선택 (레코드별 소스 자동 생성)</li>
                          <li>레코드 탭에서 섹션별 makeStr 미리보기 확인</li>
                          <li><strong className="text-foreground">원본 소스 패치 다운로드</strong> — 기존 Java 파일에 전체 편집 내용 반영</li>
                        </ol>
                      </div>
                      <div>
                        <p className="font-semibold mb-1.5">기능 설명</p>
                        <table className="w-full border rounded text-[11px]">
                          <thead><tr className="bg-muted/60"><th className="px-2 py-1 text-left border-b border-r font-semibold w-40">기능</th><th className="px-2 py-1 text-left border-b font-semibold">설명</th></tr></thead>
                          <tbody className="divide-y">
                            <tr><td className="px-2 py-1.5 border-r font-medium">미리보기</td><td className="px-2 py-1.5 text-muted-foreground">섹션(H/B/F)별 색구분된 makeStr 구문 확인</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-medium">다운로드</td><td className="px-2 py-1.5 text-muted-foreground">현재 레코드 소스를 단독 파일로 다운로드</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-medium">원본 소스 패치</td><td className="px-2 py-1.5 text-muted-foreground">기존 Java 파일에 전체 편집 내용을 반영한 파일 다운로드</td></tr>
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <p className="font-semibold mb-1.5">주요 처리사항</p>
                        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">POST /api/.../generate</span> → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">buildCompareRowsFromMap()</span>으로 MAP(SORT_ORDER 순) + MLAY_JAVA + MLAY_JAVA_CODE_EDIT 결합</li>
                          <li>ROW_TYPE='D' 행 제외, ROW_TYPE=null·I 행 포함. 각 줄 끝에 <span className="font-mono text-[10px] bg-muted px-0.5 rounded">{"// 코드 구분 항목명"}</span> 주석 추가</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">alignSections()</span> — 전체 makeStr을 한 번에 열 정렬 (타입·길이·인자 컬럼 맞춤)</li>
                          <li>미리보기: Body-1만 표시 + body_sum 섹션 자동 삽입 (X/9 타입별 연속 합산, 미리보기 전용)</li>
                          <li>결과를 <span className="font-mono text-[10px] bg-muted px-0.5 rounded">genCache[activeRec]</span>에 캐시 → 탭 재전환 시 재요청 없음</li>
                          <li>원본 패치: <span className="font-mono text-[10px] bg-muted px-0.5 rounded">POST /api/.../patch-source</span> → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">applyEdits()</span> → <span className="font-mono text-[10px] bg-muted px-0.5 rounded">patched_연도.java</span> 다운로드. MLAY_JAVA_FILE.JAVA_DATA(원본 소스 전문)에 LINE_NO 기반 편집 적용</li>
                        </ol>
                      </div>
                      <div>
                        <p className="font-semibold mb-1.5">관련 table</p>
                        <table className="w-full border rounded text-[11px]">
                          <thead><tr className="bg-muted/60"><th className="px-2 py-1 text-left border-b border-r font-semibold w-36">테이블</th><th className="px-2 py-1 text-left border-b font-semibold">주요 컬럼 / 역할</th></tr></thead>
                          <tbody className="divide-y">
                            <tr><td className="px-2 py-1.5 border-r font-mono text-[10px]">MLAY_TAX_JAVA_MAP</td><td className="px-2 py-1.5 text-muted-foreground">SORT_ORDER, TAX_SEQ, JAVA_SEQ, ROW_TYPE(D/O/null) — 소스 생성 행 순서의 원천. ROW_TYPE='D' 행은 생성 시 제외</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-mono text-[10px]">MLAY_JAVA_CODE_EDIT</td><td className="px-2 py-1.5 text-muted-foreground">SEQ(FK→MLAY_JAVA), JAVA_CODE — M 수정된 makeStr. 소스 생성 및 패치 모두에 반영</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-mono text-[10px]">MLAY_JAVA_FILE</td><td className="px-2 py-1.5 text-muted-foreground">JAVA_DATA(원본 소스 전문) — 패치 시 이 텍스트에 D/M 편집을 LINE_NO 기반으로 적용 후 반환</td></tr>
                            <tr><td className="px-2 py-1.5 border-r font-mono text-[10px]">MLAY_JAVA</td><td className="px-2 py-1.5 text-muted-foreground">LINE_NO — 원본 소스 라인 번호. 패치 시 D(삭제)·M(교체) 위치 특정에 사용. LINE_NO=0은 I 삽입 행</td></tr>
                          </tbody>
                        </table>
                      </div>
                      <div>
                        <p className="font-semibold mb-1.5">핵심적인 로직</p>
                        <ul className="space-y-1.5 text-muted-foreground">
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">buildCompareRowsFromMap()</span> — MAP SORT_ORDER 순으로 taxBySeq·javaBySeq 조회. ROW_TYPE='D'→cmd='D', LINE_NO=0→cmd='I', MLAY_JAVA_CODE_EDIT 있으면 editedRaw 반영</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">alignSections()</span> — 전체 makeStr 라인을 파싱 후 maxLen/maxArg 계산 → padStart/padEnd 적용. 다운로드 코드와 미리보기 모두에 적용</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">applyEdits()</span> (patch-source/route.ts) — 원본 라인 배열에 deleteLines(Set) + replaceLines(Map) + insertAfter(Map) 세 가지를 순서대로 적용</li>
                          <li><span className="font-mono text-[10px] bg-muted px-0.5 rounded">replaceMakeStr()</span> — 원본 라인에서 괄호 깊이 추적으로 makeStr() 범위를 정확히 찾아 교체. 들여쓰기와 후행 세미콜론·주석 보존</li>
                          <li>body_sum — Body-1 라인을 타입(X/9)별 연속 그룹화, 합산 길이·행 범위 표시. 다운로드 코드에는 포함되지 않음 (미리보기 전용)</li>
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

      {/* 바이트 행 + 탭 + 섹션 박스 */}
      {recList.length > 0 && (
        <div className="flex flex-col flex-1 min-h-0 gap-2">
        <div className="flex flex-wrap items-center gap-1 text-xs shrink-0">
          <span className="text-muted-foreground font-medium shrink-0">레코드별 바이트 차이:</span>
          {recList.map(r => {
            const t  = taxBytes[r]     ?? 0
            const j  = javaBytes[r]    ?? 0
            const dm = typeMismatch[r] ?? 0
            const none   = !t && !j
            const byteOk = t > 0 && j > 0 && t === j
            // 우선순위: 자바길이차이 > 타입불일치 > 일치
            const label = none ? "?" : !byteOk ? ((j - t) >= 0 ? `+${j - t}` : `${j - t}`) : dm > 0 ? "불일치" : "일치"
            const cls   = none ? "bg-gray-100 text-gray-400" : (byteOk && !dm) ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            return (
              <span key={r} className={cn(
                "inline-flex items-center rounded-full px-1.5 py-0.5 font-mono font-semibold", cls
              )}>{r}:{label}</span>
            )
          })}
        </div>

        {/* 탭 + 섹션 박스 */}
        <div className={cn("flex flex-col flex-1 min-h-0", isFullscreen && "fixed inset-y-0 right-0 z-40 bg-background p-3 left-(--sidebar-width-icon)")}>
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

            <div className="ml-auto flex items-center gap-2 pb-0.5 shrink-0">
              {stats && (
                <>
                  <span className="text-xs text-muted-foreground tabular-nums">{stats.lines}줄</span>
                  <span className="text-xs font-mono text-muted-foreground tabular-nums">{stats.bytes} byte</span>
                </>
              )}
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={handleDownload} disabled={!code || generating}>
                <Download className="h-3 w-3 mr-1" />다운로드
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
            <div ref={scrollDivRef} className="overflow-auto flex-1 p-3 space-y-3 bg-gray-50">
              {generating ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />생성 중...
                </div>
              ) : sections.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground text-sm">
                  <Code2 className="h-8 w-8 opacity-30" />
                  HWP 파일과 Java 소스를 먼저 업로드하세요.
                </div>
              ) : (
                sections.map((sec, si) => (
                  <SectionBox key={`${sec.sect}-${si}`} sect={sec.sect} label={sec.label} lines={sec.lines} bodyRepeatCount={sec.bodyRepeatCount} />
                ))
              )}
            </div>
          </div>
        </div>
        </div>
      )}

      {recList.length === 0 && !checking && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          HWP 파일과 Java 소스를 먼저 업로드하세요.
        </div>
      )}
    </div>
  )
}
