"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { toast } from "sonner"
import {
  Plus, X, Trash2, Loader2, Paperclip,
  ChevronDown, ChevronRight, Pencil, Check,
  StickyNote, FileImage,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ─── Types ──────────────────────────────────────────────────────────────────

type Group = {
  GROUP_ID: number
  GROUP_NAME: string
  YEAR_CD: string | null
  NOTES: string | null
  SORT_ORDER: number
  TOTAL_COUNT: number
  DONE_COUNT: number
}

type TaskItem = {
  ITEM_ID: number
  GROUP_ID: number
  SEQ_NO: number
  CATEGORY: string | null
  TITLE: string
  IMPL_PLAN: string | null
  STATUS: string
  PRIORITY: string
  ASSIGNEE: string | null
  START_DT: string | null
  END_DT: string | null
  REMARKS: string | null
}

type TaskLog = {
  LOG_ID: number
  ITEM_ID: number
  CONTENT: string
  LOGGED_BY: string | null
  LOGGED_AT: string
  FILES: TaskFile[]
}

type TaskFile = {
  FILE_ID: number
  FILE_NAME: string
  MIME_TYPE: string | null
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STATUS_OPTIONS = ["미정", "선택", "검토", "진행", "완료", "취소"] as const
const PRIORITY_OPTIONS = ["높음", "보통", "낮음"] as const

const STATUS_BADGE: Record<string, string> = {
  완료: "bg-green-100 text-green-700 border border-green-200",
  진행: "bg-blue-100  text-blue-700  border border-blue-200",
  검토: "bg-amber-100 text-amber-700 border border-amber-200",
  취소: "bg-gray-100  text-gray-400  border border-gray-200",
  선택: "bg-purple-100 text-purple-700 border border-purple-200",
  미정: "bg-gray-50   text-gray-400  border border-gray-100",
}

const PRIORITY_COLOR: Record<string, string> = {
  높음: "text-red-500",
  보통: "text-gray-400",
  낮음: "text-gray-300",
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
      STATUS_BADGE[status] ?? STATUS_BADGE["미정"],
      className
    )}>
      {status}
    </span>
  )
}

// ─── Group Panel ────────────────────────────────────────────────────────────

