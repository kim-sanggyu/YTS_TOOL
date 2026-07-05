"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { ChevronLeft, ChevronRight, RotateCcw, RefreshCw, Info, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet"
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
function SummaryBar({ data, name }: { data: AnalysisResult; name?: string }) {
  const { summary } = data
  return (
    <div className={`grid gap-3 mb-4 ${name ? "grid-cols-5" : "grid-cols-4"}`}>
      {name && (
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">이름</p>
          <p className="text-sm font-semibold mt-0.5 truncate">{name}</p>
        </div>
      )}
      {[
        { label: "총급여", value: fmt(summary.totPayAmt) },
        { label: "산출세액", value: fmt(summary.prodTaxAmt) },
        { label: "결정세액", value: fmt(summary.resIncmTax) },
        { label: "실효세율", value: fmtRate(summary.effctvTaxRate) },
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
  ANALYSIS:    { bg: "bg-yellow-50", border: "border-yellow-200", badge: "bg-yellow-100 text-yellow-800", icon: "📋" },
  OPPORTUNITY: { bg: "bg-green-50",  border: "border-green-200",  badge: "bg-green-100 text-green-800",   icon: "💡" },
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
    { title: "세액계산 결과 분석", items: data.analysis },
    { title: "절세 기회", items: data.opportunities },
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

// ─── 파싱 로직 안내 ────────────────────────────────────────────────────────
interface ParsePoint {
  title: string
  raw: string       // CALC_PROC_TOTAL 실제 텍스트 예시
  result: string    // 파싱 결과 → 해설에 사용되는 값
  note?: string
}

const PARSE_POINTS: ParsePoint[] = [
  {
    title: "세액계산 방식",
    raw: "'표준세액공제' 방식으로 계산합니다.\n→ 보험료, 주택임차차입금원리금상환액, ...",
    result: "isStandard = true\n→ 표준방식 선택으로 미공제 카드 생성",
    note: "이 문자열이 없으면 특별세액공제 방식으로 판단합니다.",
  },
  {
    title: "소득자 입력 값 섹션",
    raw: "====소득자 입력 값====\n월세액: 1,200,000\n건강보험료: 483,200\n고용보험료: 147,900\n====END====",
    result: "inputs.월세액 = 1200000\ninputs.건강보험료 = 483200\ninputs.고용보험료 = 147900",
    note: "입력금액 파악의 1차 소스. 없으면 DB 컬럼으로 폴백.",
  },
  {
    title: "산출세액",
    raw: "· 1,266,487 (산출세액)",
    result: "산출세액 = 1266487",
  },
  {
    title: "소득 소진 감지",
    raw: "※ 근로소득 잔액이 '0'이 되었습니다.\n※ (자동)특별소득ㆍ세액공제 적용 세액 0\n   (표준적용時 0), 소진지점: 본인",
    result: "incomeExhausted = true\nincomeExhaustPoint = '본인'\n→ 근로소득 조기 소진 — 본인 단계 카드 생성",
  },
  {
    title: "세액 소진 감지",
    raw: "▣▣▣ [월세액] 항목에서 산출세액이 모두 소진되었습니다.\n[월세액] 항목은 산출세액 당초 보다 덜 공제될 수 있습니다.",
    result: "taxExhausted = true\ntaxExhaustPoint = '월세액'\n→ 세액 전액 소진 지점 — '월세액' 항목 공제할 때 카드 생성",
  },
  {
    title: "세액소진 이후 건너뛴 항목",
    raw: "(잔액) 0 - 0 (일반기부금(종교단체외))  ※표기생략(산출세액 잔액 0)\n(잔액) 0 - 0 (ISA연금계좌납입액)       ※표기생략(산출세액 잔액 0)",
    result: "taxExhaustedSkipped = ['일반기부금(종교단체외)', 'ISA연금계좌납입액']\n→ 세액소진 이후 미공제 카드 생성",
    note: "※표기생략(산출세액 잔액 0) 이 붙은 줄만 해당. 입력값이 있는 항목에만 표기됩니다.",
  },
  {
    title: "주택 400만원 한도 소진",
    raw: "(잔액) 3,827,604 - 2,707,660 (신용카드등) [상세공제내역]참조\n①주택4백한도 0, ②...",
    result: "주택한도소진 = true\n→ 주택마련저축 - 400만원 한도 소진으로 미공제 카드 생성",
    note: "주택임차차입금원리금상환액이 400만원 한도를 먼저 채운 경우.",
  },
]

function ParsePointCard({ p }: { p: ParsePoint }) {
  return (
    <div className="rounded-lg border bg-card p-3 flex flex-col gap-2">
      <p className="text-xs font-bold text-gray-800">{p.title}</p>
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">CALC_PROC_TOTAL</p>
        <pre className="text-[11px] bg-amber-50 border border-amber-200 rounded px-2 py-1.5 text-amber-900 whitespace-pre-wrap leading-relaxed">{p.raw}</pre>
      </div>
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">파싱 결과 → 해설</p>
        <pre className="text-[11px] bg-blue-50 border border-blue-200 rounded px-2 py-1.5 text-blue-900 whitespace-pre-wrap leading-relaxed">{p.result}</pre>
      </div>
      {p.note && <p className="text-[11px] text-muted-foreground leading-relaxed">{p.note}</p>}
    </div>
  )
}

function ParsingGuideSheet() {
  return (
    <Sheet>
      <SheetTrigger render={
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" />
      }>
        <Info className="h-4 w-4" />
      </SheetTrigger>
      <SheetContent side="right" className="w-[540px] sm:max-w-[540px] overflow-y-auto">
        <SheetHeader className="pb-3">
          <SheetTitle>계산결과 해설 보기 — 파싱 안내</SheetTitle>
          <p className="text-xs text-muted-foreground leading-relaxed">
            좌측 CALC_PROC_TOTAL 원문에서 아래 패턴을 읽어 우측 해설 카드를 생성합니다.
            외부 DB 컬럼에는 의존하지 않습니다.
          </p>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-6">
          {PARSE_POINTS.map((p, i) => <ParsePointCard key={i} p={p} />)}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── 메인 페이지 ───────────────────────────────────────────────────────────
const TAX_LABEL:    Record<TaxFilterType,    string> = { all: "전체", nonzero: "결정세액 > 0", zero: "결정세액 = 0" }
const CALC_LABEL:   Record<CalcFilterType,   string> = { all: "전체", standard: "표준세액공제", special: "특별세액공제" }
const WORK_LABEL:   Record<WorkFilterType,   string> = { all: "전체", continue: "계속근로", midleave: "중도퇴사" }
const REVIEW_LABEL: Record<ReviewFilterType, string> = { all: "전체", standardcontinue: "표준&계속근로", incomeexhausted: "소득소진", housingsavings: "주택저축(세대원)", housingsavings400: "주택저축400한도", ralr: "원리금상환액", card: "신용카드", medi: "의료비", taxexhausted: "세액소진", manyinput: "입력데이터많음" }

const SS_KEY = {
  year:         "tax-insight:year",
  taxFilter:    "tax-insight:taxFilter",
  calcFilter:   "tax-insight:calcFilter",
  workFilter:   "tax-insight:workFilter",
  reviewFilter: "tax-insight:reviewFilter",
  selectedNo:   "tax-insight:selectedNo",
}
export default function TaxInsightPage() {
  const [year,         setYear]         = useState(AVAILABLE_YEARS[AVAILABLE_YEARS.length - 1])
  const [taxFilter,    setTaxFilter]    = useState<TaxFilterType>  ("all")
  const [calcFilter,   setCalcFilter]   = useState<CalcFilterType> ("all")
  const [workFilter,   setWorkFilter]   = useState<WorkFilterType> ("all")
  const [reviewFilter, setReviewFilter] = useState<ReviewFilterType>("all")
  const [ready,        setReady]        = useState(false)
  const [items, setItems]         = useState<CalcListItem[]>([])
  const [idx, setIdx]             = useState(0)
  const [selectedNo, setSelectedNo] = useState<string>("")
  const [result, setResult]       = useState<AnalysisResult | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingData, setLoadingData] = useState(false)
  const savedCalcNoRef = useRef("")

  // 마운트 후 sessionStorage 복원 — ready 플래그로 저장/조회 이펙트 게이트
  useEffect(() => {
    setYear(        sessionStorage.getItem(SS_KEY.year)          ?? AVAILABLE_YEARS[AVAILABLE_YEARS.length - 1])
    setTaxFilter(  (sessionStorage.getItem(SS_KEY.taxFilter)     ?? "all") as TaxFilterType)
    setCalcFilter( (sessionStorage.getItem(SS_KEY.calcFilter)    ?? "all") as CalcFilterType)
    setWorkFilter( (sessionStorage.getItem(SS_KEY.workFilter)    ?? "all") as WorkFilterType)
    setReviewFilter((sessionStorage.getItem(SS_KEY.reviewFilter) ?? "all") as ReviewFilterType)
    savedCalcNoRef.current = sessionStorage.getItem(SS_KEY.selectedNo) ?? ""
    setReady(true)
  }, [])

  // 필터 변경 시 sessionStorage 저장 — 복원 완료 후에만
  useEffect(() => {
    if (!ready) return
    sessionStorage.setItem(SS_KEY.year,         year)
    sessionStorage.setItem(SS_KEY.taxFilter,    taxFilter)
    sessionStorage.setItem(SS_KEY.calcFilter,   calcFilter)
    sessionStorage.setItem(SS_KEY.workFilter,   workFilter)
    sessionStorage.setItem(SS_KEY.reviewFilter, reviewFilter)
  }, [year, taxFilter, calcFilter, workFilter, reviewFilter, ready])

  // 선택 건 변경 시 sessionStorage 저장
  useEffect(() => {
    if (selectedNo) sessionStorage.setItem(SS_KEY.selectedNo, selectedNo)
  }, [selectedNo])

  // 목록 조회 — 필터 변경 시 자동 실행 (복원 완료 후에만)
  useEffect(() => {
    if (!ready) return
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
  }, [year, taxFilter, calcFilter, workFilter, reviewFilter, ready])

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
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === "ArrowLeft")  move(-1)
      if (e.key === "ArrowRight") move(1)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [idx, items])

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
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">계산결과 해설 보기</h1>
          <ParsingGuideSheet />
        </div>
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
              <SelectItem value="standardcontinue">표준&amp;계속근로</SelectItem>
              <SelectItem value="incomeexhausted">소득소진</SelectItem>
              <SelectItem value="taxexhausted">세액소진</SelectItem>
              <SelectItem value="housingsavings">주택저축(세대원)</SelectItem>
              <SelectItem value="housingsavings400">주택저축400한도</SelectItem>
              <SelectItem value="ralr">원리금상환액</SelectItem>
              <SelectItem value="card">신용카드</SelectItem>
              <SelectItem value="medi">의료비</SelectItem>
              <SelectItem value="manyinput">입력데이터많음</SelectItem>
            </SelectContent>
          </Select>

        </div>

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

        {/* 이전 */}
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(-1)} disabled={idx === 0 || loadingList}>
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {/* 카운터 */}
        <span className="text-sm text-muted-foreground tabular-nums">
          {loadingList ? "…" : `${items.length > 0 ? idx + 1 : 0} / ${items.length}`}
        </span>

        {/* 다음 */}
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(1)} disabled={idx >= items.length - 1 || loadingList}>
          <ChevronRight className="h-4 w-4" />
        </Button>

        {/* 처음으로 */}
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => { setIdx(0); setSelectedNo(items[0]?.calcNo ?? "") }} disabled={loadingList || items.length === 0}>
          <RotateCcw className="h-4 w-4" />
        </Button>

        {/* 재조회 */}
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => fetchAnalysis(selectedNo)} disabled={!selectedNo || loadingData}>
          <RefreshCw className="h-3.5 w-3.5" />
          조회
        </Button>

        {/* 엑셀 다운로드 */}
        <a href={`/api/tools/tax-insight/export?year=${year}`} download>
          <Button variant="outline" size="sm" className="h-8 gap-1.5">
            <Download className="h-3.5 w-3.5" />
            카드현황
          </Button>
        </a>
      </div>

      {/* 요약 바 */}
      {result && <SummaryBar data={result} name={items[idx]?.name} />}

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
