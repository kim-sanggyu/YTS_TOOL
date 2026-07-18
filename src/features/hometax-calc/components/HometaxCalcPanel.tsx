"use client"

import { useState, useEffect, useRef, Fragment } from "react"
import { Loader2, Play, CheckCircle2, XCircle, FileSearch, FileDown, FileText, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { toast } from "sonner"
import { CARD_SUBTOTAL_CODE } from "@/features/hometax-calc/mapping/card"
import { MEDI_SUBTOTAL_CODE } from "@/features/hometax-calc/mapping/medi"
import { MAPPING_2025, type MappingRow } from "@/features/hometax-calc/mapping/2025"

const CUR_YEAR     = new Date().getFullYear()                          // 2026
const YEAR_OPTIONS = [String(CUR_YEAR), String(CUR_YEAR - 1)]         // ["2026", "2025"]
const NTS_YEARS    = ["2025"]                                          // NTS 지원 귀속연도 목록 (지원 추가 시 앞에 추가)

const NTS_FLOW: { code: string; label: string }[] = [
  { code: "8901", label: "근로소득공제" },
  { code: "8902", label: "근로소득금액" },
  { code: "8903", label: "종합소득 과세표준" },
  { code: "8990", label: "산출세액" },
  { code: "8923", label: "근로소득세액공제" },
  { code: "8999", label: "결정세액" },
  { code: "8998", label: "지방소득세" },
  { code: "8992", label: "차감징수세액" },
]

// 기타 탭 항목 카탈로그 — 매핑 tab:"기타"(send·resultCol) 에서 파생(etcList.ETC_ROWS 와 동일 필터).
// 기타 탭은 이 목록으로 드롭다운을 채우고, 선택된 한 항목만 본문 리스트로 필터링한다.
// 기타 드롭다운 = 그룹 항목(여러 코드 묶음) + 단일코드 항목(매핑 tab:"기타") 순.
// 인적공제(소득공제) / 혼인·자녀·출산(세액공제)를 성격별로 분리한 두 그룹.
const PERSONAL_GROUPS: Record<string, { label: string; param: "income" | "credit" }> = {
  PERSONAL:      { label: "인적공제",     param: "income" },  // 배우자·부양가족·추가공제(경로/장애/부녀/한부모)
  FAMILY_CREDIT: { label: "혼인자녀출산", param: "credit" },  // 혼인·자녀·출산입양
}
// disabled = 표시만 하고 선택 불가(비교할 게 없는 항목). 연금보험료는 전액공제라 OUT=IN 이라 대조 무의미 → 안내용.
const ETC_TAB_ITEMS: { code: string; label: string; disabled?: boolean }[] = [
  ...Object.entries(PERSONAL_GROUPS).map(([code, g]) => ({ code, label: g.label })),
  { code: "PENSION_INS", label: "연금보험료", disabled: true },
  { code: "SPECIAL_INS", label: "보험료공제(건강·고용)", disabled: true },
  ...MAPPING_2025
    .filter(m => m.tab === "기타" && m.send && m.resultCol)
    .map(m => ({ code: m.ntsCode, label: m.label })),
]

// ── 타입 ─────────────────────────────────────────────────────────────────────
interface ListItem {
  calcNo: string; nm: string
  totPayAmt: number; prodTaxAmt: number; resIncmTax: number; effctvTaxRate: number
}
interface GiftLine {
  code: string | null   // NTS amtClusCd (없으면 미매핑)
  giftCls: string; label: string; giftYy: string
  ytsSub: number        // YTS 세액공제 (GIFT_SUB_AMT)
  ableSub: number       // 공제대상금액 (전송값, GIFT_ABLE_SUB_AMT)
}
interface GiftListItem {
  calcNo: string; nm: string; totPayAmt: number; giftTax: number
  exhausted?: boolean; exhaustLabel?: string | null
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  lines: GiftLine[]
}
interface CardLine {
  code: string          // NTS amtClusCd (전송 코드)
  label: string         // 신용카드/직불·선불/현금영수증/전통시장/대중교통/도서공연
  useAmt: number        // 전송 사용액 (CALC_PROC_CARD 가~아)
}
interface CardListItem {
  calcNo: string; nm: string; totPayAmt: number
  cardDdc: number       // YTS 카드소득공제 (=OTO_CARD_ETC, 비교 기준)
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  lines: CardLine[]
}
// 세액소진 표시용 (세액공제 탭 공통) — 소진자는 개별 항목 YTS-NTS 차이가 소진 때문임을 암시
interface Exhaustable { exhausted?: boolean; exhaustLabel?: string | null }
function ExhaustBadge({ item }: { item: Exhaustable }) {
  if (!item.exhausted) return null
  return (
    <span
      className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 align-middle whitespace-nowrap"
      title="산출세액이 앞 항목에서 소진되어 이 항목 공제가 0으로 처리됨 — YTS·NTS 차이의 원인일 수 있음"
    >
      {item.exhaustLabel ?? "세액소진"}
    </span>
  )
}

// 본행에 삽입하는 person 정보(사번/표준·특별/계속·퇴사/계산과정) 4칸 — 사람 단위 값이라 본행에 한 번만 표시
interface PersonInfo extends Exhaustable {
  calcNo: string; nm: string
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
}
function PersonMainCells({ item, onShowProc }: {
  item: PersonInfo
  onShowProc: (info: { calcNo: string; nm: string; text: string }) => void
}) {
  return (
    <>
      <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{item.empNo}</td>
      <td className="px-3 py-2 text-center text-muted-foreground">{item.calcType}</td>
      <td className="px-3 py-2 text-center text-muted-foreground">{item.workStatus}</td>
      <td className="px-3 py-2 text-left whitespace-nowrap">
        <Button
          size="sm" variant="ghost" className="h-6 w-6 p-0"
          disabled={!item.calcProcTotal}
          title="계산과정" aria-label="계산과정"
          onClick={() => item.calcProcTotal && onShowProc({ calcNo: item.calcNo, nm: item.nm, text: item.calcProcTotal })}
        >
          <FileText className="h-4 w-4" />
        </Button>
        <ExhaustBadge item={item} />
      </td>
    </>
  )
}

// ── 계산과정(CALC_PROC_TOTAL) 전체 텍스트 드로어 ─────────────────────────────
function ProcTotalView({ info }: { info: { calcNo: string; nm: string; text: string } }) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="flex items-center gap-2">
          <span className="font-mono text-sm">{info.calcNo}</span>
          <span className="text-foreground">{info.nm}</span>
          <span className="text-muted-foreground text-sm font-normal">계산과정</span>
        </SheetTitle>
      </SheetHeader>
      <div className="flex-1 min-h-0 overflow-auto px-4 py-3">
        <pre
          className="whitespace-pre text-xs leading-relaxed"
          style={{ fontFamily: "'D2Coding', 'GulimChe', '굴림체', monospace" }}
        >{info.text}</pre>
      </div>
    </div>
  )
}
interface MediLine {
  code: string          // NTS amtClusCd (전송 코드)
  label: string         // 본인·65세·장애인 / 그밖 / 난임 / 미숙아
  useAmt: number        // 전송 지출금액 (CALC_PROC_MEDI 대상자별)
}
interface MediListItem {
  calcNo: string; nm: string; totPayAmt: number
  mediDdc: number       // YTS 의료비 세액공제 (=RT_MEDI_AMT, 비교 기준)
  exhausted?: boolean; exhaustLabel?: string | null
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  lines: MediLine[]
}
interface PensionLine {
  code: string          // NTS amtClusCd (전송 코드)
  label: string         // 과학기술인/퇴직연금(IRP)/연금저축/ISA-퇴직/ISA-개인
  useAmt: number        // 전송 납입액 (PAY_WRK_PEN_SAVE_SPEC 코드별 합산)
  ytsDdc: number        // YTS 항목별 세액공제액 (PEN_SAVE_SUB_AMT 코드별 합, NTS self 대조 기준)
}
interface PensionListItem {
  calcNo: string; nm: string; totPayAmt: number
  penDdc: number        // YTS 연금계좌 세액공제 합 (=Σ line.ytsDdc, 비교 기준)
  exhausted?: boolean; exhaustLabel?: string | null
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  lines: PensionLine[]
}
interface EtcLine {
  code: string          // NTS amtClusCd (예 8750 월세)
  label: string         // 항목명
  ytsInput: number      // 전송 원천값 (월세=원본 지급총액)
  ytsDdc: number        // YTS 공제액 (resultCol=RT_*, 항목별 비교 기준)
}
interface EtcListItem {
  calcNo: string; nm: string; totPayAmt: number
  etcDdc: number        // 기타 세액공제 합 (=Σ lines.ytsDdc, 본행 비교 기준)
  exhausted?: boolean; exhaustLabel?: string | null
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  lines: EtcLine[]
}
interface PersonalLine {
  code: string          // NTS 회신 amtClusCd (배우자8002/부양가족8003/추가공제8101~04/혼인8790/자녀8763/출산8761)
  label: string; kind: string   // 소득공제/세액공제
  ytsDdc: number        // YTS 공제액 (NTS ntsMap[code] 와 대조)
}
interface PersonalListItem {
  calcNo: string; nm: string; totPayAmt: number
  exhausted?: boolean; exhaustLabel?: string | null
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  lines: PersonalLine[]
}
interface NtsResult {
  prodTax: number | null; decidedTax: number | null; withheld: number | null
  workDdc: number | null; taxBase: number | null; resultCode: string | null
}
interface YtsResult {
  totPayAmt: number; paymIncmTax: number
  prodTaxAmt: number; resIncmTax: number; subIncmTax: number
}
interface InputRow {
  code: string; label: string; ytsCol: string | null; valueKey: string; sent: number
}
interface MissingRow { code: string; label: string; amount: number }
interface RowResult {
  yts: YtsResult | null
  nts: NtsResult
  inputs: InputRow[]
  ntsMap: Record<string, number>
  missing: MissingRow[]
  ranAt: string; duration: number
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────
const won  = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString("ko-KR")
const rate = (n: number | null | undefined) => n == null ? "—" : n.toFixed(1) + "%"
const time = (ms: number) => (ms / 1000).toFixed(1) + "초"
// 비교 본행 배경색: 일치=연녹 / 불일치=적색 / 미실행=무색 (모든 비교탭 공통 — 색은 여기 한 곳에서만 바꾼다)
const matchRowBg = (diff: number | null) => diff === 0 ? "bg-green-50/40" : diff != null ? "bg-red-200/70" : ""

// 비교일시 표기: YY.MM.DD HH:MM
function formatRanAt(d: Date): string {
  const yy = String(d.getFullYear()).slice(2)
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mi = String(d.getMinutes()).padStart(2, "0")
  return `${yy}.${mm}.${dd} ${hh}:${mi}`
}

function MatchIcon({ yts, nts }: { yts: number | null; nts: number | null }) {
  if (nts == null || yts == null) return <span className="text-muted-foreground/30">—</span>
  return yts === nts
    ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
    : <XCircle      className="h-3.5 w-3.5 text-red-500" />
}

// ranAt 미지정 시 현재시각(라이브 실행). 캐시 복원 시엔 원래 실행시각 표시문자열을 넘긴다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildRowResult(json: any, duration: number, ranAt?: string): RowResult {
  return {
    yts:      json.yts     ?? null,
    nts:      json.nts     ?? { prodTax: null, decidedTax: null, withheld: null, workDdc: null, taxBase: null, resultCode: json.error ? "E" : null },
    inputs:   json.inputs  ?? [],
    ntsMap:   json.ntsMap  ?? {},
    missing:  json.missing ?? [],
    ranAt:    ranAt ?? formatRanAt(new Date()),
    duration,
  }
}

