"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RefreshCw, AlertTriangle } from "lucide-react"
import type { TaxLayoutRow, JavaField, CompareRow } from "../types"
import type { TaxSectConfigRow } from "@/lib/tax-oracle"

const RECORD_TYPES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "K"]

// ── Java 슬롯 ─────────────────────────────────────────────────
// D: 이 Java 행을 소스에서 삭제 예정 (tax 쪽에 null 삽입으로 표현)
// I: 이 tax 행에 대응하는 Java 코드 신규 삽입 필요 (빈 슬롯)
// null: 정상 매치

interface JavaSlot {
  field:     JavaField | null  // null = I 삽입 행
  cmd:       "D" | "I" | null
  editedRaw: string            // 현재 makeStr 표현식 (원본 또는 수정)
}

// ── 섹션 적용 ─────────────────────────────────────────────────
// UploadStep 에서 서버에 저장한 H/B/F 설정을 적용

function applySectConfig(
  rows: (TaxLayoutRow | null)[],
  cfg: TaxSectConfigRow | null,
): (TaxLayoutRow | null)[] {
  if (!cfg || cfg.sectMode === "body") return rows.map(r => (r ? { ...r, sect: "BODY_1" } : null))
  const { bodyStart, bodyEnd, repeatCount } = cfg
  const bodyLen = Math.max(1, bodyEnd - bodyStart + 1)
  return rows.map((r, i) => {
    if (!r) return null
    const rowNum = i + 1
    if (rowNum < bodyStart) return { ...r, sect: "HEAD" }
    const offset  = rowNum - bodyStart
    const bodyNum = Math.floor(offset / bodyLen) + 1
    if (bodyNum <= repeatCount) return { ...r, sect: `BODY_${bodyNum}` }
    return { ...r, sect: "FOOT" }
  })
}

// ── makeStr 열 맞춤 ───────────────────────────────────────────

function alignMakeStrs(strs: string[]): string[] {
  const parsed = strs.map(s => {
    const m = /^makeStr\("([9xX])",\s*(\d+),\s*([\s\S]+)\)$/.exec(s)
    return m ? { type: m[1], len: m[2], arg: m[3].trimEnd() } : null
  })
  const maxLen = Math.max(...parsed.map(p => p ? p.len.length : 0), 0)
  const maxArg = Math.max(...parsed.map(p => p ? p.arg.length : 0), 0)
  return strs.map((s, i) => {
    const p = parsed[i]
    return p ? `makeStr("${p.type}", ${p.len.padStart(maxLen)}, ${p.arg.padEnd(maxArg)})` : s
  })
}

// ── 섹션 구분선 ───────────────────────────────────────────────

function SectSep({ sect }: { sect: string }) {
  const isHead = sect === "HEAD"
  const isBody = sect.startsWith("BODY_")
  const bg  = isHead ? "bg-gray-100"    : isBody ? "bg-purple-50"   : "bg-teal-50"
  const txt = isHead ? "text-gray-600"  : isBody ? "text-purple-700" : "text-teal-700"
  const num = sect.match(/^BODY_(\d+)$/)?.[1]
  const label = isHead ? "HEAD (H)" : num ? `BODY ${num} (B)` : "FOOT (F)"
  return (
    <tr className={`${bg} border-b border-t`}>
      <td colSpan={10} className={`px-3 py-0.5 text-[11px] font-semibold ${txt} select-none`}>
        ▸ {label}
      </td>
    </tr>
  )
}

// ── CompareStep ───────────────────────────────────────────────