function GroupPanel({
  groups, selectedId, onSelect, onCreated, onUpdated, onDeleted,
}: {
  groups: Group[]
  selectedId: number | null
  onSelect: (id: number) => void
  onCreated: () => void
  onUpdated: (id: number, name: string, yearCd: string, notes: string) => void
  onDeleted: (id: number) => void
}) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState("")
  const [newYear, setNewYear] = useState(String(new Date().getFullYear()))
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [editYear, setEditYear] = useState("")
  const [notesOpen, setNotesOpen] = useState<number | null>(null)
  const [notesValue, setNotesValue] = useState("")
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function handleAdd() {
    if (!newName.trim()) return
    const res = await fetch("/api/tools/task-status/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupName: newName.trim(), yearCd: newYear }),
    })
    if (!res.ok) { toast.error("생성 실패"); return }
    setAdding(false); setNewName(""); onCreated()
  }

  async function handleEdit(g: Group) {
    await fetch(`/api/tools/task-status/groups/${g.GROUP_ID}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupName: editName, yearCd: editYear, notes: g.NOTES }),
    })
    onUpdated(g.GROUP_ID, editName, editYear, g.NOTES ?? "")
    setEditingId(null)
  }

  async function handleDelete(g: Group) {
    if (!confirm(`"${g.GROUP_NAME}" 구분과 모든 과제를 삭제합니까?`)) return
    const res = await fetch(`/api/tools/task-status/groups/${g.GROUP_ID}`, { method: "DELETE" })
    if (!res.ok) { toast.error("삭제 실패"); return }
    onDeleted(g.GROUP_ID)
  }

  function openNotes(g: Group) {
    setNotesOpen(g.GROUP_ID)
    setNotesValue(g.NOTES ?? "")
  }

  function handleNotesChange(g: Group, val: string) {
    setNotesValue(val)
    if (notesTimer.current) clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(async () => {
      await fetch(`/api/tools/task-status/groups/${g.GROUP_ID}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupName: g.GROUP_NAME, yearCd: g.YEAR_CD, notes: val }),
      })
      onUpdated(g.GROUP_ID, g.GROUP_NAME, g.YEAR_CD ?? "", val)
    }, 800)
  }

  return (
    <div className="w-64 shrink-0 flex flex-col border-r bg-gray-50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b bg-background shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">과제구분</span>
        <button
          onClick={() => setAdding(true)}
          className="rounded-md p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          title="구분 추가"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {groups.map(g => {
          const isSelected = selectedId === g.GROUP_ID
          const pct = g.TOTAL_COUNT > 0 ? Math.round((g.DONE_COUNT / g.TOTAL_COUNT) * 100) : 0

          return (
            <div key={g.GROUP_ID}>
              <div
                className={cn(
                  "group flex items-center gap-1.5 px-2 py-2 cursor-pointer transition-colors",
                  isSelected ? "bg-gray-200 text-gray-900" : "hover:bg-gray-100 text-gray-700"
                )}
                onClick={() => onSelect(g.GROUP_ID)}
              >
                <ChevronRight className="h-3 w-3 shrink-0 text-gray-400" />
                <div className="flex-1 min-w-0">
                  {editingId === g.GROUP_ID ? (
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <input
                        className="flex-1 text-xs rounded border border-input px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") handleEdit(g); if (e.key === "Escape") setEditingId(null) }}
                        autoFocus
                      />
                      <input
                        className="w-14 text-xs rounded border border-input px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
                        value={editYear}
                        onChange={e => setEditYear(e.target.value)}
                        placeholder="연도"
                      />
                      <button onClick={() => handleEdit(g)} className="text-green-600 hover:text-green-700">
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm truncate">{g.GROUP_NAME}</span>
                        {g.YEAR_CD && (
                          <span className="shrink-0 text-[10px] text-gray-400 font-mono">'{g.YEAR_CD.slice(2)}</span>
                        )}
                      </div>
                      {g.TOTAL_COUNT > 0 && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <div className="flex-1 h-1 rounded-full bg-gray-200 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-green-500 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-gray-400 tabular-nums shrink-0">
                            {g.DONE_COUNT}/{g.TOTAL_COUNT}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
                {editingId !== g.GROUP_ID && (
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => openNotes(g)}
                      className="p-0.5 rounded text-gray-400 hover:text-amber-500"
                      title="회의 노트"
                    >
                      <StickyNote className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => { setEditingId(g.GROUP_ID); setEditName(g.GROUP_NAME); setEditYear(g.YEAR_CD ?? "") }}
                      className="p-0.5 rounded text-gray-400 hover:text-gray-700"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleDelete(g)}
                      className="p-0.5 rounded text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* 회의 노트 */}
              {notesOpen === g.GROUP_ID && (
                <div className="mx-2 mb-2 rounded-md border border-amber-200 bg-amber-50 overflow-hidden">
                  <div className="flex items-center justify-between px-2 py-1 border-b border-amber-200">
                    <span className="text-[11px] font-medium text-amber-700 flex items-center gap-1">
                      <StickyNote className="h-3 w-3" />회의 노트
                    </span>
                    <button onClick={() => setNotesOpen(null)} className="text-amber-400 hover:text-amber-600">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <textarea
                    value={notesValue}
                    onChange={e => handleNotesChange(g, e.target.value)}
                    placeholder="회의 논의 내용을 자유롭게 기록하세요..."
                    className="w-full text-xs bg-transparent px-2 py-1.5 resize-none focus:outline-none placeholder:text-amber-300 text-amber-900 min-h-[120px]"
                  />
                </div>
              )}
            </div>
          )
        })}

        {groups.length === 0 && (
          <div className="text-center text-xs text-gray-400 py-8">
            구분을 추가하세요
          </div>
        )}
      </div>

      {/* 구분 추가 폼 */}
      {adding && (
        <div className="border-t p-2 bg-background shrink-0 space-y-1.5">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAdding(false) }}
            placeholder="구분명"
            className="w-full text-sm rounded-md border border-input px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            value={newYear}
            onChange={e => setNewYear(e.target.value)}
            placeholder="연도 (예: 2026)"
            className="w-full text-sm rounded-md border border-input px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex gap-1.5">
            <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleAdd}>추가</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAdding(false)}>취소</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Task Drawer ─────────────────────────────────────────────────────────────

