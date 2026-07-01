"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import type { CalcListItem, AnalysisResult, TaxFilterType, CalcFilterType, WorkFilterType, ReviewFilterType, Finding } from "@/features/tax-insight/types"
import { AVAILABLE_YEARS } from "@/features/tax-insight/constants"

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
const TAX_LABEL:    Record<TaxFilterType,    string> = { all: "전체", nonzero: "결정세액 > 0", zero: "결정세액 = 0" }
const CALC_LABEL:   Record<CalcFilterType,   string> = { all: "전체", standard: "표준세액공제", special: "특별세액공제" }
const WORK_LABEL:   Record<WorkFilterType,   string> = { all: "전체", continue: "계속근로", midleave: "중도퇴사" }
const REVIEW_LABEL: Record<ReviewFilterType, string> = { all: "전체", houserent: "월세액", insurance: "건강/고용보험", housingsavings: "주택마련저축", ralr: "원리금상환액", card: "신용카드", medi: "의료비" }

const SS_KEY = {
  year:         "tax-insight:year",
  taxFilter:    "tax-insight:taxFilter",
  calcFilter:   "tax-insight:calcFilter",
  workFilter:   "tax-insight:workFilter",
  reviewFilter: "tax-insight:reviewFilter",
  selectedNo:   "tax-insight:selectedNo",
}
function ss(key: string, fallback: string): string {
  return (typeof window !== "undefined" && sessionStorage.getItem(key)) || fallback
}