export function CompareStep() {
  const [activeRecord, setActiveRecord] = useState("A")
  const [taxItems,     setTaxItems]     = useState<(TaxLayoutRow | null)[]>([])
  const [javaSlots,    setJavaSlots]    = useState<JavaSlot[]>([])
  const [loading,      setLoading]      = useState(false)

  const load = useCallback(async (record: string) => {
    setLoading(true)
    try {
      // compare API가 year + sectConfig를 함께 반환
      const res = await fetch(`/api/tools/media-layout/compare?record=${record}`)
      if (!res.ok) return
      const cmpData = await res.json()
      const rows: CompareRow[]         = cmpData.rows
      const sectCfg: TaxSectConfigRow | null = cmpData.sectConfig ?? null

      const rawTax = rows.map(r => r.tax)
      setTaxItems(applySectConfig(rawTax, sectCfg))
      setJavaSlots(rows.map(r => ({
        field:     r.java,
        cmd:       (r.cmd === "D" || r.cmd === "I") ? r.cmd : null,
        editedRaw: r.editedRaw ?? r.java?.raw ?? "",
      })))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(activeRecord) }, [activeRecord, load])

  // ── D 핸들러 ──────────────────────────────────────────────────
  // D: 이 Java 행은 소스에서 삭제할 것.
  //    tax 쪽에 null 을 삽입해 "이 위치엔 매치할 tax가 없다"를 표현.
  //    → 아래 java 행들이 한 칸씩 위로 올라와 다음 tax 와 매치됨.

  function handleD(idx: number) {
    const slot = javaSlots[idx]
    if (!slot) return
    if (slot.cmd === "D") {
      // D 취소: 삽입했던 null 제거
      setTaxItems(prev  => [...prev.slice(0, idx), ...prev.slice(idx + 1)])
      setJavaSlots(prev => prev.map((j, i) => i === idx ? { ...j, cmd: null } : j))
    } else {
      // D 설정: tax 쪽에 null 삽입
      setTaxItems(prev  => [...prev.slice(0, idx), null, ...prev.slice(idx)])
      setJavaSlots(prev => prev.map((j, i) => i === idx ? { ...j, cmd: "D" } : j))
    }
  }

  // ── I 핸들러 ──────────────────────────────────────────────────
  // I: 이 tax 행에 대응하는 Java 코드가 현재 없음 — 신규 삽입 필요.
  //    java 쪽에 빈 슬롯을 삽입.
  //    → 아래 java 행들이 한 칸씩 밀려 다음 tax 와 매치됨.

  function handleI(idx: number) {
    const slot = javaSlots[idx]
    if (slot?.cmd === "I" && slot.field === null) {
      // I 취소: 빈 슬롯 제거
      setJavaSlots(prev => [...prev.slice(0, idx), ...prev.slice(idx + 1)])
    } else {
      // I 설정: 빈 java 슬롯 삽입
      setJavaSlots(prev => [
        ...prev.slice(0, idx),
        { field: null, cmd: "I", editedRaw: "" },
        ...prev.slice(idx),
      ])
    }
  }

  function handleEdit(idx: number, raw: string) {
    setJavaSlots(prev => prev.map((j, i) => i === idx ? { ...j, editedRaw: raw } : j))
  }

  // ── 파생 계산 ─────────────────────────────────────────────────

  const maxLen = Math.max(taxItems.length, javaSlots.length)

  // 누적 바이트 (행별)
  const cumData = useMemo(() => {
    let tc = 0, jc = 0
    const len = Math.max(taxItems.length, javaSlots.length)
    return Array.from({ length: len }, (_, i) => {
      tc += taxItems[i]?.길이  ?? 0
      if (javaSlots[i]?.cmd !== "D") jc += javaSlots[i]?.field?.len ?? 0
      return { tc, jc }
    })
  }, [taxItems, javaSlots])

  const taxBytes  = cumData[maxLen - 1]?.tc ?? 0
  const javaBytes = cumData[maxLen - 1]?.jc ?? 0

  // makeStr 열 맞춤 (D 행 포함 전체 정렬)
  const alignedRaws = useMemo(
    () => alignMakeStrs(javaSlots.map(s => s.editedRaw)),
    [javaSlots],
  )

  // 섹션 경계 인덱스
  const sectBounds = useMemo(() => {
    const bounds = new Set<number>()
    let prev = ""
    for (let i = 0; i < taxItems.length; i++) {
      const s = taxItems[i]?.sect ?? ""
      if (s && s !== prev) { bounds.add(i); prev = s }
    }
    return bounds
  }, [taxItems])

  // ── 렌더 ─────────────────────────────────────────────────────

  return (
    <div className="space-y-3">

      {/* 레코드 탭 */}
      <div className="flex items-center justify-between">
        <Tabs value={activeRecord} onValueChange={setActiveRecord}>
          <TabsList>
            {RECORD_TYPES.map(r => (
              <TabsTrigger key={r} value={r} className="text-xs px-3">{r}-레코드</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button variant="outline" size="sm" onClick={() => load(activeRecord)} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          새로고침
        </Button>
      </div>

      {/* 요약 바 */}
      <div className="flex items-center gap-4 text-sm flex-wrap">
        <span>국세청: <strong>{taxBytes.toLocaleString()} byte</strong></span>
        <span>Java: <strong>{javaBytes.toLocaleString()} byte</strong></span>
        {taxBytes !== javaBytes ? (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            차이: {Math.abs(taxBytes - javaBytes).toLocaleString()} byte
          </Badge>
        ) : taxBytes > 0 ? (
          <Badge className="bg-green-600">일치</Badge>
        ) : null}
        <span className="ml-auto flex gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded bg-red-100 border border-red-300" />
            D: Java 행 삭제
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded bg-yellow-100 border border-yellow-300" />
            I: Java 행 삽입
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded bg-blue-100 border border-blue-300" />
            M: makeStr 수정
          </span>
        </span>
      </div>

      {/* 비교 테이블 */}
      <div className="rounded-md border overflow-auto max-h-[65vh] text-xs">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="px-1 py-1.5 border-b border-r bg-muted text-center w-8">#</th>
              {/* 전산매체 (기준, 고정) */}
              <th className="px-2 py-1.5 border-b border-r bg-orange-50 text-orange-800 text-center w-16">코드</th>
              <th className="px-2 py-1.5 border-b border-r bg-orange-50 text-orange-800 text-left">항목명</th>
              <th className="px-2 py-1.5 border-b border-r bg-orange-50 text-orange-800 text-center w-20">타입(길이)</th>
              <th className="px-2 py-1.5 border-b border-r bg-orange-100 text-orange-800 text-center w-14">누적</th>
              {/* 조작 */}
              <th className="px-1 py-1.5 border-b border-r bg-muted text-center w-16">D·I·M</th>
              {/* Java 소스 (조정 대상) */}
              <th className="px-2 py-1.5 border-b border-r bg-blue-50 text-blue-800 text-left min-w-[300px]">makeStr</th>
              <th className="px-2 py-1.5 border-b border-r bg-blue-50 text-blue-800 text-center w-20">타입(길이)</th>
              <th className="px-2 py-1.5 border-b border-r bg-blue-50 text-blue-800 text-center w-12">소스행</th>
              <th className="px-2 py-1.5 border-b bg-blue-100 text-blue-800 text-center w-14">누적</th>
            </tr>
          </thead>
          <tbody>
            {maxLen === 0 ? (
              <tr>
                <td colSpan={10} className="text-center text-muted-foreground py-10">
                  {loading
                    ? "불러오는 중..."
                    : "데이터가 없습니다. 전산매체 Excel과 Java 소스를 먼저 업로드하세요."}
                </td>
              </tr>
            ) : (
              Array.from({ length: maxLen }).flatMap((_, i) => {
                const tax  = taxItems[i]  ?? null
                const slot = javaSlots[i] ?? { field: null, cmd: null as null, editedRaw: "" }
                const isD  = slot.cmd === "D"
                const isI  = slot.cmd === "I" && slot.field === null
                const isM  = !isD && !isI && !!slot.field && slot.editedRaw !== slot.field.raw

                const typeMismatch   = !isD && !isI && !!tax && !!slot.field && tax.타입 !== slot.field.dtype
                const lengthMismatch = !isD && !isI && !!tax && !!slot.field && tax.길이 !== slot.field.len
                const hasMismatch    = typeMismatch || lengthMismatch

                const { tc, jc } = cumData[i] ?? { tc: 0, jc: 0 }

                const rowBg = isD
                  ? "bg-red-50"
                  : isI
                  ? "bg-yellow-50"
                  : hasMismatch
                  ? "bg-amber-50"
                  : isM
                  ? "bg-blue-50"
                  : ""

                const nodes = []

                if (sectBounds.has(i)) {
                  nodes.push(<SectSep key={`sep-${i}`} sect={taxItems[i]?.sect ?? ""} />)
                }

                nodes.push(
                  <tr key={i} className={`border-b ${rowBg} hover:brightness-[0.97] transition-colors`}>
                    <td className="px-1 py-1 border-r text-center text-muted-foreground">{i + 1}</td>

                    {/* 전산매체 */}
                    <td className="px-2 py-1 border-r font-mono font-semibold text-center">
                      {tax?.코드 ?? ""}
                    </td>
                    <td className="px-2 py-1 border-r truncate max-w-[180px]" title={tax?.항목}>
                      {tax?.항목 ?? ""}
                    </td>
                    <td className={`px-2 py-1 border-r text-center font-mono ${hasMismatch ? "text-red-600 font-bold" : ""}`}>
                      {tax ? `${tax.타입 ?? "?"}(${tax.길이 ?? "?"})` : ""}
                    </td>
                    <td className={`px-2 py-1 border-r text-right font-mono tabular-nums ${tc !== jc ? "text-red-600 font-bold" : tc > 0 ? "text-green-700" : ""}`}>
                      {tc > 0 ? tc.toLocaleString() : ""}
                    </td>

                    {/* D·I·M */}
                    <td className="px-1 py-1 border-r">
                      <div className="flex gap-0.5 justify-center">
                        <button
                          onClick={() => handleD(i)}
                          disabled={isI || (slot.field === null && !isD)}
                          title={isD
                            ? "D 취소 (Java 행 복원)"
                            : "D: 이 Java 행 삭제 — 다음 Java가 이 국세청 행과 매치됨"}
                          className={`w-5 h-5 rounded text-[10px] font-bold transition-colors disabled:opacity-20 disabled:cursor-not-allowed ${
                            isD
                              ? "bg-red-500 text-white"
                              : "border border-border text-muted-foreground hover:border-red-400 hover:text-red-500"
                          }`}
                        >D</button>
                        <button
                          onClick={() => handleI(i)}
                          disabled={isD}
                          title={isI
                            ? "I 취소 (빈 행 제거)"
                            : "I: 이 위치에 빈 Java 행 삽입 — 아래 Java들이 한 칸 밀림"}
                          className={`w-5 h-5 rounded text-[10px] font-bold transition-colors disabled:opacity-20 disabled:cursor-not-allowed ${
                            isI
                              ? "bg-yellow-500 text-white"
                              : "border border-border text-muted-foreground hover:border-yellow-400 hover:text-yellow-600"
                          }`}
                        >I</button>
                        <span
                          title={isM ? "makeStr 수정됨 (원본과 다름)" : "셀을 직접 수정하면 M으로 표시됩니다"}
                          className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center select-none ${
                            isM
                              ? "bg-blue-500 text-white"
                              : "border border-border text-muted-foreground/30"
                          }`}
                        >M</span>
                      </div>
                    </td>

                    {/* Java 소스 */}
                    <td className="px-2 py-1 border-r font-mono min-w-[300px]">
                      {isD ? (
                        <span className="line-through text-red-400 whitespace-pre select-none text-[11px]">
                          {alignedRaws[i]}
                        </span>
                      ) : (
                        <input
                          className={[
                            "w-full bg-transparent font-mono text-[11px] outline-none",
                            isM         ? "text-blue-700 font-semibold" : "",
                            hasMismatch ? "text-amber-700"              : "",
                          ].filter(Boolean).join(" ")}
                          value={slot.editedRaw}
                          placeholder={isI ? 'makeStr("X", 0, ...)' : ""}
                          onChange={e => handleEdit(i, e.target.value)}
                        />
                      )}
                    </td>
                    <td className={`px-2 py-1 border-r text-center font-mono ${hasMismatch ? "text-red-600 font-bold" : ""}`}>
                      {!isD && slot.field ? `${slot.field.dtype}(${slot.field.len})` : ""}
                    </td>
                    <td className="px-2 py-1 border-r text-center text-muted-foreground/70 tabular-nums">
                      {!isD && slot.field ? slot.field.lineNo : ""}
                    </td>
                    <td className={`px-2 py-1 text-right font-mono tabular-nums ${tc !== jc ? "text-red-600 font-bold" : jc > 0 ? "text-green-700" : ""}`}>
                      {jc > 0 ? jc.toLocaleString() : ""}
                    </td>
                  </tr>
                )

                return nodes
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
