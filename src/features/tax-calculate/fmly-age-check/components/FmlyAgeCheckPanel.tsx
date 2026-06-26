"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Search, Wand2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { FmlyAgeRow } from "@/app/api/tools/fmly-age-check/route"

const AGE_COLORS: Record<number, string> = {
  7:  "text-blue-600",
  20: "text-amber-600",
  59: "text-orange-600",
  69: "text-red-600",
}


function maskResNo(resNo: string | null | undefined): string {
  if (!resNo) return ""
  return resNo.substring(0, 6) + "-*******"
}

const KEEP_PS_LABEL: Record<string, string> = {
  "1": "계속근로",
  "2": "중도퇴직",
}


export function FmlyAgeCheckPanel() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(String(currentYear - 1))
  const [rows, setRows] = useState<FmlyAgeRow[]>([])
  const [keepPs, setKeepPs] = useState("")
  const [manAge, setManAge] = useState("")
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  useEffect(() => { search() }, [])

  const search = async () => {
    if (!/^\d{4}$/.test(year)) { toast.error("연도를 4자리로 입력하세요."); return }
    setLoading(true)
    setSearched(false)
    try {
      const res = await fetch(`/api/tools/fmly-age-check?year=${year}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setRows(data)
      setSearched(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "조회 실패")
    } finally {
      setLoading(false)
    }
  }

  const generate = async () => {
    if (!/^\d{4}$/.test(year)) { toast.error("연도를 4자리로 입력하세요."); return }
    if (!window.confirm(`${year}년 기준 경계나이 데이터를 생성합니다.\n기존 데이터는 삭제됩니다. 계속하시겠습니까?`)) return
    setGenerating(true)
    try {
      const res = await fetch("/api/tools/fmly-age-check/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      toast.success(`경계나이 데이터 생성 완료 (${data.inserted}건)`)
      await search()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "생성 실패")
    } finally {
      setGenerating(false)
    }
  }

  const displayRows = rows
    .filter(r => !keepPs || r.KEEP_PS === keepPs)
    .filter(r => !manAge || String(r.MAN_AGE) === manAge)

  const deleteData = async () => {
    if (!/^\d{4}$/.test(year)) { toast.error("연도를 4자리로 입력하세요."); return }
    if (!window.confirm(`${year}년 경계나이 데이터를 삭제합니다. 계속하시겠습니까?`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/tools/fmly-age-check?year=${year}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      toast.success(`삭제 완료 (${data.deleted}건)`)
      setRows([])
      setSearched(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "삭제 실패")
    } finally {
      setDeleting(false)
    }
  }

  const grouped = displayRows.reduce<Record<number, FmlyAgeRow[]>>((acc, r) => {
    ;(acc[r.MAN_AGE] ??= []).push(r)
    return acc
  }, {})


  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      {/* 검색 바 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
          <span className="text-sm text-muted-foreground">기준연도</span>
          <input
            type="text"
            value={year}
            onChange={e => setYear(e.target.value)}
            onKeyDown={e => e.key === "Enter" && search()}
            maxLength={4}
            placeholder="2026"
            className="w-16 text-center text-sm font-mono font-semibold bg-transparent focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
          <span className="text-sm text-muted-foreground">재직구분</span>
          <select
            value={keepPs}
            onChange={e => setKeepPs(e.target.value)}
            className="text-sm font-semibold bg-transparent focus:outline-none cursor-pointer"
          >
            <option value="">전체</option>
            <option value="1">계속근로</option>
            <option value="2">중도퇴직</option>
          </select>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
          <span className="text-sm text-muted-foreground">만나이</span>
          <select
            value={manAge}
            onChange={e => setManAge(e.target.value)}
            className="text-sm font-semibold bg-transparent focus:outline-none cursor-pointer"
          >
            <option value="">전체</option>
            <option value="7">7세</option>
            <option value="20">20세</option>
            <option value="59">59세</option>
            <option value="69">69세</option>
          </select>
        </div>
        <Button onClick={search} disabled={loading || generating} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          조회
        </Button>
        <Button onClick={generate} disabled={loading || generating || deleting} variant="outline" className="gap-2">
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          경계나이 생성
        </Button>
        <Button onClick={deleteData} disabled={loading || generating || deleting} variant="outline" className="gap-2 text-red-600 border-red-300 hover:bg-red-50">
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          삭제
        </Button>
        {searched && (
          <span className="text-sm text-muted-foreground">
            총 <span className="font-semibold text-foreground">{displayRows.length}</span>건
            {Object.entries(grouped).sort(([a], [b]) => Number(a) - Number(b)).map(([age, list]) => (
              <span key={age} className={cn("ml-3", AGE_COLORS[Number(age)])}>
                만{age}세 {list.length}건
              </span>
            ))}
          </span>
        )}
      </div>

      {/* 결과 테이블 */}
      <div className="flex-1 min-h-0 overflow-auto rounded-lg border">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-muted/90 backdrop-blur-sm z-10">
            <tr>
              <th className="border-b px-3 py-2 text-left   text-xs font-semibold text-muted-foreground whitespace-nowrap">소득자</th>
              <th className="border-b px-3 py-2 text-center text-xs font-semibold text-muted-foreground whitespace-nowrap">사번</th>
              <th className="border-b px-3 py-2 text-left   text-xs font-semibold text-muted-foreground whitespace-nowrap">CALC_NO</th>
              <th className="border-b px-3 py-2 text-center text-xs font-semibold text-muted-foreground whitespace-nowrap">재직</th>
              <th className="border-b px-3 py-2 text-left   text-xs font-semibold text-muted-foreground whitespace-nowrap">부양가족명</th>
              <th className="border-b px-3 py-2 text-center text-xs font-semibold text-muted-foreground whitespace-nowrap">seq</th>
              <th className="border-b px-3 py-2 text-center text-xs font-semibold text-muted-foreground whitespace-nowrap">만나이</th>
              <th className="border-b px-3 py-2 text-center text-xs font-semibold text-muted-foreground whitespace-nowrap">관계</th>
              <th className="border-b px-3 py-2 text-center text-xs font-semibold text-muted-foreground whitespace-nowrap">기본공제</th>
              <th className="border-b px-3 py-2 text-left   text-xs font-semibold text-muted-foreground whitespace-nowrap">주민번호</th>
              <th className="border-b px-3 py-2 text-left   text-xs font-semibold text-muted-foreground whitespace-nowrap">대체주민번호</th>
              <th className="border-b px-3 py-2 text-left   text-xs font-semibold text-muted-foreground whitespace-nowrap">대체부양가족명</th>
              <th className="border-b px-3 py-2 text-center text-xs font-semibold text-muted-foreground whitespace-nowrap">경로우대</th>
              <th className="border-b px-3 py-2 text-center text-xs font-semibold text-muted-foreground whitespace-nowrap">자녀공제</th>
              <th className="border-b px-3 py-2 text-center text-xs font-semibold text-muted-foreground whitespace-nowrap">장애인</th>
              <th className="border-b px-3 py-2 text-center text-xs font-semibold text-muted-foreground whitespace-nowrap">소득초과</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={16} className="px-3 py-16 text-center text-sm text-muted-foreground">
                  {searched ? "조회된 데이터가 없습니다." : "연도를 입력하고 조회하세요."}
                </td>
              </tr>
            ) : (
              displayRows.map((row, i) => (
                <tr
                  key={i}
                  onClick={() => setSelectedIdx(selectedIdx === i ? null : i)}
                  className={cn(
                    "border-b last:border-0 transition-colors cursor-pointer",
                    selectedIdx === i ? "bg-blue-50 dark:bg-blue-950/40" : "hover:bg-muted/30"
                  )}
                >
                  <td className="px-3 py-1.5 text-xs">{row.NM}</td>
                  <td className="px-3 py-1.5 text-center font-mono text-xs text-muted-foreground">{row.EMP_NO}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{row.CALC_NO}</td>
                  <td className="px-3 py-1.5 text-center text-xs text-muted-foreground">{KEEP_PS_LABEL[row.KEEP_PS] ?? row.KEEP_PS}</td>
                  <td className="px-3 py-1.5 text-xs">{row.FMLY_NM}</td>
                  <td className="px-3 py-1.5 text-center text-xs text-muted-foreground">{row.FMLY_SEQ}</td>
                  <td className="px-3 py-1.5 text-center">
                    <span className={cn("text-sm font-bold tabular-nums", AGE_COLORS[row.MAN_AGE])}>
                      {row.MAN_AGE}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-center text-xs text-muted-foreground">
                    {row.FMLY_RELN_NM || row.FMLY_RELN}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <span className={cn(
                      "text-xs font-semibold",
                      row.BAS_SUB_YN === "Y" ? "text-emerald-600" : "text-muted-foreground"
                    )}>
                      {row.BAS_SUB_YN === "Y" ? "대상" : "비대상"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">{maskResNo(row.RES_NO)}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-blue-600">{maskResNo(row.CHG_RES_NO)}</td>
                  <td className="px-3 py-1.5 text-xs text-blue-600">{row.CHG_FMLY_NM ?? ""}</td>
                  <td className="px-3 py-1.5 text-center text-xs font-semibold">{row.OB_TRE_YN === "Y" ? <span className="text-emerald-600">Y</span> : <span className="text-muted-foreground">-</span>}</td>
                  <td className="px-3 py-1.5 text-center text-xs font-semibold">{row.CHILD_YN === "Y" ? <span className="text-emerald-600">Y</span> : <span className="text-muted-foreground">-</span>}</td>
                  <td className="px-3 py-1.5 text-center text-xs font-semibold">{row.HDC_PERS_YN === "Y" ? <span className="text-emerald-600">Y</span> : <span className="text-muted-foreground">-</span>}</td>
                  <td className="px-3 py-1.5 text-center text-xs font-semibold">{row.MORE_STD_INCM_YN === "Y" ? <span className="text-amber-600">Y</span> : <span className="text-muted-foreground">-</span>}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