export default function TaxInsightPage() {
  const [year,         setYear]         = useState(() => ss(SS_KEY.year,         AVAILABLE_YEARS[AVAILABLE_YEARS.length - 1]))
  const [taxFilter,    setTaxFilter]    = useState<TaxFilterType>  (() => ss(SS_KEY.taxFilter,    "all") as TaxFilterType)
  const [calcFilter,   setCalcFilter]   = useState<CalcFilterType> (() => ss(SS_KEY.calcFilter,   "all") as CalcFilterType)
  const [workFilter,   setWorkFilter]   = useState<WorkFilterType> (() => ss(SS_KEY.workFilter,   "all") as WorkFilterType)
  const [reviewFilter, setReviewFilter] = useState<ReviewFilterType>(() => ss(SS_KEY.reviewFilter, "all") as ReviewFilterType)
  const [items, setItems]         = useState<CalcListItem[]>([])
  const [idx, setIdx]             = useState(0)
  const [selectedNo, setSelectedNo] = useState<string>("")
  const [result, setResult]       = useState<AnalysisResult | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingData, setLoadingData] = useState(false)
  const [searchKey, setSearchKey] = useState(0)
  const savedCalcNoRef = useRef(typeof window !== "undefined" ? sessionStorage.getItem(SS_KEY.selectedNo) ?? "" : "")

  // 필터 변경 시 sessionStorage 저장
  useEffect(() => {
    sessionStorage.setItem(SS_KEY.year,         year)
    sessionStorage.setItem(SS_KEY.taxFilter,    taxFilter)
    sessionStorage.setItem(SS_KEY.calcFilter,   calcFilter)
    sessionStorage.setItem(SS_KEY.workFilter,   workFilter)
    sessionStorage.setItem(SS_KEY.reviewFilter, reviewFilter)
  }, [year, taxFilter, calcFilter, workFilter, reviewFilter])

  // 선택 건 변경 시 sessionStorage 저장
  useEffect(() => {
    if (selectedNo) sessionStorage.setItem(SS_KEY.selectedNo, selectedNo)
  }, [selectedNo])

  // 목록 조회 — searchKey 변경 시에만 실행 (조회 버튼)
  useEffect(() => {
    setLoadingList(true)
    const params = new URLSearchParams({ year, taxFilter, calcFilter, workFilter, reviewFilter })
    fetch(`/api/tools/tax-insight/list?${params}`)
      .then(r => r.json())
      .then(d => {
        const list: CalcListItem[] = d.items ?? []
        setItems(list)
        const saved = savedCalcNoRef.current
        const savedIdx = saved ? list.findIndex(it => it.calcNo === saved) : -1
        if (savedIdx >= 0) {
          setIdx(savedIdx)
          setSelectedNo(saved)
        } else {
          setIdx(0)
          setSelectedNo(list[0]?.calcNo ?? "")
        }
      })
      .finally(() => setLoadingList(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey])

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

  function onSelectCalcNo(v: string | null) {
    if (!v) return
    const i = items.findIndex(it => it.calcNo === v)
    if (i >= 0) { setIdx(i); setSelectedNo(v) }
  }

  // ── 좌우 패널 리사이즈 ──────────────────────────────────────
  const [leftPct, setLeftPct] = useState(50)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.min(Math.max(pct, 20), 80))
    }
    const onMouseUp = () => { isDragging.current = false }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [])

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
      <div className="shrink-0 flex items-center gap-2 mb-3 w-full">
        {/* 필터 그룹 */}
        <div className="flex items-center gap-1">
          {/* 연도 필터 */}
          <Select value={year} onValueChange={v => { if (v) setYear(v) }}>
            <SelectTrigger className="w-24 h-8 text-sm">
              <span className="flex-1 text-left truncate">{year}년</span>
            </SelectTrigger>
            <SelectContent>
              {AVAILABLE_YEARS.map(y => (
                <SelectItem key={y} value={y}>{y}년</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* 근로형태 필터 */}
          <Select value={workFilter} onValueChange={v => setWorkFilter(v as WorkFilterType)}>
            <SelectTrigger className="w-24 h-8 text-sm">
              <span className="flex-1 text-left truncate">{WORK_LABEL[workFilter]}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              <SelectItem value="continue">계속근로</SelectItem>
              <SelectItem value="midleave">중도퇴사</SelectItem>
            </SelectContent>
          </Select>

          {/* 결정세액 필터 */}
          <Select value={taxFilter} onValueChange={v => setTaxFilter(v as TaxFilterType)}>
            <SelectTrigger className="w-32 h-8 text-sm">
              <span className="flex-1 text-left truncate">{TAX_LABEL[taxFilter]}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              <SelectItem value="nonzero">결정세액 &gt; 0</SelectItem>
              <SelectItem value="zero">결정세액 = 0</SelectItem>
            </SelectContent>
          </Select>

          {/* 세액계산방식 필터 */}
          <Select value={calcFilter} onValueChange={v => setCalcFilter(v as CalcFilterType)}>
            <SelectTrigger className="w-28 h-8 text-sm">
              <span className="flex-1 text-left truncate">{CALC_LABEL[calcFilter]}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              <SelectItem value="standard">표준세액공제</SelectItem>
              <SelectItem value="special">특별세액공제</SelectItem>
            </SelectContent>
          </Select>

          {/* 검토항목 필터 */}
          <Select value={reviewFilter} onValueChange={v => setReviewFilter(v as ReviewFilterType)}>
            <SelectTrigger className="w-36 h-8 text-sm">
              <span className="flex-1 text-left truncate">{REVIEW_LABEL[reviewFilter]}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체</SelectItem>
              <SelectItem value="houserent">월세액</SelectItem>
              <SelectItem value="insurance">건강/고용보험</SelectItem>
              <SelectItem value="housingsavings">주택마련저축</SelectItem>
              <SelectItem value="ralr">원리금상환액</SelectItem>
              <SelectItem value="card">신용카드</SelectItem>
              <SelectItem value="medi">의료비</SelectItem>
            </SelectContent>
          </Select>

        </div>

        {/* 이전 */}
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(-1)} disabled={idx === 0 || loadingList}>
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {/* CALC_NO 드롭다운 */}
        <Select value={selectedNo} onValueChange={onSelectCalcNo} disabled={loadingList}>
          <SelectTrigger className="w-40 h-8 text-sm font-mono">
            <SelectValue placeholder="선택..." />
          </SelectTrigger>
          <SelectContent>
            {items.map(it => (
              <SelectItem key={it.calcNo} value={it.calcNo} className="text-sm font-mono">
                {it.calcNo} {it.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 다음 */}
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(1)} disabled={idx >= items.length - 1 || loadingList}>
          <ChevronRight className="h-4 w-4" />
        </Button>

        {/* 카운터 + 조회 버튼 */}
        <span className="text-sm text-muted-foreground tabular-nums">
          {loadingList ? "…" : `${items.length > 0 ? idx + 1 : 0} / ${items.length}`}
        </span>
        <Button className="h-8 px-3 text-sm" onClick={() => setSearchKey(k => k + 1)} disabled={loadingList}>
          조회
        </Button>
      </div>

      {/* 요약 바 */}
      {result && <SummaryBar data={result} />}

      {/* 본문: 좌(CALC_PROC_TOTAL) / 리사이즈 핸들 / 우(분석) */}
      <div ref={containerRef} className="flex-1 min-h-0 flex gap-0">
        {/* 왼쪽: 계산 과정 원문 */}
        <div
          style={{ width: `${leftPct}%` }}
          className="rounded-lg border bg-muted/30 overflow-auto p-3 shrink-0"
        >
          {loadingData ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : result ? (
            <pre
              className="text-xs text-gray-700 leading-relaxed whitespace-pre"
              style={{ fontFamily: "'D2Coding', 'GulimChe', '굴림체', monospace" }}
            >
              {result.procTotal}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground text-center mt-8">
              CALC_PROC_TOTAL 내용
            </p>
          )}
        </div>

        {/* 리사이즈 핸들 */}
        <div
          className="w-1.5 shrink-0 cursor-col-resize bg-border hover:bg-primary/40 transition-colors mx-1 rounded-full"
          onMouseDown={e => { e.preventDefault(); isDragging.current = true }}
        />

        {/* 오른쪽: 분석 결과 */}
        <div className="flex-1 min-w-0 rounded-lg border bg-card overflow-y-auto p-3">
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