function errorRowResult(duration: number, ranAt?: string): RowResult {
  return {
    yts: null,
    nts: { prodTax: null, decidedTax: null, withheld: null, workDdc: null, taxBase: null, resultCode: "E" },
    inputs: [], ntsMap: {}, missing: [],
    ranAt: ranAt ?? formatRanAt(new Date()), duration,
  }
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export function HometaxCalcPanel() {
  const [year,           setYear]           = useState(String(CUR_YEAR))       // 우리자료 귀속연도
  const [ntsYear,        setNtsYear]        = useState(NTS_YEARS[0])            // 국세청 모의계산 귀속연도
  const [tab,            setTab]            = useState<"all" | "gift" | "card" | "medi" | "pension" | "etc" | "status">("all")
  const [allItems,       setAllItems]       = useState<ListItem[]>([])
  const [giftItems,      setGiftItems]      = useState<GiftListItem[]>([])
  const [cardItems,      setCardItems]      = useState<CardListItem[]>([])
  const [mediItems,      setMediItems]      = useState<MediListItem[]>([])
  const [pensionItems,   setPensionItems]   = useState<PensionListItem[]>([])
  const [etcItems,       setEtcItems]       = useState<EtcListItem[]>([])
  const [personalItems,  setPersonalItems]  = useState<PersonalListItem[]>([])   // 기타>인적공제 그룹
  const [etcCode,        setEtcCode]        = useState<string>(ETC_TAB_ITEMS[0]?.code ?? "")   // 기타 탭에서 선택된 항목(드롭다운)
  const [etcMenuOpen,    setEtcMenuOpen]    = useState(false)                                  // 기타 드롭다운 열림(항목 선택 시 닫기)
  const [loading,        setLoading]        = useState(false)
  const [running,        setRunning]        = useState<Set<string>>(new Set())
  const [results,        setResults]        = useState<Record<string, RowResult>>({})
  const [detailFor,      setDetailFor]      = useState<string | null>(null)
  const [procTotalFor,   setProcTotalFor]   = useState<{ calcNo: string; nm: string; text: string } | null>(null)
  const [sessionInfo,    setSessionInfo]    = useState<{ active: boolean; ageMinutes: number | null }>({ active: false, ageMinutes: null })
  const [sessionLoading, setSessionLoading] = useState(false)
  const [batchRunning,   setBatchRunning]   = useState(false)
  const [batchProgress,  setBatchProgress]  = useState<{ done: number; total: number; skipped: number } | null>(null)
  const [batchFile,      setBatchFile]      = useState<string | null>(null)
  const [batchError,     setBatchError]     = useState<string | null>(null)
  const [diffOnly,       setDiffOnly]       = useState(false)
  const [cachedAt,       setCachedAt]       = useState<string | null>(null)   // 복원된 이전 실행 결과 저장시각(ISO)

  // 세션 상태 30초마다 폴링
  useEffect(() => {
    const check = () =>
      fetch("/api/tools/hometax-calc/session")
        .then(r => r.json()).then(setSessionInfo).catch(() => {})
    check()
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [])

  async function startSession() {
    setSessionLoading(true)
    try {
      const res = await fetch("/api/tools/hometax-calc/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      })
      setSessionInfo(await res.json())
    } finally {
      setSessionLoading(false)
    }
  }

  async function stopSession() {
    await fetch("/api/tools/hometax-calc/session", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    })
    setSessionInfo({ active: false, ageMinutes: null })
  }

  // 저장된 이전 실행 결과 삭제 + 화면 비교결과 비움. 재실행 전까지 복원되지 않는다.
  async function clearCache() {
    if (!window.confirm("저장된 이전 실행 결과를 삭제합니다. 화면의 비교결과도 비워지고 되돌릴 수 없습니다. 계속할까요?")) return
    try {
      await fetch(`/api/tools/hometax-calc/batch-results?year=${year}&ntsYear=${ntsYear}`, { method: "DELETE" })
    } catch { /* 무시 */ }
    setResults({})
    setCachedAt(null)
    setBatchFile(null)
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setAllItems([]); setGiftItems([]); setCardItems([]); setMediItems([]); setPensionItems([]); setEtcItems([]); setPersonalItems([]); setResults({}); setLoading(true); setDiffOnly(false)
      if (tab === "status") { setLoading(false); return }   // 현황 탭은 정적(MAPPING_2025 렌더) — fetch 없음
      const url = tab === "all"
        ? `/api/tools/hometax-calc/list?year=${year}&ntsYear=${ntsYear}`
        : `/api/tools/hometax-calc/list?year=${year}&ntsYear=${ntsYear}&type=${tab}`
      try {
        const d = await fetch(url).then(r => r.json())
        if (cancelled) return
        if (tab === "gift")         setGiftItems(d.items ?? [])
        else if (tab === "card")    setCardItems(d.items ?? [])
        else if (tab === "medi")    setMediItems(d.items ?? [])
        else if (tab === "pension") setPensionItems(d.items ?? [])
        else if (tab === "etc")     setEtcItems(d.items ?? [])
        else                        setAllItems(d.items ?? [])
      } catch { /* 무시 */ } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [tab, year, ntsYear])

  // 기타>인적공제/혼인자녀출산 그룹 선택 시 사람별 YTS 공제 조회 (NTS 값은 results.ntsMap 에서 조인).
  useEffect(() => {
    if (tab !== "etc" || !PERSONAL_GROUPS[etcCode]) return
    const group = PERSONAL_GROUPS[etcCode].param
    let cancelled = false
    fetch(`/api/tools/hometax-calc/list?year=${year}&ntsYear=${ntsYear}&type=personal&group=${group}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setPersonalItems(d.items ?? []) })
      .catch(() => { /* 무시 */ })
    return () => { cancelled = true }
  }, [tab, etcCode, year, ntsYear])

  // 저장된 이전 실행 결과 복원 — 배치탭 진입/파라미터 변경 시 캐시(JSON)를 읽어 results를 채운다.
  // 라이브 결과(현재 세션에서 방금 실행한 건)는 덮지 않는다("이미 있으면 유지" = 최신 우선).
  useEffect(() => {
    if (tab !== "gift" && tab !== "card" && tab !== "medi" && tab !== "pension" && tab !== "etc") return
    let cancelled = false
    fetch(`/api/tools/hometax-calc/batch-results?year=${year}&ntsYear=${ntsYear}`)
      .then(r => r.json())
      .then((d: { savedAt: string | null; filePath?: string | null; rows: { calcNo: string; ok: boolean; result: unknown; error: string | null; ranAt: string; duration: number }[] }) => {
        if (cancelled || !d.rows?.length) return
        setResults(prev => {
          const next = { ...prev }
          for (const row of d.rows) {
            if (next[row.calcNo]) continue
            const ranAt = formatRanAt(new Date(row.ranAt))
            next[row.calcNo] = row.ok
              ? buildRowResult(row.result, row.duration, ranAt)
              : errorRowResult(row.duration, ranAt)
          }
          return next
        })
        setCachedAt(d.savedAt)
        setBatchFile(d.filePath ?? null)   // 복원 후에도 마지막 배치 엑셀 "결과파일 열기" 가능
      })
      .catch(() => { /* 캐시 없음/오류 무시 */ })
    return () => { cancelled = true }
  }, [tab, year, ntsYear])

  async function runCompare(calcNo: string) {
    if (running.has(calcNo)) return
    setRunning(prev => new Set(prev).add(calcNo))
    const start = Date.now()
    try {
      const res  = await fetch("/api/tools/hometax-calc", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ calcNo, mode: "compare", ntsYear, year }),
      })
      const json = await res.json()
      setResults(prev => ({ ...prev, [calcNo]: buildRowResult(json, Date.now() - start) }))
      // 세션이 새로 생성됐을 수 있으므로 상태 갱신
      fetch("/api/tools/hometax-calc/session").then(r => r.json()).then(setSessionInfo).catch(() => {})
    } catch {
      setResults(prev => ({ ...prev, [calcNo]: errorRowResult(Date.now() - start) }))
    } finally {
      setRunning(prev => { const s = new Set(prev); s.delete(calcNo); return s })
    }
  }

  // ── 비교탭 전체 실행 (백그라운드 배치, SSE로 진행상황 수신) ────────────────────
  // personal = 기타>인적공제 그룹(탭이 아닌 서브모드) 전용 배치 — 대상은 인적공제 발생자 전원.
  const BATCH_ENDPOINT = { gift: "gift-batch", card: "card-batch", medi: "medi-batch", pension: "pension-batch", etc: "etc-batch", personal: "personal-batch" } as const
  type BatchTab = keyof typeof BATCH_ENDPOINT
  const BATCH_TAB_COUNT: Record<BatchTab, number> = {
    gift: giftItems.length, card: cardItems.length, medi: mediItems.length, pension: pensionItems.length, etc: etcItems.length, personal: personalItems.length,
  }
  const batchEsRef = useRef<EventSource | null>(null)

  function stopBatch() {
    batchEsRef.current?.close()
    batchEsRef.current = null
    setBatchRunning(false)
    setBatchError("사용자가 중단했습니다.")
  }

  function runItemBatch(batchTab: BatchTab) {
    if (batchRunning) return
    setBatchRunning(true)
    setBatchProgress({ done: 0, total: BATCH_TAB_COUNT[batchTab], skipped: 0 })
    setBatchFile(null)
    setBatchError(null)

    const groupQs = batchTab === "personal" ? `&group=${personalGroupParam}` : ""
    const es = new EventSource(`/api/tools/hometax-calc/${BATCH_ENDPOINT[batchTab]}?year=${year}&ntsYear=${ntsYear}${groupQs}`)
    batchEsRef.current = es

    es.addEventListener("start", (e) => {
      const { total } = JSON.parse((e as MessageEvent).data) as { total: number }
      setBatchProgress({ done: 0, total, skipped: 0 })
    })

    es.addEventListener("row", (e) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = JSON.parse((e as MessageEvent).data) as { calcNo: string; ok: boolean; result?: any; error?: string; duration: number; cached?: boolean }
      setResults(prev => ({
        ...prev,
        [data.calcNo]: data.ok ? buildRowResult(data.result, data.duration) : errorRowResult(data.duration),
      }))
      setBatchProgress(prev => prev ? { ...prev, done: prev.done + 1, skipped: prev.skipped + (data.cached ? 1 : 0) } : prev)
    })

    es.addEventListener("blocked", (e) => {
      const { message } = JSON.parse((e as MessageEvent).data) as { message: string }
      setBatchError(message)
    })

    es.addEventListener("done", (e) => {
      const { filePath } = JSON.parse((e as MessageEvent).data) as { filePath: string }
      setBatchFile(filePath)
      setCachedAt(new Date().toISOString())   // 방금 돌린 결과도 캐시에 저장됨 → "저장된 결과 한 벌"로 통일 표시
      setBatchRunning(false)
      es.close()
      batchEsRef.current = null
      fetch("/api/tools/hometax-calc/session").then(r => r.json()).then(setSessionInfo).catch(() => {})
    })

    es.addEventListener("error", (e) => {
      try {
        const { message } = JSON.parse((e as MessageEvent).data) as { message: string }
        setBatchError(message)
      } catch {
        setBatchError("배치 실행 중 오류가 발생했습니다.")
      }
      setBatchRunning(false)
      es.close()
      batchEsRef.current = null
    })

    es.onerror = () => {
      setBatchRunning(false)
      es.close()
      batchEsRef.current = null
    }
  }


  const detailRes = detailFor ? results[detailFor] : null
  const detailRow = detailFor ? (allItems.find(i => i.calcNo === detailFor) ?? null) : null

  // 기타 탭: 드롭다운으로 고른 한 항목(etcCode)만 남긴다 — 각 사람의 lines 를 해당 code 한 줄로 축소.
  const etcByCode: EtcListItem[] = etcItems
    .map(row => {
      const line = row.lines.find(l => l.code === etcCode)
      return line ? { ...row, lines: [line], etcDdc: line.ytsDdc } : null
    })
    .filter((r): r is EtcListItem => r !== null)

  const etcLabel = ETC_TAB_ITEMS.find(i => i.code === etcCode)?.label ?? ""
  const isPersonalGroup = tab === "etc" && !!PERSONAL_GROUPS[etcCode]   // 기타>인적공제/혼인자녀출산 그룹 뷰
  const personalGroupParam = PERSONAL_GROUPS[etcCode]?.param ?? "income"

  const currentCount = tab === "gift" ? giftItems.length : tab === "card" ? cardItems.length : tab === "medi" ? mediItems.length : tab === "pension" ? pensionItems.length : tab === "etc" ? (isPersonalGroup ? personalItems.length : etcByCode.length) : allItems.length

  // 탭별 YTS·NTS 값이 다른지 판정 (실행 전이면 false) — 차이 건수 집계·필터링에 공통 사용
  function giftHasDiff(i: GiftListItem): boolean {
    const res = results[i.calcNo]
    if (!res) return false
    const ntsTotal = i.lines.reduce((s, l) => s + (l.code ? (res.ntsMap[l.code] ?? 0) : 0), 0)
    return ntsTotal - i.giftTax !== 0
  }
  function subtotalHasDiff<T extends { calcNo: string }>(i: T, target: (i: T) => number, code: string): boolean {
    const res = results[i.calcNo]
    if (!res) return false
    return (res.ntsMap[code] ?? 0) - target(i) !== 0
  }
  function allHasDiff(i: ListItem): boolean {
    const res = results[i.calcNo]
    if (!res) return false
    return i.prodTaxAmt !== (res.nts.prodTax ?? -1) || i.resIncmTax !== (res.nts.decidedTax ?? -1)
  }
  // 기타 탭: 이질 항목이라 소계코드가 없어 lines 의 각 code 합으로 대조 (giftHasDiff 동형)
  function etcHasDiff(i: EtcListItem): boolean {
    const res = results[i.calcNo]
    if (!res) return false
    const ntsTotal = i.lines.reduce((s, l) => s + (res.ntsMap[l.code] ?? 0), 0)
    return ntsTotal - i.etcDdc !== 0
  }
  // 연금계좌: 국세청 항목별 self(8701~8708) 합으로 대조 (etcHasDiff 동형)
  function pensionHasDiff(i: PensionListItem): boolean {
    const res = results[i.calcNo]
    if (!res) return false
    const ntsTotal = i.lines.reduce((s, l) => s + (res.ntsMap[l.code] ?? 0), 0)
    return ntsTotal - i.penDdc !== 0
  }
  // 인적공제 그룹: 항목별 code 대조 — 하나라도 YTS≠NTS 면 차이 (소득/세액 혼재라 합산 대신 항목별 판정)
  function personalHasDiff(i: PersonalListItem): boolean {
    const res = results[i.calcNo]
    if (!res) return false
    return i.lines.some(l => (res.ntsMap[l.code] ?? 0) !== l.ytsDdc)
  }

  const diffCount =
    tab === "gift"    ? giftItems.filter(giftHasDiff).length :
    tab === "card"    ? cardItems.filter(i => subtotalHasDiff(i, x => x.cardDdc, CARD_SUBTOTAL_CODE)).length :
    tab === "medi"    ? mediItems.filter(i => subtotalHasDiff(i, x => x.mediDdc, MEDI_SUBTOTAL_CODE)).length :
    tab === "pension" ? pensionItems.filter(pensionHasDiff).length :
    tab === "etc"     ? (isPersonalGroup ? personalItems.filter(personalHasDiff).length : etcByCode.filter(etcHasDiff).length) :
    allItems.filter(allHasDiff).length

  // 차이만 보기 필터 활성 시 현재 탭의 items를 차이나는 건만 추림
  const showDiffOnly     = diffOnly && diffCount > 0
  const shownAllItems     = showDiffOnly ? allItems.filter(allHasDiff) : allItems
  const shownGiftItems    = showDiffOnly ? giftItems.filter(giftHasDiff) : giftItems
  const shownCardItems    = showDiffOnly ? cardItems.filter(i => subtotalHasDiff(i, x => x.cardDdc, CARD_SUBTOTAL_CODE)) : cardItems
  const shownMediItems    = showDiffOnly ? mediItems.filter(i => subtotalHasDiff(i, x => x.mediDdc, MEDI_SUBTOTAL_CODE)) : mediItems
  const shownPensionItems = showDiffOnly ? pensionItems.filter(pensionHasDiff) : pensionItems
  const shownEtcItems     = showDiffOnly ? etcByCode.filter(etcHasDiff) : etcByCode
  const shownPersonalItems = showDiffOnly ? personalItems.filter(personalHasDiff) : personalItems

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 헤더 */}
      <div className="shrink-0 flex items-center gap-2 p-4 border-b">
        {/* 우리자료 연도 */}
        <span className="text-xs text-muted-foreground whitespace-nowrap">YTS 데이터</span>
        <Select value={year} onValueChange={v => { if (v) setYear(v) }}>
          <SelectTrigger className="w-24 h-7 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {YEAR_OPTIONS.map(y => (
              <SelectItem key={y} value={y}>{y}년</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 국세청 모의계산 연도 */}
        <span className="text-xs text-muted-foreground whitespace-nowrap">국세청 모의계산</span>
        <Select value={ntsYear} onValueChange={v => { if (v) setNtsYear(v) }}>
          <SelectTrigger className="w-24 h-7 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NTS_YEARS.map(y => (
              <SelectItem key={y} value={y}>{y}년</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="w-px h-5 bg-border mx-1" />
        <div className="flex rounded-md border overflow-hidden text-xs font-medium">
          <button
            className={`px-3 py-1.5 transition-colors ${tab === "all" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setTab("all")}
          >전체 비교</button>
        </div>

        <div className="flex rounded-md border overflow-hidden text-xs font-medium">
          <button
            className={`px-3 py-1.5 transition-colors ${tab === "gift" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setTab("gift")}
          >기부금</button>
          <button
            className={`px-3 py-1.5 border-l transition-colors ${tab === "card" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setTab("card")}
          >신용카드</button>
          <button
            className={`px-3 py-1.5 border-l transition-colors ${tab === "medi" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setTab("medi")}
          >의료비</button>
          <button
            className={`px-3 py-1.5 border-l transition-colors ${tab === "pension" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setTab("pension")}
          >연금계좌</button>
          {/* 기타 = 드롭다운: 잡다 세액공제 항목 중 하나를 골라 본문 리스트 필터로 사용 */}
          <DropdownMenu open={etcMenuOpen} onOpenChange={setEtcMenuOpen}>
            <DropdownMenuTrigger
              className={`px-3 py-1.5 border-l transition-colors inline-flex items-center gap-1 ${tab === "etc" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              onClick={() => setTab("etc")}
            >
              기타{etcLabel ? `: ${etcLabel}` : ""}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup value={etcCode} onValueChange={c => { setEtcCode(c); setTab("etc"); setEtcMenuOpen(false) }}>
                {ETC_TAB_ITEMS.map(it => (
                  <DropdownMenuRadioItem key={it.code} value={it.code} disabled={it.disabled} className="text-xs">
                    {it.label}
                    {/* 실제 단일 NTS코드(숫자, 8750 등)만 코드 표시. 그룹·안내용 복합키는 생략 */}
                    {/^\d/.test(it.code) && (
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground/50">{it.code}</span>
                    )}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {(tab === "gift" || tab === "card" || tab === "medi" || tab === "pension" || tab === "etc") && (
          <>
            <Button
              size="sm" variant={batchRunning ? "destructive" : "outline"} className="h-7 text-xs"
              disabled={!batchRunning && BATCH_TAB_COUNT[isPersonalGroup ? "personal" : tab] === 0}
              onClick={() => batchRunning ? stopBatch() : runItemBatch(isPersonalGroup ? "personal" : tab)}
            >
              {batchRunning
                ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />중단 ({batchProgress?.done ?? 0}/{batchProgress?.total ?? 0}{batchProgress?.skipped ? `, 스킵 ${batchProgress.skipped}` : ""})</>
                : "전체 실행"}
            </Button>
            {batchError && (
              <span className="text-xs text-red-600">{batchError}</span>
            )}
            {/* 저장된 전체실행 결과 = 한 벌. 방금 돌렸든 복원됐든 항상 같은 모양: 실행시각 + (방금 돌렸으면)결과파일 + 지우기 */}
            {cachedAt && !batchRunning && (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span title="저장된 전체실행 결과입니다. 다시 실행하면 갱신됩니다.">
                  실행 {formatRanAt(new Date(cachedAt))}
                </span>
                {batchFile && (
                  <span
                    className="flex items-center gap-1 text-green-600 cursor-pointer hover:underline"
                    title={`${batchFile}\n(클릭 시 탐색기에서 위치 열기)`}
                    onClick={() => {
                      fetch("/api/tools/hometax-calc/reveal-file", {
                        method:  "POST",
                        headers: { "Content-Type": "application/json" },
                        body:    JSON.stringify({ path: batchFile }),
                      })
                        .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "열기 실패") })
                        .catch(e => toast.error(e instanceof Error ? e.message : "열기 실패"))
                    }}
                  >
                    <FileDown className="h-3.5 w-3.5" />결과파일
                  </span>
                )}
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs text-muted-foreground" onClick={clearCache}>
                  지우기
                </Button>
              </span>
            )}
          </>
        )}

        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {!loading && currentCount > 0 && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            {currentCount}명 조회됨
            {diffCount > 0 && (
              <button
                className={`rounded px-1.5 py-0.5 font-medium transition-colors ${diffOnly ? "bg-red-600 text-white" : "text-red-600 hover:bg-red-50"}`}
                onClick={() => setDiffOnly(v => !v)}
              >
                ({diffCount}명 차이)
              </button>
            )}
          </span>
        )}

        {/* 현황 탭 — NTS 세션 영역 바로 앞(우측) */}
        <div className="ml-auto flex rounded-md border overflow-hidden text-xs font-medium">
          <button
            className={`px-3 py-1.5 transition-colors ${tab === "status" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setTab("status")}
          >현황</button>
        </div>

        {/* 세션 상태 */}
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 text-xs ${sessionInfo.active ? "text-green-600" : "text-muted-foreground"}`}>
            <span className={`h-2 w-2 rounded-full ${sessionInfo.active ? "bg-green-500" : "bg-muted-foreground/30"}`} />
            {sessionInfo.active ? `NTS 세션 활성 (${sessionInfo.ageMinutes}분)` : "NTS 세션 없음"}
          </span>
          {sessionInfo.active ? (
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={stopSession}>
              종료
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={sessionLoading} onClick={startSession}>
              {sessionLoading ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />시작 중...</> : "세션 시작"}
            </Button>
          )}
        </div>
      </div>

      {/* 테이블 */}
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === "all"  && <AllTable  items={shownAllItems}  loading={loading} results={results} running={running} onRun={runCompare} onDetail={setDetailFor} />}
        {tab === "gift" && <GiftTable items={shownGiftItems} loading={loading} results={results} running={running} onRun={runCompare} onDetail={setDetailFor} onShowProc={setProcTotalFor} />}
        {tab === "card" && <CardTable items={shownCardItems} loading={loading} results={results} running={running} onRun={runCompare} onDetail={setDetailFor} onShowProc={setProcTotalFor} />}
        {tab === "medi" && <MediTable items={shownMediItems} loading={loading} results={results} running={running} onRun={runCompare} onDetail={setDetailFor} onShowProc={setProcTotalFor} />}
        {tab === "pension" && <PensionTable items={shownPensionItems} loading={loading} results={results} running={running} onRun={runCompare} onDetail={setDetailFor} onShowProc={setProcTotalFor} />}
        {tab === "etc" && (isPersonalGroup
          ? <PersonalTable items={shownPersonalItems} title={etcLabel} loading={loading} results={results} running={running} onRun={runCompare} onDetail={setDetailFor} onShowProc={setProcTotalFor} />
          : <EtcTable items={shownEtcItems} loading={loading} results={results} running={running} onRun={runCompare} onDetail={setDetailFor} onShowProc={setProcTotalFor} />)}
        {tab === "status" && <MappingStatusView ntsYear={ntsYear} />}
      </div>

      {/* 상세조회 드로어 */}
      <Sheet open={detailFor !== null} onOpenChange={o => { if (!o) setDetailFor(null) }}>
        <SheetContent side="right" className="w-full p-0" style={{ maxWidth: "min(92vw, 60rem)" }}>
          {detailRes && <DetailView res={detailRes} row={detailRow} calcNo={detailFor!} />}
        </SheetContent>
      </Sheet>

      {/* 계산과정 전체 텍스트 드로어 */}
      <Sheet open={procTotalFor !== null} onOpenChange={o => { if (!o) setProcTotalFor(null) }}>
        <SheetContent side="right" className="w-full p-0" style={{ maxWidth: "min(92vw, 64rem)" }}>
          {procTotalFor && <ProcTotalView info={procTotalFor} />}
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ── 전체 비교 테이블 ─────────────────────────────────────────────────────────
function AllTable({ items, loading, results, running, onRun, onDetail }: {
  items: ListItem[]; loading: boolean
  results: Record<string, RowResult>; running: Set<string>
  onRun: (calcNo: string) => void; onDetail: (calcNo: string) => void
}) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
        <tr className="border-b text-xs text-muted-foreground">
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">CALC_NO</th>
          <th className="px-3 py-2 text-left font-medium">이름</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">총급여</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">산출세액</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">실효세율</th>
          <th className="px-3 py-2 text-center font-medium">실행</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap" colSpan={2}>산출세액 (YTS/NTS)</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap" colSpan={2}>결정세액 (YTS/NTS)</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">실행일</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">소요</th>
        </tr>
        <tr className="border-b text-[10px] text-muted-foreground/60 bg-muted/70">
          <th colSpan={5} /><th />
          <th className="px-3 py-1 text-right font-normal">YTS39</th>
          <th className="px-3 py-1 text-right font-normal">NTS</th>
          <th className="px-3 py-1 text-right font-normal">YTS39</th>
          <th className="px-3 py-1 text-right font-normal">NTS</th>
          <th colSpan={2} />
        </tr>
      </thead>
      <tbody>
        {items.length === 0 && !loading && (
          <tr><td colSpan={12} className="px-3 py-8 text-center text-sm text-muted-foreground">데이터가 없습니다.</td></tr>
        )}
        {items.map(row => {
          const res = results[row.calcNo]
          const isRunning = running.has(row.calcNo)
          const prodMatch = res ? row.prodTaxAmt === (res.nts.prodTax ?? -1) : null
          const resMatch  = res ? row.resIncmTax  === (res.nts.decidedTax ?? -1) : null
          return (
            <tr key={row.calcNo} className={`border-b hover:bg-muted/20 ${res && prodMatch && resMatch ? "bg-green-50/30" : res ? "bg-yellow-50/30" : ""}`}>
              <td className="px-3 py-2 font-mono text-xs">{row.calcNo}</td>
              <td className="px-3 py-2">{row.nm}</td>
              <td className="px-3 py-2 text-right tabular-nums">{won(row.totPayAmt)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{won(row.prodTaxAmt)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{rate(row.effctvTaxRate)}</td>
              <td className="px-3 py-2 text-center whitespace-nowrap">
                <div className="flex items-center justify-center gap-1">
                  <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={isRunning} onClick={() => onRun(row.calcNo)}>
                    {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={!res} onClick={() => onDetail(row.calcNo)}>
                    <FileSearch className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-xs">{won(row.prodTaxAmt)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-xs">
                <span className="flex items-center justify-end gap-1">
                  {res ? won(res.nts.prodTax) : "—"}
                  {res && <MatchIcon yts={row.prodTaxAmt} nts={res.nts.prodTax} />}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-xs">{won(row.resIncmTax)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-xs">
                <span className="flex items-center justify-end gap-1">
                  {res ? won(res.nts.decidedTax) : "—"}
                  {res && <MatchIcon yts={row.resIncmTax} nts={res.nts.decidedTax} />}
                </span>
              </td>
              <td className="px-3 py-2 text-right text-xs text-muted-foreground">{res?.ranAt ?? "—"}</td>
              <td className="px-3 py-2 text-right text-xs text-muted-foreground">{res ? time(res.duration) : "—"}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── 기부금 비교 테이블 (본행 합계 + 유형×연도 세부행) ────────────────────────
function GiftTable({ items, loading, results, running, onRun, onDetail, onShowProc }: {
  items: GiftListItem[]; loading: boolean
  results: Record<string, RowResult>; running: Set<string>
  onRun: (calcNo: string) => void; onDetail: (calcNo: string) => void
  onShowProc: (info: { calcNo: string; nm: string; text: string }) => void
}) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
        <tr className="border-b text-xs text-muted-foreground">
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">CALC_NO</th>
          <th className="px-3 py-2 text-left font-medium">이름</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">사번</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">표준/특별</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">계속/퇴사</th>
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">계산과정</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">총급여</th>
          <th className="px-3 py-2 text-center font-medium">실행</th>
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">항목</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">연도</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">전송 사용액</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">YTS 공제금액</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">NTS 공제금액</th>
          <th className="px-3 py-2 text-center font-medium w-10 whitespace-nowrap">일치</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">차이</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">비교일시</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">소요</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 && !loading && (
          <tr><td colSpan={17} className="px-3 py-8 text-center text-sm text-muted-foreground">기부금 데이터가 없습니다.</td></tr>
        )}
        {items.map(row => {
          const res       = results[row.calcNo]
          const isRunning = running.has(row.calcNo)
          const ntsTotal  = res ? row.lines.reduce((s, l) => s + (l.code ? (res.ntsMap[l.code] ?? 0) : 0), 0) : null
          const diff      = ntsTotal != null ? ntsTotal - row.giftTax : null
          const ableTotal = row.lines.reduce((s, l) => s + l.ableSub, 0)
          return (
            <Fragment key={row.calcNo}>
              {/* 본행 = 합계 */}
              <tr className={`[&>td]:py-0 [&_button]:h-5 hover:bg-muted/20 ${matchRowBg(diff)}`}>
                <td className="px-3 py-2 font-mono text-xs">{row.calcNo}</td>
                <td className="px-3 py-2 whitespace-nowrap">{row.nm}</td>
                <PersonMainCells item={row} onShowProc={onShowProc} />
                <td className="px-3 py-2 text-right tabular-nums">{won(row.totPayAmt)}</td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  <div className="flex items-center justify-center gap-1">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={isRunning} onClick={() => onRun(row.calcNo)}>
                      {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={!res} onClick={() => onDetail(row.calcNo)}>
                      <FileSearch className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground" colSpan={2}>기부금공제 소계</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{won(ableTotal)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{won(row.giftTax)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{ntsTotal != null ? won(ntsTotal) : "—"}</td>
                <td className="px-3 py-2 text-center">
                  <span className="inline-flex justify-center"><MatchIcon yts={ntsTotal != null ? row.giftTax : null} nts={ntsTotal} /></span>
                </td>
                <td className={`px-3 py-2 text-right tabular-nums text-xs ${diff != null && diff !== 0 ? "text-red-600 font-medium" : "text-muted-foreground/50"}`}>
                  {diff == null ? "—" : diff === 0 ? "0" : (diff > 0 ? "+" : "") + diff.toLocaleString("ko-KR")}
                </td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">{res?.ranAt ?? "—"}</td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground">{res ? time(res.duration) : "—"}</td>
              </tr>
              {/* 유형×연도 세부행 */}
              {row.lines.map((line, i) => {
                const ntsVal = res && line.code ? (res.ntsMap[line.code] ?? 0) : null
                const d = ntsVal != null ? ntsVal - line.ytsSub : null
                const last = i === row.lines.length - 1
                return (
                  <tr key={`${line.giftCls}-${line.giftYy}`} className={`${last ? "border-b" : ""} text-xs`}>
                    <td colSpan={8} />
                    <td className="px-3 py-1 text-muted-foreground whitespace-nowrap">{line.label}</td>
                    <td className="px-3 py-1 text-center tabular-nums text-muted-foreground">{line.giftYy}</td>
                    <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">{won(line.ableSub)}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{won(line.ytsSub)}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{ntsVal != null ? won(ntsVal) : "—"}</td>
                    <td className="px-3 py-1 text-center">
                      <span className="inline-flex justify-center"><MatchIcon yts={ntsVal != null ? line.ytsSub : null} nts={ntsVal} /></span>
                    </td>
                    <td className={`px-3 py-1 text-right tabular-nums ${d != null && d !== 0 ? "text-red-600 font-medium" : "text-muted-foreground/40"}`}>
                      {d == null ? "—" : d === 0 ? "0" : (d > 0 ? "+" : "") + d.toLocaleString("ko-KR")}
                    </td>
                    <td colSpan={2} />
                  </tr>
                )
              })}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

// ── 신용카드 비교 테이블 (본행 = 카드소득공제 소계 / 세부행 = 가~아 전송 사용액) ──
//   비교 기준: YTS 카드소득공제(=OTO_CARD_ETC) ↔ NTS 8430(카드소계).
//   세부행은 "우리가 보낸 사용액"(입력)이며 항목별 공제는 NTS가 소계로만 반환하므로 대조 없음.
function CardTable({ items, loading, results, running, onRun, onDetail, onShowProc }: {
  items: CardListItem[]; loading: boolean
  results: Record<string, RowResult>; running: Set<string>
  onRun: (calcNo: string) => void; onDetail: (calcNo: string) => void
  onShowProc: (info: { calcNo: string; nm: string; text: string }) => void
}) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
        <tr className="border-b text-xs text-muted-foreground">
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">CALC_NO</th>
          <th className="px-3 py-2 text-left font-medium">이름</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">사번</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">표준/특별</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">계속/퇴사</th>
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">계산과정</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">총급여</th>
          <th className="px-3 py-2 text-center font-medium">실행</th>
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">항목</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">전송 사용액</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">YTS 공제</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">NTS 공제</th>
          <th className="px-3 py-2 text-center font-medium w-10 whitespace-nowrap">일치</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">차이</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">비교일시</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">소요</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 && !loading && (
          <tr><td colSpan={16} className="px-3 py-8 text-center text-sm text-muted-foreground">신용카드 데이터가 없습니다.</td></tr>
        )}
        {items.map(row => {
          const res       = results[row.calcNo]
          const isRunning = running.has(row.calcNo)
          const ntsDdc    = res ? (res.ntsMap[CARD_SUBTOTAL_CODE] ?? 0) : null
          const diff      = ntsDdc != null ? ntsDdc - row.cardDdc : null
          const useTotal  = row.lines.reduce((s, l) => s + l.useAmt, 0)
          return (
            <Fragment key={row.calcNo}>
              {/* 본행 = 카드공제 소계 */}
              <tr className={`[&>td]:py-0 [&_button]:h-5 hover:bg-muted/20 ${matchRowBg(diff)}`}>
                <td className="px-3 py-2 font-mono text-xs">{row.calcNo}</td>
                <td className="px-3 py-2">{row.nm}</td>
                <PersonMainCells item={row} onShowProc={onShowProc} />
                <td className="px-3 py-2 text-right tabular-nums">{won(row.totPayAmt)}</td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  <div className="flex items-center justify-center gap-1">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={isRunning} onClick={() => onRun(row.calcNo)}>
                      {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={!res} onClick={() => onDetail(row.calcNo)}>
                      <FileSearch className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">카드공제 소계</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{won(useTotal)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{won(row.cardDdc)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{ntsDdc != null ? won(ntsDdc) : "—"}</td>
                <td className="px-3 py-2 text-center">
                  <span className="inline-flex justify-center"><MatchIcon yts={ntsDdc != null ? row.cardDdc : null} nts={ntsDdc} /></span>
                </td>
                <td className={`px-3 py-2 text-right tabular-nums text-xs ${diff != null && diff !== 0 ? "text-red-600 font-medium" : "text-muted-foreground/50"}`}>
                  {diff == null ? "—" : diff === 0 ? "0" : (diff > 0 ? "+" : "") + diff.toLocaleString("ko-KR")}
                </td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">{res?.ranAt ?? "—"}</td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground">{res ? time(res.duration) : "—"}</td>
              </tr>
              {/* 세부행 = 가~아 전송 사용액 (입력) */}
              {row.lines.map((line, i) => {
                const last = i === row.lines.length - 1
                return (
                  <tr key={line.code} className={`${last ? "border-b" : ""} text-xs`}>
                    <td colSpan={8} />
                    <td className="px-3 py-1 text-muted-foreground whitespace-nowrap">
                      {line.label}
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/40">{line.code}</span>
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums">{won(line.useAmt)}</td>
                    <td className="px-3 py-1 text-right text-muted-foreground/30">—</td>
                    <td className="px-3 py-1 text-right text-muted-foreground/30">—</td>
                    <td /><td /><td colSpan={2} />
                  </tr>
                )
              })}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

// ── 의료비 비교 테이블 (본행 = 의료비 세액공제 소계 / 세부행 = 대상자별 지출금액) ──
//   비교 기준: YTS 의료비 세액공제(=RT_MEDI_AMT) ↔ NTS 8726(의료비집계).
//   세부행은 "우리가 보낸 지출금액"(입력)이며 항목별 공제는 NTS가 소계로만 반환하므로 대조 없음.
function MediTable({ items, loading, results, running, onRun, onDetail, onShowProc }: {
  items: MediListItem[]; loading: boolean
  results: Record<string, RowResult>; running: Set<string>
  onRun: (calcNo: string) => void; onDetail: (calcNo: string) => void
  onShowProc: (info: { calcNo: string; nm: string; text: string }) => void
}) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
        <tr className="border-b text-xs text-muted-foreground">
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">CALC_NO</th>
          <th className="px-3 py-2 text-left font-medium">이름</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">사번</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">표준/특별</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">계속/퇴사</th>
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">계산과정</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">총급여</th>
          <th className="px-3 py-2 text-center font-medium">실행</th>
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">항목</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">전송 사용액</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">YTS 공제</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">NTS 공제</th>
          <th className="px-3 py-2 text-center font-medium w-10 whitespace-nowrap">일치</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">차이</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">비교일시</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">소요</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 && !loading && (
          <tr><td colSpan={16} className="px-3 py-8 text-center text-sm text-muted-foreground">의료비 데이터가 없습니다.</td></tr>
        )}
        {items.map(row => {
          const res       = results[row.calcNo]
          const isRunning = running.has(row.calcNo)
          const ntsDdc    = res ? (res.ntsMap[MEDI_SUBTOTAL_CODE] ?? 0) : null
          const diff      = ntsDdc != null ? ntsDdc - row.mediDdc : null
          const useTotal  = row.lines.reduce((s, l) => s + l.useAmt, 0)
          return (
            <Fragment key={row.calcNo}>
              {/* 본행 = 의료비 세액공제 소계 */}
              <tr className={`[&>td]:py-0 [&_button]:h-5 hover:bg-muted/20 ${matchRowBg(diff)}`}>
                <td className="px-3 py-2 font-mono text-xs">{row.calcNo}</td>
                <td className="px-3 py-2 whitespace-nowrap">{row.nm}</td>
                <PersonMainCells item={row} onShowProc={onShowProc} />
                <td className="px-3 py-2 text-right tabular-nums">{won(row.totPayAmt)}</td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  <div className="flex items-center justify-center gap-1">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={isRunning} onClick={() => onRun(row.calcNo)}>
                      {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={!res} onClick={() => onDetail(row.calcNo)}>
                      <FileSearch className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">의료비공제 소계</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{won(useTotal)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{won(row.mediDdc)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{ntsDdc != null ? won(ntsDdc) : "—"}</td>
                <td className="px-3 py-2 text-center">
                  <span className="inline-flex justify-center"><MatchIcon yts={ntsDdc != null ? row.mediDdc : null} nts={ntsDdc} /></span>
                </td>
                <td className={`px-3 py-2 text-right tabular-nums text-xs ${diff != null && diff !== 0 ? "text-red-600 font-medium" : "text-muted-foreground/50"}`}>
                  {diff == null ? "—" : diff === 0 ? "0" : (diff > 0 ? "+" : "") + diff.toLocaleString("ko-KR")}
                </td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">{res?.ranAt ?? "—"}</td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground">{res ? time(res.duration) : "—"}</td>
              </tr>
              {/* 세부행 = 대상자별 지출금액 (입력) */}
              {row.lines.map((line, i) => {
                const last = i === row.lines.length - 1
                return (
                  <tr key={line.code} className={`${last ? "border-b" : ""} text-xs`}>
                    <td colSpan={8} />
                    <td className="px-3 py-1 text-muted-foreground whitespace-nowrap">
                      {line.label}
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/40">{line.code}</span>
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums">{won(line.useAmt)}</td>
                    <td className="px-3 py-1 text-right text-muted-foreground/30">—</td>
                    <td className="px-3 py-1 text-right text-muted-foreground/30">—</td>
                    <td /><td /><td colSpan={2} />
                  </tr>
                )
              })}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

// ── 기타 비교 테이블 (본행 = 기타 세액공제 합 / 세부행 = 항목별 대조) ──
//   이질 항목(월세 등)이라 소계코드가 없어 lines 의 각 code 합으로 본행 대조.
//   세부행은 항목별로 YTS공제(resultCol) ↔ NTS(ntsCode)를 직접 대조(medi 와 달리 세부행도 비교).
function EtcTable({ items, loading, results, running, onRun, onDetail, onShowProc }: {
  items: EtcListItem[]; loading: boolean
  results: Record<string, RowResult>; running: Set<string>
  onRun: (calcNo: string) => void; onDetail: (calcNo: string) => void
  onShowProc: (info: { calcNo: string; nm: string; text: string }) => void
}) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
        <tr className="border-b text-xs text-muted-foreground">
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">CALC_NO</th>
          <th className="px-3 py-2 text-left font-medium">이름</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">사번</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">표준/특별</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">계속/퇴사</th>
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">계산과정</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">총급여</th>
          <th className="px-3 py-2 text-center font-medium">실행</th>
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">항목</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">전송 사용액</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">YTS 공제</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">NTS 공제</th>
          <th className="px-3 py-2 text-center font-medium w-10 whitespace-nowrap">일치</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">차이</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">비교일시</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">소요</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 && !loading && (
          <tr><td colSpan={16} className="px-3 py-8 text-center text-sm text-muted-foreground">기타 세액공제 데이터가 없습니다.</td></tr>
        )}
        {items.map(row => {
          const res       = results[row.calcNo]
          const isRunning = running.has(row.calcNo)
          const ntsTotal  = res ? row.lines.reduce((s, l) => s + (res.ntsMap[l.code] ?? 0), 0) : null
          const diff      = ntsTotal != null ? ntsTotal - row.etcDdc : null
          const inputTotal = row.lines.reduce((s, l) => s + l.ytsInput, 0)
          return (
            <Fragment key={row.calcNo}>
              {/* 본행 = 기타 세액공제 합 */}
              <tr className={`[&>td]:py-0 [&_button]:h-5 hover:bg-muted/20 ${matchRowBg(diff)}`}>
                <td className="px-3 py-2 font-mono text-xs">{row.calcNo}</td>
                <td className="px-3 py-2 whitespace-nowrap">{row.nm}</td>
                <PersonMainCells item={row} onShowProc={onShowProc} />
                <td className="px-3 py-2 text-right tabular-nums">{won(row.totPayAmt)}</td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  <div className="flex items-center justify-center gap-1">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={isRunning} onClick={() => onRun(row.calcNo)}>
                      {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={!res} onClick={() => onDetail(row.calcNo)}>
                      <FileSearch className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">기타공제 소계</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{won(inputTotal)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{won(row.etcDdc)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{ntsTotal != null ? won(ntsTotal) : "—"}</td>
                <td className="px-3 py-2 text-center">
                  <span className="inline-flex justify-center"><MatchIcon yts={ntsTotal != null ? row.etcDdc : null} nts={ntsTotal} /></span>
                </td>
                <td className={`px-3 py-2 text-right tabular-nums text-xs ${diff != null && diff !== 0 ? "text-red-600 font-medium" : "text-muted-foreground/50"}`}>
                  {diff == null ? "—" : diff === 0 ? "0" : (diff > 0 ? "+" : "") + diff.toLocaleString("ko-KR")}
                </td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">{res?.ranAt ?? "—"}</td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground">{res ? time(res.duration) : "—"}</td>
              </tr>
              {/* 세부행 = 항목별 대조 (YTS공제 ↔ NTS) */}
              {row.lines.map((line, i) => {
                const last   = i === row.lines.length - 1
                const ntsVal = res ? (res.ntsMap[line.code] ?? null) : null
                const ldiff  = ntsVal != null ? ntsVal - line.ytsDdc : null
                return (
                  <tr key={line.code} className={`${last ? "border-b" : ""} text-xs`}>
                    <td colSpan={8} />
                    <td className="px-3 py-1 text-muted-foreground whitespace-nowrap">
                      {line.label}
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/40">{line.code}</span>
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">{won(line.ytsInput)}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{won(line.ytsDdc)}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{ntsVal != null ? won(ntsVal) : "—"}</td>
                    <td className="px-3 py-1 text-center">
                      <span className="inline-flex justify-center"><MatchIcon yts={ntsVal != null ? line.ytsDdc : null} nts={ntsVal} /></span>
                    </td>
                    <td className={`px-3 py-1 text-right tabular-nums ${ldiff != null && ldiff !== 0 ? "text-red-600 font-medium" : "text-muted-foreground/40"}`}>
                      {ldiff == null ? "—" : ldiff === 0 ? "0" : (ldiff > 0 ? "+" : "") + ldiff.toLocaleString("ko-KR")}
                    </td>
                    <td colSpan={2} />
                  </tr>
                )
              })}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

// ── 연금계좌 비교 테이블 (본행 = 세액공제 합 / 세부행 = 종류별 self 대조) ──
//   ★국세청이 항목별 self ddcAmt(8701~8708) 반환 → 세부행마다 YTS공제(계좌별 SUB 합) ↔ NTS(각 code) 직접대조.
//   YTS 항목별 세액공제액 = PAY_WRK_PEN_SAVE_SPEC.PEN_SAVE_SUB_AMT 코드별 합(RT_ISA_PEN_AMT 단일컬럼 우회).
//   ISA 8707/8708 도 계좌별로 분리 저장돼 각각 1:1 대조 가능(2026-07-15 실측확정).
function PensionTable({ items, loading, results, running, onRun, onDetail, onShowProc }: {
  items: PensionListItem[]; loading: boolean
  results: Record<string, RowResult>; running: Set<string>
  onRun: (calcNo: string) => void; onDetail: (calcNo: string) => void
  onShowProc: (info: { calcNo: string; nm: string; text: string }) => void
}) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
        <tr className="border-b text-xs text-muted-foreground">
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">CALC_NO</th>
          <th className="px-3 py-2 text-left font-medium">이름</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">사번</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">표준/특별</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">계속/퇴사</th>
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">계산과정</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">총급여</th>
          <th className="px-3 py-2 text-center font-medium">실행</th>
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">항목</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">전송 사용액</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">YTS 공제</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">NTS 공제</th>
          <th className="px-3 py-2 text-center font-medium w-10 whitespace-nowrap">일치</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">차이</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">비교일시</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">소요</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 && !loading && (
          <tr><td colSpan={16} className="px-3 py-8 text-center text-sm text-muted-foreground">연금계좌 데이터가 없습니다.</td></tr>
        )}
        {items.map(row => {
          const res       = results[row.calcNo]
          const isRunning = running.has(row.calcNo)
          const ntsTotal  = res ? row.lines.reduce((s, l) => s + (res.ntsMap[l.code] ?? 0), 0) : null
          const diff      = ntsTotal != null ? ntsTotal - row.penDdc : null
          const useTotal  = row.lines.reduce((s, l) => s + l.useAmt, 0)
          return (
            <Fragment key={row.calcNo}>
              {/* 본행 = 연금계좌 세액공제 합 */}
              <tr className={`[&>td]:py-0 [&_button]:h-5 hover:bg-muted/20 ${matchRowBg(diff)}`}>
                <td className="px-3 py-2 font-mono text-xs">{row.calcNo}</td>
                <td className="px-3 py-2 whitespace-nowrap">{row.nm}</td>
                <PersonMainCells item={row} onShowProc={onShowProc} />
                <td className="px-3 py-2 text-right tabular-nums">{won(row.totPayAmt)}</td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  <div className="flex items-center justify-center gap-1">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={isRunning} onClick={() => onRun(row.calcNo)}>
                      {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={!res} onClick={() => onDetail(row.calcNo)}>
                      <FileSearch className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">연금계좌공제 소계</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{won(useTotal)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{won(row.penDdc)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{ntsTotal != null ? won(ntsTotal) : "—"}</td>
                <td className="px-3 py-2 text-center">
                  <span className="inline-flex justify-center"><MatchIcon yts={ntsTotal != null ? row.penDdc : null} nts={ntsTotal} /></span>
                </td>
                <td className={`px-3 py-2 text-right tabular-nums text-xs ${diff != null && diff !== 0 ? "text-red-600 font-medium" : "text-muted-foreground/50"}`}>
                  {diff == null ? "—" : diff === 0 ? "0" : (diff > 0 ? "+" : "") + diff.toLocaleString("ko-KR")}
                </td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">{res?.ranAt ?? "—"}</td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground">{res ? time(res.duration) : "—"}</td>
              </tr>
              {/* 세부행 = 종류별 self 대조 (전송 납입액 + YTS공제 ↔ NTS) */}
              {row.lines.map((line, i) => {
                const last   = i === row.lines.length - 1
                const ntsVal = res ? (res.ntsMap[line.code] ?? null) : null
                const ldiff  = ntsVal != null ? ntsVal - line.ytsDdc : null
                return (
                  <tr key={line.code} className={`${last ? "border-b" : ""} text-xs`}>
                    <td colSpan={8} />
                    <td className="px-3 py-1 text-muted-foreground whitespace-nowrap">
                      {line.label}
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/40">{line.code}</span>
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">{won(line.useAmt)}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{won(line.ytsDdc)}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{ntsVal != null ? won(ntsVal) : "—"}</td>
                    <td className="px-3 py-1 text-center">
                      <span className="inline-flex justify-center"><MatchIcon yts={ntsVal != null ? line.ytsDdc : null} nts={ntsVal} /></span>
                    </td>
                    <td className={`px-3 py-1 text-right tabular-nums ${ldiff != null && ldiff !== 0 ? "text-red-600 font-medium" : "text-muted-foreground/40"}`}>
                      {ldiff == null ? "—" : ldiff === 0 ? "0" : (ldiff > 0 ? "+" : "") + ldiff.toLocaleString("ko-KR")}
                    </td>
                    <td colSpan={2} />
                  </tr>
                )
              })}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

// 인적공제 그룹 = 본인 제외, 배우자·부양가족·추가공제(소득공제) + 혼인·자녀·출산(세액공제) 항목별 대조.
// 소득/세액 혼재라 소계 합산은 무의미 → 본행은 "N항목 중 M 불일치" 요약, 세부행이 항목별 YTS↔NTS 판정.
function PersonalTable({ items, title, loading, results, running, onRun, onDetail, onShowProc }: {
  items: PersonalListItem[]; title: string; loading: boolean
  results: Record<string, RowResult>; running: Set<string>
  onRun: (calcNo: string) => void; onDetail: (calcNo: string) => void
  onShowProc: (info: { calcNo: string; nm: string; text: string }) => void
}) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
        <tr className="border-b text-xs text-muted-foreground">
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">CALC_NO</th>
          <th className="px-3 py-2 text-left font-medium">이름</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">사번</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">표준/특별</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">계속/퇴사</th>
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">계산과정</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">총급여</th>
          <th className="px-3 py-2 text-center font-medium">실행</th>
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">항목</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">YTS 공제</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">NTS 공제</th>
          <th className="px-3 py-2 text-center font-medium w-10 whitespace-nowrap">일치</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">차이</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">비교일시</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">소요</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 && !loading && (
          <tr><td colSpan={15} className="px-3 py-8 text-center text-sm text-muted-foreground">{title} 데이터가 없습니다.</td></tr>
        )}
        {items.map(row => {
          const res       = results[row.calcNo]
          const isRunning = running.has(row.calcNo)
          const mismatch  = res ? row.lines.filter(l => (res.ntsMap[l.code] ?? 0) !== l.ytsDdc).length : null
          return (
            <Fragment key={row.calcNo}>
              {/* 본행 = 인적공제 요약(항목수·불일치 건수). 소득/세액 혼재라 공제액 합산은 표시 안 함. */}
              <tr className={`[&>td]:py-0 [&_button]:h-5 hover:bg-muted/20 ${matchRowBg(mismatch)}`}>
                <td className="px-3 py-2 font-mono text-xs">{row.calcNo}</td>
                <td className="px-3 py-2 whitespace-nowrap">{row.nm}</td>
                <PersonMainCells item={row} onShowProc={onShowProc} />
                <td className="px-3 py-2 text-right tabular-nums">{won(row.totPayAmt)}</td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  <div className="flex items-center justify-center gap-1">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={isRunning} onClick={() => onRun(row.calcNo)}>
                      {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={!res} onClick={() => onDetail(row.calcNo)}>
                      <FileSearch className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{title} ({row.lines.length}항목)</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-center">
                  <span className="inline-flex justify-center"><MatchIcon yts={mismatch != null ? 0 : null} nts={mismatch} /></span>
                </td>
                <td className={`px-3 py-2 text-right tabular-nums text-xs ${mismatch ? "text-red-600 font-medium" : "text-muted-foreground/50"}`}>
                  {mismatch == null ? "—" : mismatch === 0 ? "0" : `${mismatch}건`}
                </td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">{res?.ranAt ?? "—"}</td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground">{res ? time(res.duration) : "—"}</td>
              </tr>
              {/* 세부행 = 항목별 YTS 공제 ↔ NTS ntsMap[code] */}
              {row.lines.map((line, i) => {
                const last   = i === row.lines.length - 1
                const ntsVal = res ? (res.ntsMap[line.code] ?? 0) : null
                const ldiff  = ntsVal != null ? ntsVal - line.ytsDdc : null
                return (
                  <tr key={line.code} className={`${last ? "border-b" : ""} text-xs`}>
                    <td colSpan={8} />
                    <td className="px-3 py-1 text-muted-foreground whitespace-nowrap">
                      {line.label}
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/40">{line.code}</span>
                      <span className="ml-1.5 text-[10px] text-muted-foreground/40">{line.kind}</span>
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums">{won(line.ytsDdc)}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{ntsVal != null ? won(ntsVal) : "—"}</td>
                    <td className="px-3 py-1 text-center">
                      <span className="inline-flex justify-center"><MatchIcon yts={ntsVal != null ? line.ytsDdc : null} nts={ntsVal} /></span>
                    </td>
                    <td className={`px-3 py-1 text-right tabular-nums ${ldiff != null && ldiff !== 0 ? "text-red-600 font-medium" : "text-muted-foreground/40"}`}>
                      {ldiff == null ? "—" : ldiff === 0 ? "0" : (ldiff > 0 ? "+" : "") + ldiff.toLocaleString("ko-KR")}
                    </td>
                    <td colSpan={2} />
                  </tr>
                )
              })}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

// ── 상세조회 뷰 ──────────────────────────────────────────────────────────────
function DetailView({ res, row, calcNo }: { res: RowResult; row: ListItem | null; calcNo: string }) {
  const yts = res.yts
  const nts = res.nts
  const ok  = nts.resultCode === "S" || nts.resultCode === null

  const compareRows: { label: string; yts: number | null; nts: number | null }[] = [
    { label: "산출세액", yts: yts?.prodTaxAmt ?? row?.prodTaxAmt ?? null, nts: nts.prodTax },
    { label: "결정세액", yts: yts?.resIncmTax ?? row?.resIncmTax ?? null, nts: nts.decidedTax },
    { label: "차감징수", yts: yts?.subIncmTax ?? null,                    nts: nts.withheld },
  ]

  return (
    <div className="flex flex-col h-full min-h-0">
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="flex items-center gap-2">
          <span className="font-mono text-sm">{calcNo}</span>
          {row && <span className="text-foreground">{row.nm}</span>}
          <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
            응답 {nts.resultCode ?? "—"}
          </span>
        </SheetTitle>
        <div className="flex gap-4 text-xs text-muted-foreground mt-0.5">
          <span>총급여 <b className="text-foreground tabular-nums">{won(yts?.totPayAmt ?? row?.totPayAmt)}</b></span>
          <span>기납부 <b className="text-foreground tabular-nums">{won(yts?.paymIncmTax)}</b></span>
        </div>
      </SheetHeader>

      <div className="flex-1 min-h-0 overflow-auto px-4 py-3 space-y-6">
        {/* 1) 결과 비교 */}
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground mb-2">① 결과 비교 (YTS39 ↔ NTS)</h3>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-[11px] text-muted-foreground">
                <th className="py-1.5 text-left font-medium">항목</th>
                <th className="py-1.5 text-right font-medium">YTS39</th>
                <th className="py-1.5 text-right font-medium">NTS</th>
                <th className="py-1.5 text-right font-medium w-14">차이</th>
                <th className="py-1.5 text-center font-medium w-10 whitespace-nowrap">일치</th>
              </tr>
            </thead>
            <tbody>
              {compareRows.map(r => {
                const diff = r.yts != null && r.nts != null ? r.nts - r.yts : null
                return (
                  <tr key={r.label} className="border-b last:border-0">
                    <td className="py-1.5">{r.label}</td>
                    <td className="py-1.5 text-right tabular-nums">{won(r.yts)}</td>
                    <td className="py-1.5 text-right tabular-nums">{won(r.nts)}</td>
                    <td className={`py-1.5 text-right tabular-nums text-xs ${diff ? "text-red-600" : "text-muted-foreground/50"}`}>
                      {diff == null ? "—" : diff === 0 ? "0" : (diff > 0 ? "+" : "") + diff.toLocaleString("ko-KR")}
                    </td>
                    <td className="py-1.5 text-center"><span className="inline-flex justify-center"><MatchIcon yts={r.yts} nts={r.nts} /></span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        {/* 2) NTS 계산 흐름 */}
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground mb-2">② NTS 계산 흐름</h3>
          <table className="w-full text-sm border-collapse">
            <tbody>
              {NTS_FLOW.map(f => {
                const v = res.ntsMap[f.code]
                return (
                  <tr key={f.code} className="border-b last:border-0">
                    <td className="py-1.5 text-muted-foreground">{f.label}</td>
                    <td className="py-1.5 text-right font-mono text-[10px] text-muted-foreground/50 w-14">{f.code}</td>
                    <td className="py-1.5 text-right tabular-nums">{v == null ? "—" : won(v)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        {/* 3) 전송한 공제 입력 */}
        <section>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-xs font-semibold text-muted-foreground">③ 전송한 공제 입력</h3>
            <span className="text-[10px] text-muted-foreground/60">
              총 {res.inputs.length}개 · 전송 {res.inputs.filter(i => i.sent > 0).length}개
            </span>
          </div>
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-muted/60">
                <tr className="text-[10px] text-muted-foreground">
                  <th className="px-2 py-1.5 text-left font-medium">코드</th>
                  <th className="px-2 py-1.5 text-left font-medium">항목</th>
                  <th className="px-2 py-1.5 text-left font-medium">값키</th>
                  <th className="px-2 py-1.5 text-left font-medium">YTS컬럼</th>
                  <th className="px-2 py-1.5 text-right font-medium">전송값</th>
                  <th className="px-2 py-1.5 text-right font-medium">NTS반영</th>
                </tr>
              </thead>
              <tbody>
                {res.inputs.map(inp => {
                  const zero   = inp.sent === 0
                  const ntsVal = res.ntsMap[inp.code]
                  const isMrrg = inp.code === "8790"   // 혼인공제: 특수전송(incDdcNfpCnt=1+ddcAmt 직접)
                  return (
                    <tr key={inp.code} className={`border-t ${zero ? "text-muted-foreground/40" : "bg-blue-50/30"}`}>
                      <td className="px-2 py-1 font-mono">{inp.code}</td>
                      <td className="px-2 py-1">{inp.label}</td>
                      <td className="px-2 py-1 font-mono text-[10px]">{isMrrg ? "incDdcNfpCnt+ddcAmt" : inp.valueKey}</td>
                      <td className="px-2 py-1 font-mono text-[10px]">{inp.ytsCol ?? "—"}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{zero ? "0" : inp.sent.toLocaleString("ko-KR")}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{ntsVal == null ? "—" : ntsVal.toLocaleString("ko-KR")}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* 4) 미전송 항목 */}
        {res.missing.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-red-600 mb-2">④ 미전송 항목 (차이 원인 후보)</h3>
            <div className="border border-red-200 rounded-md bg-red-50/40 p-3 space-y-1">
              {res.missing.map(e => (
                <div key={e.code} className="flex justify-between text-xs">
                  <span className="text-red-700">{e.label}</span>
                  <span className="tabular-nums text-red-700">{e.amount.toLocaleString("ko-KR")}</span>
                </div>
              ))}
              <p className="text-[10px] text-red-500/80 pt-1 border-t border-red-200 mt-1">
                이 항목들은 아직 NTS 로 전송하지 않아 결정세액 차이의 원인일 수 있습니다.
              </p>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

// ── 매핑 현황(진도) 뷰 — MAPPING_2025 를 그대로 렌더(코드=화면 항상 동기) ──
//   각 항목의 계약 5축(원천/IN/OUT/실측/전송)을 그룹별로 조회. 국세청 in-out 정리 진도판.
const OUT_GROUPS = new Set(["세액공제", "세액감면", "연금계좌", "기부금"])
// 국세청 결과(OUT) 코드: 명시 outCode 우선 → 소계형(가상컬럼 prefix) → 세액공제성 self → 없음(—)
function outCodeOf(m: MappingRow): string {
  if (m.outCode) return m.outCode
  if (m.ytsCol?.startsWith("CARD_")) return CARD_SUBTOTAL_CODE
  if (m.ytsCol?.startsWith("MEDI_")) return MEDI_SUBTOTAL_CODE
  // 연금(PEN_)은 실측확정 항목별 self OUT을 매핑 outCode 로 명시 → helper 폴백은 세액공제성 self
  if (OUT_GROUPS.has(m.group)) return m.ntsCode
  return "—"
}

// 소계형: 개별 입력행들이 하나의 소계 코드로 결과(ddcAmt)를 받는 그룹. 여기 매핑되면 self OUT 아님.
//   코드=화면 동기: outCode/CARD_·MEDI_ prefix(=payload 실측근거)에서만 파생, 그룹명 하드코딩 금지.
//   ytsOut = 실제 비교탭이 대조 기준으로 읽는 YTS 물리 공제컬럼(카드=OTO_CARD_ETC, 의료=RT_MEDI_AMT).
const SUBTOTAL_CODES = new Map<string, { label: string; ytsOut: string }>([
  [CARD_SUBTOTAL_CODE, { label: "카드소득공제 소계", ytsOut: "OTO_CARD_ETC" }],
  [MEDI_SUBTOTAL_CODE, { label: "의료비 세액공제 소계", ytsOut: "RT_MEDI_AMT" }],
  ["8761",             { label: "출산·입양 세액공제 소계", ytsOut: "RT_PER_CHI_AMT" }],   // 순번별 8764~8766(outCode 8761)의 소계 OUT. 8761엔 값 미전송(잉여, 2026-07-17 실측)
  ["8735",             { label: "교육비 세액공제 소계", ytsOut: "RT_EDU_AMT" }],           // 8730(outCode 8735)에 공제대상 총액 전송, 8735=결과전용 소계(2026-07-17 실측)
])

// 기타세액공제 ETX_ 가상컬럼 → PAY_WRK_MAIN 실제 원천 컬럼
const ETX_SRC: Record<string, string> = {
  ETX_8751: "FRGN_PAY_TAX", ETX_8754: "FRGN_TOT_PAY_AMT", ETX_8752: "HOUSE_ALR", ETX_8753: "ASSO_SUB_TAX_AMT",
}
// yts IN 물리 원천: route 가 주입하는 가상컬럼(CARD_/MEDI_/PEN_/GIFT_)을 실제 원천 테이블·컬럼으로 환원.
//   상규님 소통 기준 = "물리 원천". 그 외 ytsCol 은 이미 물리컬럼(NP_INSU_AMT 등)이라 그대로.
function ytsInOf(m: MappingRow): string {
  const c = m.ytsCol
  if (!c) return "—"
  if (c.startsWith("CARD_")) return "CALC_PROC_CARD"       // JSON 가~아 사용액
  if (c.startsWith("MEDI_")) return "CALC_PROC_MEDI"       // JSON 대상자별 지출금액
  if (c.startsWith("PEN_"))  return "PEN_SAVE_PMT_AMT"     // PAY_WRK_PEN_SAVE_SPEC 납입액
  if (c.startsWith("GIFT_")) return "GIFT_ABLE_SUB_AMT"    // PAY_WRK_GIFT_ADJ 공제대상금액(전송값)
  if (c.startsWith("RENT_")) return "HOUSE_RENT"           // PAY_WRK_MAIN 월세 지급총액(원본)
  if (c.startsWith("FAM_"))  return "PAY_WRK_FMLY"         // 부양가족 유형별·출산 순번별 인원 집계
  if (c.startsWith("ETX_"))  return ETX_SRC[c] ?? c        // 기타세액공제 PAY_WRK_MAIN 원천
  return c
}
// yts OUT 물리 공제컬럼(self행): 기부금은 라인별 GIFT_SUB_AMT, 그 외는 resultCol(RT_*).
function ytsOutOf(m: MappingRow): string {
  if (m.group === "기부금") return "GIFT_SUB_AMT"          // GiftTable 대조 기준
  return m.resultCol ?? "—"
}

// 현황탭 렌더 단위: self형/입력전용은 매핑행 1:1, 소계형은 개별행 + 합성 소계행.
//   IN/OUT을 국세청(nts)·우리(yts) 두 축으로 표시. nts IN=valueKey, nts OUT=ddcAmt,
//   yts IN=ytsCol(전송 원천 컬럼), yts OUT=resultCol(YTS 자체 공제액 컬럼).
interface StatusRow {
  key:        string
  label:      string
  code:       string
  ntsIn:      string   // 국세청에 넣는 필드키 (useAmt / incDdcNfpCnt / ddcTrgtAmt) — 소계행은 "—"
  ntsOut:     string   // 국세청이 돌려주는 값 (ddcAmt) — 소계 멤버/입력전용은 "—"
  ytsIn:      string   // 전송 원천 YTS39 컬럼 (ytsCol) — 소계행은 "—"
  ytsOut:     string   // YTS39 자체 공제액 컬럼 (resultCol) — 소계 멤버는 소계행으로 모음
  status:     string
  isSubtotal: boolean
}

// 한 그룹의 매핑행 → 렌더행. self형=IN·OUT 한 행, 소계형=개별행(OUT —) + 소계행(IN —, OUT).
function statusRowsOf(rows: MappingRow[], ntsYear: number): StatusRow[] {
  const out: StatusRow[] = []
  const emitted = new Set<string>()   // 소계행을 이미 낸 코드(중복 방지)
  rows.forEach((m, i) => {
    const oc    = outCodeOf(m)
    const isSub = SUBTOTAL_CODES.has(oc)
    // 혼인공제(8790): 특수전송(incDdcNfpCnt=1+ddcAmt 직접, 국세청 미검산) — 결정세액만 반영, 항목대조 안 함
    const isMrrg = m.ntsCode === "8790"
    // 연도별 코드(투자조합출자 등): 입력연도(ntsYear)+offset 로 "○○○○년" 을 라벨 앞에 렌더
    const label = m.yearOffset != null ? `투자조합출자 ${ntsYear + m.yearOffset}년 ${m.label}` : m.label
    out.push({
      key:   m.ntsCode + m.label,
      label,
      code:  m.ntsCode,
      ntsIn: isMrrg ? "incDdcNfpCnt+ddcAmt" : m.valueKey,
      ntsOut: isMrrg ? "—" : (oc === "—" || isSub ? "—" : "ddcAmt"),   // 소계 멤버는 결과를 소계행이 받으므로 self OUT 없음
      ytsIn:  ytsInOf(m),
      ytsOut: isMrrg ? "—" : (isSub ? "—" : ytsOutOf(m)),               // 소계 멤버의 공제액은 소계행에 몰아 nts OUT과 대칭
      status: m.status,
      isSubtotal: false,
    })
    // 소계행은 해당 소계의 "마지막 멤버" 바로 뒤에 삽입 → 개별행 옆에 붙음(카드·의료는 그룹말미라 위치 동일, 출산입양은 세액공제 그룹 중간이라 8766 뒤로 이동)
    if (isSub && !emitted.has(oc) && !rows.slice(i + 1).some(r => outCodeOf(r) === oc)) {
      emitted.add(oc)
      const meta = SUBTOTAL_CODES.get(oc)!
      out.push({
        key:   "sub-" + oc,
        label: meta.label,
        code:  oc,
        ntsIn: "—",
        ntsOut: "ddcAmt",
        ytsIn:  "—",
        ytsOut: meta.ytsOut,
        status: "확정",   // 소계 대조 = 실측확정된 부분
        isSubtotal: true,
      })
    }
  })
  return out
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "확정" ? "bg-green-100 text-green-700"
            : status === "추정" ? "bg-amber-100 text-amber-700"
            : "bg-muted text-muted-foreground"
  return <span className={`px-1.5 py-0.5 rounded text-[10px] ${cls}`}>{status}</span>
}

function MappingStatusView({ ntsYear }: { ntsYear: string }) {
  const yy = Number(ntsYear)
  const groups: { name: string; rows: MappingRow[] }[] = []
  for (const m of MAPPING_2025) {
    let g = groups.find(x => x.name === m.group)
    if (!g) { g = { name: m.group, rows: [] }; groups.push(g) }
    g.rows.push(m)
  }
  const totCnt  = MAPPING_2025.length
  const totConf = MAPPING_2025.filter(m => m.status === "확정").length
  const totSend = MAPPING_2025.filter(m => m.send).length

  return (
    <div className="flex flex-col h-full">
      <div className="text-xs text-muted-foreground px-3 pt-3 pb-2 shrink-0">
        전체 {totCnt}항목 · 확정 {totConf} · 전송 {totSend} — 국세청 in-out 정리 진도 (MAPPING_2025 자동 렌더)
      </div>
      {/* 전체 하나의 그리드 — table-fixed + colgroup 으로 그룹이 바뀌어도 열이 같은 위치에서 시작 */}
      <div className="overflow-auto flex-1 px-3 pb-3">
        <table className="w-full border-collapse table-fixed text-xs">
          <colgroup>
            {/* 항목 (고정·truncate) */}
            <col className="w-56" />
            {/* nts코드 */}
            <col className="w-14" />
            {/* nts IN */}
            <col className="w-40" />
            {/* nts OUT */}
            <col className="w-16" />
            {/* yts IN (가변 흡수) */}
            <col />
            {/* yts OUT (가변 흡수) */}
            <col />
            {/* 확정 */}
            <col className="w-12" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-muted">
            <tr className="text-[10px] text-muted-foreground text-left">
              <th className="px-2 py-1.5 border-b border-r font-medium">항목</th>
              <th className="px-2 py-1.5 border-b border-r font-medium">nts코드</th>
              <th className="px-2 py-1.5 border-b border-r font-medium">nts IN</th>
              <th className="px-2 py-1.5 border-b border-r font-medium">nts OUT</th>
              <th className="px-2 py-1.5 border-b border-r font-medium">yts IN</th>
              <th className="px-2 py-1.5 border-b border-r font-medium">yts OUT</th>
              <th className="px-2 py-1.5 border-b font-medium text-center">확정</th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap(g => {
              return [
                <tr key={`h-${g.name}`} className="bg-muted/70 border-y">
                  <td colSpan={7} className="px-2 py-1">
                    <span className="text-sm font-semibold whitespace-nowrap">{g.name}</span>
                  </td>
                </tr>,
                ...statusRowsOf(g.rows, yy).map(r => (
                  <tr key={r.key} className={`border-t ${r.isSubtotal ? "bg-muted/40" : ""}`}>
                    <td className={`px-2 py-1 truncate ${r.isSubtotal ? "pl-4 text-muted-foreground" : ""}`} title={r.label}>{r.label}</td>
                    <td className="px-2 py-1 border-l font-mono text-[11px] font-semibold">{r.code}</td>
                    <td className={`px-2 py-1 border-l font-mono text-[10px] truncate ${r.ntsIn === "—" ? "text-muted-foreground/40" : "text-muted-foreground"}`}>{r.ntsIn}</td>
                    <td className={`px-2 py-1 border-l font-mono text-[10px] ${r.ntsOut === "—" ? "text-muted-foreground/40" : "font-semibold"}`}>{r.ntsOut}</td>
                    <td className={`px-2 py-1 border-l font-mono text-[10px] truncate ${r.ytsIn === "—" ? "text-muted-foreground/40" : "text-muted-foreground"}`} title={r.ytsIn}>{r.ytsIn}</td>
                    <td className={`px-2 py-1 border-l font-mono text-[10px] truncate ${r.ytsOut === "—" ? "text-muted-foreground/40" : "font-semibold"}`} title={r.ytsOut}>{r.ytsOut}</td>
                    <td className="px-2 py-1 border-l text-center whitespace-nowrap"><StatusBadge status={r.status} /></td>
                  </tr>
                )),
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
