"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  CheckCircle2, XCircle, Loader2, Play, Trash2,
  RefreshCw, Square, ArrowRight, StopCircle
} from "lucide-react"
import { toast } from "sonner"
import { SCRIPT_META } from "@/features/tax-calculate/data-migration/lib/scripts"
import { MigrationInfoDialog } from "@/features/tax-calculate/data-migration/components/MigrationInfoDialog"
import { cn } from "@/lib/utils"

type ScriptStatus = "idle" | "running" | "done" | "error"

interface ScriptState {
  id: string
  table: string
  status: ScriptStatus
  fromCount?: number
  toCount?: number
  substituted?: number
}

interface PreviewCount { table: string; fromCount: number; toCount: number }

const LOG_COLORS: Record<string, string> = {
  "[START]": "text-blue-400 font-semibold",
  "[COMPLETE]": "text-emerald-400 font-semibold",
  "[FAILED]": "text-red-400 font-semibold",
  "[RUNNING]": "text-yellow-300",
  "[SUCCESS]": "text-emerald-300",
  "[FAILURE]": "text-red-400",
  "====": "text-gray-500",
  ">> ": "text-cyan-300",
  "오류": "text-red-400",
}

function LogLine({ msg }: { msg: string }) {
  const colorClass = Object.entries(LOG_COLORS).find(([k]) => msg.includes(k))?.[1] ?? "text-gray-300"
  return <div className={cn("leading-5 text-xs font-mono whitespace-pre-wrap break-all", colorClass)}>{msg || " "}</div>
}

function StatusBadge({ status }: { status: ScriptStatus }) {
  if (status === "idle") return null
  if (status === "running") return (
    <Badge variant="outline" className="gap-1 text-yellow-600 border-yellow-400 bg-yellow-50 py-0 px-1.5">
      <Loader2 className="h-3 w-3 animate-spin" />실행중
    </Badge>
  )
  if (status === "done") return (
    <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-400 bg-emerald-50 py-0 px-1.5">
      <CheckCircle2 className="h-3 w-3" />완료
    </Badge>
  )
  return (
    <Badge variant="outline" className="gap-1 text-red-600 border-red-400 bg-red-50 py-0 px-1.5">
      <XCircle className="h-3 w-3" />오류
    </Badge>
  )
}

