"use client"

import { useEffect, useState, useCallback } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import type { CalcListItem, AnalysisResult, FilterType, Finding } from "@/features/tax-insight/types"

// ─── 유틸 ──────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return n.toLocaleString("ko-KR") + "원"
}
function fmtRate(n: number) {
  return n.toFixed(1) + "%"
}

// ─── 요약 카드 ─────────────────────────────────────────────────────────────
function SummaryBar({ data }: { data: AnalysisResult }) {
  const { summary } = data
  const refund = summary.subIncmTax < 0
  return (
    <div className="grid grid-cols-5 gap-3 mb-4">
      {[
        { label: "총급여", value: fmt(summary.totPayAmt) },
        { label: "산출세액", value: fmt(summary.prodTaxAmt) },
        { label: "결정세액", value: fmt(summary.resIncmTax) },
        { label: "실효세율", value: fmtRate(summary.effctvTaxRate) },
        {
          label: refund ? "환급" : "추가납부",
          value: fmt(Math.abs(summary.subIncmTax)),
          highlight: refund ? "text-blue-600" : "text-red-600",
        },
      ].map(({ label, value, highlight }) => (
        <div key={label} className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-sm font-semibold mt-0.5 ${highlight ?? ""}`}>{value}</p>
        </div>
      ))}
    </div>
  )
}

// ─── 발견 항목 카드 ────────────────────────────────────────────────────────
const FINDING_STYLE: Record<string, { bg: string; border: string; badge: string; icon: string }> = {
  WHY_ZERO:    { bg: "bg-amber-50",  border: "border-amber-200", badge: "bg-amber-100 text-amber-800",  icon: "⚠️" },
  OPPORTUNITY: { bg: "bg-green-50",  border: "border-green-200", badge: "bg-green-100 text-green-800",  icon: "💡" },
  DOING_WELL:  { bg: "bg-blue-50",   border: "border-blue-200",  badge: "bg-blue-100 text-blue-800",    icon: "✅" },
}

function FindingCard({ f }: { f: Finding }) {
  const s = FINDING_STYLE[f.type]
  return (
    <div className={`rounded-lg border p-3 ${s.bg} ${s.border}`}>
      <div className="flex items-start gap-2">
        <span className="text-base">{s.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800">{f.title}</p>
          <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{f.description}</p>
          {f.amount !== undefined && (
            <p className={`text-xs font-bold mt-1 ${f.type === "DOING_WELL" ? "text-blue-700" : "text-green-700"}`}>
              {f.type === "DOING_WELL" ? "공제액 " : "관련 금액 "}{fmt(f.amount)}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── 분석 패널 ─────────────────────────────────────────────────────────────
function AnalysisPanel({ data }: { data: AnalysisResult }) {
  const sections = [
    { title: "이런 이유로 0원입니다", items: data.whyZero },
    { title: "절세 기회", items: data.opportunities },
    { title: "잘 하고 있는 것", items: data.doingWell },
  ]

  return (
    <div className="flex flex-col gap-4 overflow-y-auto">
      {sections.map(({ title, items }) =>
        items.length === 0 ? null : (
          <section key={title}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {title}
            </h3>
            <div className="flex flex-col gap-2">
              {items.map((f, i) => <FindingCard key={i} f={f} />)}
            </div>
          </section>
        )
      )}
      {sections.every(s => s.items.length === 0) && (
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
          분석 결과가 없습니다.
        </div>
      )}
    </div>
  )
}

// ─── 메인 페이지 ───────────────────────────────────────────────────────────
export default function TaxInsightPage() {
  const [filter, setFilter]       = useState<FilterType>("all")
  const [items, setItems]         = useState<CalcListItem[]>([])
  const [idx, setIdx]             = useState(0)
  const [selectedNo, setSelectedNo] = useState<string>("")
  const [result, setResult]       = useState<AnalysisResult | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingData, setLoadingData] = useState(false)

  // 목록 조회
  useEffect(() => {
    setLoadingList(true)
    fetch(`/api/tools/tax-insight/list?filter=${filter}`)
      .then(r => r.json())
      .then(d => {
        setItems(d.items ?? [])
        setIdx(0)
        setSelectedNo(d.items?.[0]?.calcNo ?? "")
      })
      .finally(() => setLoadingList(false))
  }, [filter])

  // 분석 조회
  const fetchAnalysis = useCallback((calcNo: string) => {
    if (!calcNo) return
    setLoadingData(true)
    setResult(null)
    fetch(`/api/tools/tax-insight/${calcNo}`)
      .then(r => r.json())
      .then(setResult)
      .finally(() => setLoadingData(false))
  }, [])

  useEffect(() => {
    if (selectedNo) fetchAnalysis(selectedNo)
  }, [selectedNo, fetchAnalysis])

  function move(delta: number) {
    const next = Math.max(0, Math.min(items.length - 1, idx + delta))
    setIdx(next)
    setSelectedNo(items[next]?.calcNo ?? "")
  }

  function onSelectCalcNo(v: string) {
    const i = items.findIndex(it => it.calcNo === v)
    if (i >= 0) { setIdx(i); setSelectedNo(v) }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 헤더 */}
      <div className="shrink-0 mb-3">
        <h1 className="text-2xl font-bold tracking-tight">세액계산 종합진단</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          세액 결과 안내 및 미 공제 내역에 대한 사유를 확인할 수 있습니다.
          또한 다음 번 연말정산을 위한 절세 전략도 제안합니다.
        </p>
      </div>

      {/* 네비게이션 바 */}
      <div className="shrink-0 flex items-center gap-2 mb-3">
        {/* 필터 */}
        <Select value={filter} onValueChange={v => setFilter(v as FilterType)}>
          <SelectTrigger className="w-36 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            <SelectItem value="zero">결정세액 = 0</SelectItem>
            <SelectItem value="nonzero">결정세액 &gt; 0</SelectItem>
            <SelectItem value="standard">표준세액공제</SelectItem>
            <SelectItem value="special">특별세액공제</SelectItem>
          </SelectContent>
        </Select>

        {/* 이전 */}
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(-1)} disabled={idx === 0 || loadingList}>
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {/* CALC_NO 드롭다운 */}
        <Select value={selectedNo} onValueChange={onSelectCalcNo} disabled={loadingList}>
          <SelectTrigger className="w-56 h-8 text-sm font-mono">
            <SelectValue placeholder="선택..." />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {items.map(it => (
              <SelectItem key={it.calcNo} value={it.calcNo} className="text-sm font-mono">
                {it.calcNo} — {it.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 다음 */}
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(1)} disabled={idx >= items.length - 1 || loadingList}>
          <ChevronRight className="h-4 w-4" />
        </Button>

        {/* 카운터 */}
        <span className="text-sm text-muted-foreground tabular-nums">
          {loadingList ? "…" : `${items.length > 0 ? idx + 1 : 0} / ${items.length}`}
        </span>
      </div>

      {/* 요약 바 */}
      {result && <SummaryBar data={result} />}

      {/* 본문: 좌(CALC_PROC_TOTAL) / 우(분석) */}
      <div className="flex-1 min-h-0 grid grid-cols-2 gap-3">
        {/* 왼쪽: 계산 과정 원문 */}
        <div className="rounded-lg border bg-muted/30 overflow-y-auto p-3">
          {loadingData ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : result ? (
            <pre className="text-xs font-mono whitespace-pre-wrap text-gray-700 leading-relaxed">
              {result.procTotal}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground text-center mt-8">
              CALC_PROC_TOTAL 내용
            </p>
          )}
        </div>

        {/* 오른쪽: 분석 결과 */}
        <div className="rounded-lg border bg-card overflow-y-auto p-3">
          {loadingData ? (
            <p className="text-sm text-muted-foreground">분석 중...</p>
          ) : result ? (
            <AnalysisPanel data={result} />
          ) : (
            <div className="flex flex-col gap-4 text-sm text-muted-foreground">
              {["기본 현황", "이런 이유로 0원입니다", "절세 기회", "잘 하고 있는 것"].map(t => (
                <p key={t} className="text-gray-300">{t}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
