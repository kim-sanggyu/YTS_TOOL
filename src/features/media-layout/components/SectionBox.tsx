"use client"

import { useState } from "react"
import { Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"

const BODY_BG  = ["bg-purple-50","bg-violet-50","bg-indigo-50","bg-blue-50"]
const BODY_HDR = ["bg-purple-200 text-purple-800","bg-violet-200 text-violet-800","bg-indigo-200 text-indigo-800","bg-blue-200 text-blue-800"]

export function sectColors(sect: string): { boxBg: string; hdrCls: string } {
  const isHeader  = sect === "header"
  const isFooter  = sect === "footer"
  const isBodySum = sect === "body_sum"
  const bodyNum   = sect.match(/^body_(\d+)$/)?.[1]
  const idx       = (parseInt(bodyNum ?? "1") - 1) % BODY_BG.length
  return {
    boxBg:  isHeader  ? "bg-gray-50"  : isFooter  ? "bg-teal-50"  : isBodySum ? "bg-amber-50"  : BODY_BG[idx],
    hdrCls: isHeader  ? "bg-gray-200 text-gray-700"
          : isFooter  ? "bg-teal-200 text-teal-800"
          : isBodySum ? "bg-amber-200 text-amber-800"
          : BODY_HDR[idx],
  }
}

const MAKE_STR_LEN_RE = /^[\s+]*makeStr\s*\(\s*"[xX9]"\s*,\s*(\d{1,4})\s*,/

function sumMakeStrBytes(lines: string[]): number {
  return lines.reduce((sum, line) => {
    const m = MAKE_STR_LEN_RE.exec(line)
    return sum + (m ? parseInt(m[1]) : 0)
  }, 0)
}

export function sectionLineCount(sect: string, lines: string[]): string {
  const nonNewline = lines.filter(l => !l.includes('+ "\\n"')).length
  return sect === "body_sum" ? `${nonNewline}그룹` : `${nonNewline}행`
}

interface SectionBoxProps {
  sect:             string
  label:            string
  lines:            string[]
  bodyRepeatCount?: number   // body_sum 전용: body 반복 횟수
}

export function SectionBox({ sect, label, lines, bodyRepeatCount }: SectionBoxProps) {
  const [copied, setCopied] = useState(false)
  const { boxBg, hdrCls } = sectColors(sect)

  const contentLines  = lines.filter(l => !l.includes('+ "\\n"'))
  const lineCount     = contentLines.length
  const sectionBytes  = sumMakeStrBytes(contentLines)

  // body_sum: N그룹 · Mbyte × repeatCount = Totalbyte
  const isBodySum = sect === "body_sum"
  const repeatCount = bodyRepeatCount ?? 1

  function handleCopy() {
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className={cn("rounded-md border overflow-hidden shadow-sm", boxBg)}>
      <div className={cn("px-3 py-1.5 text-[11px] font-semibold flex items-center gap-2 select-none", hdrCls)}>
        <span>▸ {label}</span>
        {isBodySum ? (
          <span className="font-normal opacity-70">
            {sectionBytes}byte × {repeatCount} = {sectionBytes * repeatCount}byte
          </span>
        ) : (
          <span className="font-normal opacity-70">
            {lineCount}행 · {sectionBytes}byte
          </span>
        )}
        <button
          onClick={handleCopy}
          className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium opacity-70 hover:opacity-100 transition-opacity"
        >
          {copied ? <><Check className="h-3 w-3" />복사됨</> : <><Copy className="h-3 w-3" />복사</>}
        </button>
      </div>
      <pre className={cn("px-3 py-2 text-[11px] font-mono overflow-x-auto leading-5", boxBg)}>
        {lines.join("\n")}
      </pre>
    </div>
  )
}