function TaskDrawer({
  task, logs, userName, onClose, onTaskChange, onLogsChange, onDeleted,
}: {
  task: TaskItem
  logs: TaskLog[]
  userName: string | null
  onClose: () => void
  onTaskChange: (t: TaskItem) => void
  onLogsChange: () => void
  onDeleted: () => void
}) {
  const [draft, setDraft] = useState(task)
  const [logContent, setLogContent] = useState("")
  const [logFiles, setLogFiles] = useState<File[]>([])
  const [savingLog, setSavingLog] = useState(false)
  const [deletingLog, setDeletingLog] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const logsEndRef  = useRef<HTMLDivElement>(null)

  useEffect(() => { setDraft(task) }, [task.ITEM_ID]) // eslint-disable-line

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs.length])

  async function saveField(field: Partial<TaskItem>) {
    const updated = { ...draft, ...field }
    setDraft(updated)
    await fetch(`/api/tools/task-status/tasks/${task.ITEM_ID}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    })
    onTaskChange(updated)
  }

  async function handleAddLog() {
    if (!logContent.trim()) return
    setSavingLog(true)
    try {
      const res = await fetch("/api/tools/task-status/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: task.ITEM_ID, content: logContent.trim() }),
      })
      if (!res.ok) throw new Error()
      const { logId } = await res.json()

      for (const file of logFiles) {
        const fd = new FormData()
        fd.append("file", file)
        fd.append("itemId", String(task.ITEM_ID))
        fd.append("logId", String(logId))
        await fetch("/api/tools/task-status/upload", { method: "POST", body: fd })
      }

      setLogContent("")
      setLogFiles([])
      onLogsChange()
    } catch {
      toast.error("저장 실패")
    } finally {
      setSavingLog(false)
    }
  }

  async function handleDeleteLog(logId: number) {
    setDeletingLog(logId)
    try {
      await fetch(`/api/tools/task-status/logs/${logId}`, { method: "DELETE" })
      onLogsChange()
    } finally {
      setDeletingLog(null)
    }
  }

  async function handleDeleteFile(fileId: number) {
    await fetch(`/api/tools/task-status/files/${fileId}`, { method: "DELETE" })
    onLogsChange()
  }

  async function handleDeleteTask() {
    if (!confirm(`"${task.TITLE}" 과제와 모든 로그를 삭제합니까?`)) return
    await fetch(`/api/tools/task-status/tasks/${task.ITEM_ID}`, { method: "DELETE" })
    onDeleted()
  }

  return (
    <>
      {/* 백드롭 */}
      <div className="fixed inset-0 z-40 bg-black/10" onClick={onClose} />

      {/* 드로어 */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[480px] bg-background border-l shadow-xl flex flex-col overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="h-4 w-4" />
          </button>
          <div className="flex-1" />
          <button
            onClick={handleDeleteTask}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />삭제
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-4 space-y-4">
            {/* 제목 */}
            <textarea
              value={draft.TITLE}
              onChange={e => setDraft(d => ({ ...d, TITLE: e.target.value }))}
              onBlur={() => saveField({ TITLE: draft.TITLE })}
              className="w-full text-lg font-semibold resize-none focus:outline-none leading-snug bg-transparent"
              rows={2}
            />

            {/* 속성 그리드 */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm border rounded-lg p-3 bg-gray-50">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-14 shrink-0">상태</span>
                <select
                  value={draft.STATUS}
                  onChange={e => saveField({ STATUS: e.target.value })}
                  className={cn(
                    "text-xs rounded-full px-2 py-0.5 border font-medium focus:outline-none cursor-pointer",
                    STATUS_BADGE[draft.STATUS] ?? STATUS_BADGE["미정"]
                  )}
                >
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-14 shrink-0">우선순위</span>
                <select
                  value={draft.PRIORITY}
                  onChange={e => saveField({ PRIORITY: e.target.value })}
                  className={cn("text-xs border rounded px-1.5 py-0.5 focus:outline-none cursor-pointer bg-background", PRIORITY_COLOR[draft.PRIORITY])}
                >
                  {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-14 shrink-0">담당자</span>
                <input
                  value={draft.ASSIGNEE ?? ""}
                  onChange={e => setDraft(d => ({ ...d, ASSIGNEE: e.target.value }))}
                  onBlur={() => saveField({ ASSIGNEE: draft.ASSIGNEE })}
                  placeholder="담당자"
                  className="flex-1 text-xs border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring bg-background"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-14 shrink-0">대분류</span>
                <input
                  value={draft.CATEGORY ?? ""}
                  onChange={e => setDraft(d => ({ ...d, CATEGORY: e.target.value }))}
                  onBlur={() => saveField({ CATEGORY: draft.CATEGORY })}
                  placeholder="예: STEP_5"
                  className="flex-1 text-xs border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring bg-background"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-14 shrink-0">시작일</span>
                <input
                  type="date"
                  value={draft.START_DT ?? ""}
                  onChange={e => saveField({ START_DT: e.target.value || null })}
                  className="flex-1 text-xs border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring bg-background"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-14 shrink-0">종료일</span>
                <input
                  type="date"
                  value={draft.END_DT ?? ""}
                  onChange={e => saveField({ END_DT: e.target.value || null })}
                  className="flex-1 text-xs border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring bg-background"
                />
              </div>
            </div>

            {/* 구현방안 */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">구현방안</p>
              <textarea
                value={draft.IMPL_PLAN ?? ""}
                onChange={e => setDraft(d => ({ ...d, IMPL_PLAN: e.target.value }))}
                onBlur={() => saveField({ IMPL_PLAN: draft.IMPL_PLAN })}
                placeholder="구현 방안을 입력하세요. (불릿은 • 또는 - 사용)"
                rows={5}
                className="w-full text-sm resize-none rounded-md border border-input px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring bg-background font-mono text-[13px] leading-relaxed"
              />
            </div>

            {/* 비고 */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">비고</p>
              <textarea
                value={draft.REMARKS ?? ""}
                onChange={e => setDraft(d => ({ ...d, REMARKS: e.target.value }))}
                onBlur={() => saveField({ REMARKS: draft.REMARKS })}
                placeholder="비고"
                rows={2}
                className="w-full text-sm resize-none rounded-md border border-input px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring bg-background"
              />
            </div>

            {/* 진척 로그 */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs font-semibold text-gray-400 shrink-0">진척 로그</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>

              {logs.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">
                  아직 진척 로그가 없습니다
                </p>
              )}

              <div className="space-y-3">
                {logs.map(log => (
                  <div key={log.LOG_ID} className="group relative pl-3 border-l-2 border-gray-100 hover:border-blue-200 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-gray-600">{log.LOGGED_BY ?? "–"}</span>
                        <span className="text-[11px] text-gray-400 font-mono">{log.LOGGED_AT}</span>
                      </div>
                      <button
                        onClick={() => handleDeleteLog(log.LOG_ID)}
                        disabled={deletingLog === log.LOG_ID}
                        className="hidden group-hover:block text-gray-300 hover:text-red-400 transition-colors"
                      >
                        {deletingLog === log.LOG_ID
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <X className="h-3 w-3" />
                        }
                      </button>
                    </div>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{log.CONTENT}</p>

                    {/* 첨부파일 */}
                    {log.FILES.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {log.FILES.map(f => {
                          const isImg = f.MIME_TYPE?.startsWith("image/")
                          const src = `/api/tools/task-status/files/${f.FILE_ID}`
                          return (
                            <div key={f.FILE_ID} className="group/file relative">
                              {isImg ? (
                                <a href={src} target="_blank" rel="noreferrer">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={src}
                                    alt={f.FILE_NAME}
                                    className="h-20 w-auto rounded border border-gray-200 object-cover hover:opacity-90 transition-opacity cursor-pointer"
                                  />
                                </a>
                              ) : (
                                <a
                                  href={src}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-1 rounded border border-gray-200 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                                >
                                  <FileImage className="h-3.5 w-3.5 text-gray-400" />
                                  {f.FILE_NAME}
                                </a>
                              )}
                              <button
                                onClick={() => handleDeleteFile(f.FILE_ID)}
                                className="absolute -top-1 -right-1 hidden group-hover/file:flex h-4 w-4 items-center justify-center rounded-full bg-gray-600 text-white hover:bg-red-500 transition-colors"
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>

              {/* 로그 추가 폼 */}
              <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
                <textarea
                  value={logContent}
                  onChange={e => setLogContent(e.target.value)}
                  placeholder="진척 내용을 입력하세요..."
                  rows={3}
                  className="w-full text-sm resize-none rounded-md border border-input px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {logFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {logFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                        <Paperclip className="h-3 w-3" />
                        <span className="max-w-[140px] truncate">{f.name}</span>
                        <button onClick={() => setLogFiles(fs => fs.filter((_, j) => j !== i))} className="text-gray-400 hover:text-gray-700 ml-0.5">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 rounded-md border border-gray-200 px-2.5 py-1.5 hover:bg-gray-50 transition-colors"
                  >
                    <Paperclip className="h-3.5 w-3.5" />파일 첨부
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={e => {
                      const selected = Array.from(e.target.files ?? [])
                      setLogFiles(prev => [...prev, ...selected])
                      e.target.value = ""
                    }}
                  />
                  <div className="flex-1" />
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!logContent.trim() || savingLog}
                    onClick={handleAddLog}
                  >
                    {savingLog ? <Loader2 className="h-3 w-3 animate-spin" /> : "저장"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Task Table ──────────────────────────────────────────────────────────────

function TaskTable({
  tasks, groupId, onTaskClick, onTasksChange,
}: {
  tasks: TaskItem[]
  groupId: number
  onTaskClick: (t: TaskItem) => void
  onTasksChange: () => void
}) {
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [addingTitle, setAddingTitle] = useState("")
  const [isAdding, setIsAdding] = useState(false)

  const filtered = tasks.filter(t => {
    if (statusFilter && t.STATUS !== statusFilter) return false
    if (search && !t.TITLE.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  async function handleStatusChange(task: TaskItem, status: string) {
    await fetch(`/api/tools/task-status/tasks/${task.ITEM_ID}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...task, STATUS: status }),
    })
    onTasksChange()
  }

  async function handleAddTask() {
    if (!addingTitle.trim()) { setIsAdding(false); return }
    const res = await fetch("/api/tools/task-status/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId, title: addingTitle.trim() }),
    })
    if (!res.ok) { toast.error("생성 실패"); return }
    setAddingTitle("")
    setIsAdding(false)
    onTasksChange()
  }

  const statusCounts = STATUS_OPTIONS.reduce<Record<string, number>>((acc, s) => {
    acc[s] = tasks.filter(t => t.STATUS === s).length
    return acc
  }, {})

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* 툴바 */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setStatusFilter(null)}
            className={cn(
              "text-xs rounded-full px-2.5 py-0.5 border transition-colors",
              !statusFilter ? "bg-gray-800 text-white border-gray-800" : "text-gray-500 border-gray-200 hover:bg-gray-50"
            )}
          >
            전체 {tasks.length}
          </button>
          {STATUS_OPTIONS.filter(s => statusCounts[s] > 0).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? null : s)}
              className={cn(
                "text-xs rounded-full px-2.5 py-0.5 border transition-colors",
                statusFilter === s
                  ? cn(STATUS_BADGE[s], "opacity-100")
                  : "text-gray-500 border-gray-200 hover:bg-gray-50"
              )}
            >
              {s} {statusCounts[s]}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="과제 검색..."
          className="text-xs rounded-md border border-input px-2.5 py-1.5 w-40 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setIsAdding(true)}>
          <Plus className="h-3.5 w-3.5" />과제 추가
        </Button>
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-gray-50 z-10">
            <tr className="border-b text-xs text-gray-500 font-medium">
              <th className="w-10 px-3 py-2 text-right tabular-nums font-normal">#</th>
              <th className="px-3 py-2 text-left">과제</th>
              <th className="w-24 px-3 py-2 text-left">대분류</th>
              <th className="w-24 px-3 py-2 text-left">담당자</th>
              <th className="w-20 px-3 py-2 text-left">상태</th>
              <th className="w-24 px-3 py-2 text-left">우선순위</th>
              <th className="w-28 px-3 py-2 text-left">종료일</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((task, idx) => (
              <tr
                key={task.ITEM_ID}
                className={cn(
                  "border-b cursor-pointer transition-colors hover:bg-gray-50",
                  task.STATUS === "취소" && "opacity-50"
                )}
                onClick={() => onTaskClick(task)}
              >
                <td className="px-3 py-2.5 text-right text-xs text-gray-400 tabular-nums">{idx + 1}</td>
                <td className="px-3 py-2.5 max-w-0">
                  <span className={cn("text-sm line-clamp-1", task.STATUS === "취소" && "line-through")}>{task.TITLE}</span>
                </td>
                <td className="px-3 py-2.5">
                  {task.CATEGORY && (
                    <span className="text-xs text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">{task.CATEGORY}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs text-gray-600">{task.ASSIGNEE ?? "–"}</td>
                <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                  <select
                    value={task.STATUS}
                    onChange={e => handleStatusChange(task, e.target.value)}
                    className={cn(
                      "text-xs rounded-full px-2 py-0.5 border font-medium focus:outline-none cursor-pointer",
                      STATUS_BADGE[task.STATUS] ?? STATUS_BADGE["미정"]
                    )}
                  >
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className={cn("px-3 py-2.5 text-xs font-medium", PRIORITY_COLOR[task.PRIORITY])}>
                  {task.PRIORITY}
                </td>
                <td className="px-3 py-2.5 text-xs text-gray-500 font-mono">{task.END_DT ?? "–"}</td>
              </tr>
            ))}

            {/* 빠른 추가 행 */}
            {isAdding && (
              <tr className="border-b bg-blue-50">
                <td className="px-3 py-2" />
                <td className="px-3 py-2" colSpan={6}>
                  <input
                    autoFocus
                    value={addingTitle}
                    onChange={e => setAddingTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleAddTask(); if (e.key === "Escape") setIsAdding(false) }}
                    onBlur={handleAddTask}
                    placeholder="과제 제목 입력 후 Enter"
                    className="w-full text-sm bg-transparent focus:outline-none placeholder:text-gray-400"
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {filtered.length === 0 && !isAdding && (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400 text-sm gap-2">
            {search || statusFilter ? "조건에 맞는 과제가 없습니다" : "과제를 추가하세요"}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function TaskStatusPanel({ userName }: { userName: string | null }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null)
  const [logs, setLogs] = useState<TaskLog[]>([])
  const [loadingTasks, setLoadingTasks] = useState(false)

  const loadGroups = useCallback(async () => {
    const res = await fetch("/api/tools/task-status/groups")
    if (res.ok) setGroups(await res.json())
  }, [])

  const loadTasks = useCallback(async (groupId: number) => {
    setLoadingTasks(true)
    try {
      const res = await fetch(`/api/tools/task-status/tasks?groupId=${groupId}`)
      if (res.ok) setTasks(await res.json())
    } finally {
      setLoadingTasks(false)
    }
  }, [])

  const loadLogs = useCallback(async (itemId: number) => {
    const res = await fetch(`/api/tools/task-status/logs?itemId=${itemId}`)
    if (res.ok) setLogs(await res.json())
  }, [])

  useEffect(() => { loadGroups() }, [loadGroups])

  useEffect(() => {
    if (selectedGroupId) loadTasks(selectedGroupId)
    else setTasks([])
  }, [selectedGroupId, loadTasks])

  useEffect(() => {
    if (selectedTask) loadLogs(selectedTask.ITEM_ID)
    else setLogs([])
  }, [selectedTask?.ITEM_ID, loadLogs]) // eslint-disable-line

  function handleGroupUpdated(id: number, name: string, yearCd: string, notes: string) {
    setGroups(gs => gs.map(g =>
      g.GROUP_ID === id ? { ...g, GROUP_NAME: name, YEAR_CD: yearCd, NOTES: notes } : g
    ))
  }

  function handleGroupDeleted(id: number) {
    setGroups(gs => gs.filter(g => g.GROUP_ID !== id))
    if (selectedGroupId === id) { setSelectedGroupId(null); setTasks([]) }
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <GroupPanel
        groups={groups}
        selectedId={selectedGroupId}
        onSelect={id => { setSelectedGroupId(id); setSelectedTask(null) }}
        onCreated={() => { loadGroups() }}
        onUpdated={handleGroupUpdated}
        onDeleted={handleGroupDeleted}
      />

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {selectedGroupId ? (
          loadingTasks ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <TaskTable
              tasks={tasks}
              groupId={selectedGroupId}
              onTaskClick={t => setSelectedTask(t)}
              onTasksChange={() => { loadTasks(selectedGroupId); loadGroups() }}
            />
          )
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            좌측에서 과제구분을 선택하세요
          </div>
        )}
      </div>

      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          logs={logs}
          userName={userName}
          onClose={() => setSelectedTask(null)}
          onTaskChange={updated => {
            setSelectedTask(updated)
            setTasks(ts => ts.map(t => t.ITEM_ID === updated.ITEM_ID ? updated : t))
            loadGroups()
          }}
          onLogsChange={() => loadLogs(selectedTask.ITEM_ID)}
          onDeleted={() => {
            setSelectedTask(null)
            if (selectedGroupId) { loadTasks(selectedGroupId); loadGroups() }
          }}
        />
      )}
    </div>
  )
}