export function MigrationPanel() {
  const currentYear = new Date().getFullYear()
  const fromYear = String(currentYear - 1)
  const toYear = String(currentYear)

  const [scripts, setScripts] = useState<ScriptState[]>(
    SCRIPT_META.map(s => ({ id: s.id, table: s.table, status: "idle" }))
  )
  const [logs, setLogs] = useState<string[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs])

  const fetchPreview = useCallback(async (from: string, to: string) => {
    setIsPreviewing(true)
    try {
      const res = await fetch(`/api/tools/data-migration/preview?fromYear=${from}&toYear=${to}`)
      if (!res.ok) throw new Error("조회 실패")
      const data: PreviewCount[] = await res.json()
      setScripts(prev => prev.map(s => {
        const found = data.find(d => d.table === s.table)
        return found ? { ...s, fromCount: found.fromCount, toCount: found.toCount } : s
      }))
    } catch {
      toast.error("건수 조회에 실패했습니다.")
    } finally {
      setIsPreviewing(false)
    }
  }, [])

  useEffect(() => { fetchPreview(fromYear, toYear) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const resetStatuses = () => {
    setScripts(prev => prev.map(s => ({ ...s, status: "idle" as ScriptStatus, fromCount: undefined, toCount: undefined })))
    setLogs([])
  }

  const runScripts = async (scriptIds: string[]) => {
    if (isRunning || scriptIds.length === 0) return

    // X{toYear} 데이터 사전 확인
    const alreadyExists = scripts.filter(s =>
      scriptIds.includes(s.id) && (s.toCount ?? 0) > 0
    )
    if (alreadyExists.length > 0) {
      const tableList = alreadyExists.map(s => `• ${s.table} (${s.toCount}건)`).join("\n")
      toast.error(
        `X${toYear} 데이터가 이미 존재합니다.\n실행을 중단합니다.\n\n${tableList}`,
        { duration: 6000, style: { whiteSpace: "pre-line" } }
      )
      return
    }

    // toCount가 아직 로딩되지 않은 경우 (preview 미완료)
    const notLoaded = scripts.filter(s => scriptIds.includes(s.id) && s.toCount === undefined)
    if (notLoaded.length > 0) {
      toast.error("건수 조회가 완료되지 않았습니다. 잠시 후 다시 시도하세요.")
      return
    }

    resetStatuses()
    setIsRunning(true)

    try {
      const res = await fetch("/api/tools/data-migration/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scripts: scriptIds, fromYear, toYear }),
      })

      if (!res.body) throw new Error("스트림 없음")

      const reader = res.body.getReader()
      readerRef.current = reader
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split("\n\n")
        buffer = parts.pop() ?? ""

        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith("data: ")) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === "log") {
              setLogs(prev => [...prev, event.msg])
            } else if (event.type === "status") {
              setScripts(prev => prev.map(s =>
                s.id === event.scriptId
                  ? { ...s, status: event.state as ScriptStatus, ...(event.substituted != null ? { substituted: event.substituted as number } : {}) }
                  : s
              ))
            } else if (event.type === "done") {
              if (event.success) toast.success("마이그레이션이 완료되었습니다.")
              else toast.error("마이그레이션 중 오류가 발생했습니다.")
            }
          } catch { /* JSON 파싱 오류 무시 */ }
        }
      }
    } catch (err) {
      if (!cancelledRef.current) {
        toast.error(`실행 오류: ${err instanceof Error ? err.message : String(err)}`)
      }
    } finally {
      if (cancelledRef.current) {
        toast.info("마이그레이션이 취소되었습니다.")
        cancelledRef.current = false
      }
      readerRef.current = null
      setIsRunning(false)
      fetchPreview(fromYear, toYear)
    }
  }

  const cancelMigration = () => {
    cancelledRef.current = true
    setScripts(prev => prev.map(s => s.status === "running" ? { ...s, status: "idle" as ScriptStatus } : s))
    setLogs(prev => [...prev, "", "====================================================", " [CANCELLED] 취소 요청됨. 현재 작업 완료 후 중단합니다.", "===================================================="])
    readerRef.current?.cancel()
    readerRef.current = null
  }

  const deleteToYear = async () => {
    const activeTables = scripts.map(s => s.table)
    if (activeTables.length === 0) { toast.error("삭제할 테이블을 선택하세요."); return }
    if (!confirm(`선택된 ${activeTables.length}개 테이블에서 X${toYear} 데이터를 삭제합니다.\n이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`)) return

    setIsDeleting(true)
    try {
      const res = await fetch("/api/tools/data-migration/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tables: activeTables, toYear }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`X${toYear} 데이터 삭제 완료 (총 ${data.totalDeleted}건)`)
      setScripts(prev => prev.map(s => ({ ...s, status: "idle" as ScriptStatus, substituted: undefined })))
      fetchPreview(fromYear, toYear)
    } catch (err) {
      toast.error(`삭제 오류: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsDeleting(false)
    }
  }

  const activeScriptIds = scripts.map(s => s.id)

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* 좌측: 스크립트 목록 */}
      <div className="flex flex-col w-96 shrink-0 gap-3">
        {/* 연도 표시 */}
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5">
          <span className="text-xs text-muted-foreground">기준연도</span>
          <span className="text-sm font-mono font-semibold">Y{fromYear}</span>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-mono font-semibold text-primary">X{toYear}</span>
          <span className="text-xs text-muted-foreground">생성</span>
          <div className="ml-auto">
            <MigrationInfoDialog toYear={toYear} />
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex flex-col gap-2">
          {isRunning ? (
            <Button
              onClick={cancelMigration}
              className="w-full gap-2 bg-red-600 hover:bg-red-700 text-white"
            >
              <StopCircle className="h-4 w-4" />취소 (현재 작업 완료 후 중단)
            </Button>
          ) : (
            <Button
              onClick={() => runScripts(activeScriptIds)}
              disabled={isDeleting || activeScriptIds.length === 0}
              className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Play className="h-4 w-4" />전체 실행 ({activeScriptIds.length}개)
            </Button>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={deleteToYear}
              disabled={isRunning || isDeleting || activeScriptIds.length === 0}
              className="flex-1 gap-1.5 text-red-600 border-red-300 hover:bg-red-50"
            >
              {isDeleting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Trash2 className="h-3.5 w-3.5" />
              }
              X{toYear} 삭제
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchPreview(fromYear, toYear)}
              disabled={isPreviewing || isRunning}
              className="flex-1 gap-1.5"
            >
              {isPreviewing
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />
              }
              건수 갱신
            </Button>
          </div>
        </div>

        {/* 스크립트 목록 */}
        <div className="flex flex-col gap-1 overflow-y-auto">
          {scripts.map((s, i) => (
            <div
              key={s.id}
              className="rounded border px-2.5 h-9 bg-card flex items-center"
            >
              <div className="flex items-center gap-2 w-full">
                <span className="text-xs text-muted-foreground font-mono w-4 shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-xs font-medium flex-1 truncate">{s.table}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {(s.fromCount !== undefined) && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      {s.substituted != null && (
                        <span className="text-blue-500 font-semibold">{s.substituted}건</span>
                      )}
                      {s.fromCount}<span className="text-muted-foreground/50 mx-0.5">/</span>
                      <span className={cn((s.toCount ?? 0) > 0 ? "text-amber-600" : "text-muted-foreground")}>{s.toCount ?? 0}</span>
                    </span>
                  )}
                  <StatusBadge status={s.status} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground px-0.5 pt-1 text-right">
          ※ <span className="font-mono">Y{fromYear}</span> 원본 / <span className="font-mono text-amber-600">X{toYear}</span> 생성 건수 (주황 = 이미 존재)
        </p>
      </div>

      {/* 우측: 로그 패널 */}
      <div className="flex-1 flex flex-col min-h-0 rounded-lg border bg-gray-950 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="h-3 w-3 rounded-full bg-red-500/70" />
              <div className="h-3 w-3 rounded-full bg-yellow-500/70" />
              <div className="h-3 w-3 rounded-full bg-green-500/70" />
            </div>
            <span className="text-xs text-gray-400 font-mono">실행 로그</span>
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <span className="flex items-center gap-1 text-xs text-yellow-400">
                <Loader2 className="h-3 w-3 animate-spin" />실행 중
              </span>
            )}
            <button
              onClick={resetStatuses}
              disabled={isRunning}
              className="text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
              title="로그 지우기"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {logs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm font-mono">
              실행 버튼을 눌러 마이그레이션을 시작하세요.
            </div>
          ) : (
            logs.map((log, i) => <LogLine key={i} msg={log} />)
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  )
}
