"use client"

import { useState } from "react"
import { Trash2, Save, FileText, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ItemNoteRow } from "@/lib/tax-oracle"

// ── Props ──────────────────────────────────────────────────────

interface Props {
  note:     ItemNoteRow
  item?:    string
  onSave:   (patch: Partial<Pick<ItemNoteRow, "memo" | "isDone">>) => void
  onDelete: () => void
  onClose:  () => void
}

// ── Sticker ────────────────────────────────────────────────────

export function ItemNoteSticker({ note, item, onSave, onDelete, onClose }: Props) {
  const [memo,   setMemo]   = useState(note.memo)
  const [isDone, setIsDone] = useState(note.isDone)

  function handleDoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.checked
    setIsDone(next)
    onSave({ isDone: next, memo })
  }

  function handleClose() {
    if (!memo.trim()) {
      onDelete()
    } else {
      if (memo !== note.memo) onSave({ memo })
      onClose()
    }
  }

  return (
    <div className={cn(
      "flex flex-col rounded border shadow-md text-[11px] w-[340px]",
      isDone ? "bg-gray-100 border-gray-300 text-gray-400" : "bg-yellow-50 border-yellow-300"
    )}>
      {/* 헤더 */}
      <div className="flex items-center gap-2 px-2 pt-1.5 pb-1">
        <span className={cn("font-mono font-semibold text-[10px] shrink-0", isDone ? "text-gray-400" : "text-yellow-900")}>
          {note.recordType}-{note.code}
        </span>
        <FileText className={cn("w-3 h-3 shrink-0", isDone ? "text-gray-300" : "text-yellow-600")} />
        {item && (
          <span className={cn("text-[10px] truncate", isDone ? "text-gray-400" : "text-yellow-800")}>
            {item}
          </span>
        )}
        <button
          type="button"
          onClick={() => note.memo.trim() ? onClose() : onDelete()}
          className="ml-auto shrink-0 text-gray-400 hover:text-gray-700 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* 메모 입력 */}
      <textarea
        value={memo}
        onChange={e => setMemo(e.target.value)}
        placeholder="세법개정으로 수정대상인 항목일 경우 수정내용 등을 기록하세요. 메모하시면 전산매체 비교검증 시 주의집중에 도움이 됩니다."
        rows={6}
        autoFocus
        spellCheck={false}
        className={cn(
          "resize-none bg-transparent px-2 py-1 text-[11px] leading-tight outline-none placeholder:text-gray-400 border-t",
          isDone ? "text-gray-400 border-gray-300" : "text-yellow-900 border-yellow-300"
        )}
      />

      {/* 하단 액션 */}
      <div className={cn("flex items-center gap-2 px-2 py-1.5 border-t", isDone ? "border-gray-300 bg-gray-200" : "border-yellow-300 bg-yellow-100")}>
        {/* 완료 체크박스 */}
        <label className="flex items-center gap-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isDone}
            onChange={handleDoneChange}
            className="w-3 h-3 accent-green-500"
          />
          <span className={cn("text-[10px]", isDone ? "text-gray-400" : "text-yellow-900")}>완료</span>
        </label>

        {/* 삭제 */}
        <button
          type="button"
          onClick={onDelete}
          title="노트 삭제"
          className="flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-red-500 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          <span>삭제</span>
        </button>

        {/* 저장 */}
        <button
          type="button"
          onClick={handleClose}
          title="저장"
          className="flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-green-600 transition-colors"
        >
          <Save className="w-3 h-3" />
          <span>저장</span>
        </button>
      </div>
    </div>
  )
}

// ── 미니 마크 버튼 (그리드 행에 표시) ────────────────────────────

interface MarkBtnProps {
  hasNote:    boolean
  isDone?:    boolean
  onClick:    () => void
  hideEmpty?: boolean
}

export function NoteMarkButton({ hasNote, isDone, onClick, hideEmpty }: MarkBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hasNote ? "주목 메모 보기" : "주목 메모 추가"}
      className={cn(
        "w-3.5 shrink-0 flex items-center justify-center transition-opacity",
        hasNote
          ? (isDone ? "text-gray-300" : "text-yellow-500")
          : hideEmpty
            ? "opacity-0 pointer-events-none"
            : "opacity-0 group-hover:opacity-40 hover:!opacity-80 text-gray-400 transition-opacity"
      )}
    >
      <FileText className="w-3.5 h-3.5" />
    </button>
  )
}
