"use client"

import { useState, useEffect } from "react"
import { Loader2, Play, CheckCircle2, XCircle, FileSearch } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"

const CURRENT_YEAR = String(new Date().getFullYear())

// NTS 응답 계산흐름 (표시 순서) — lib 은 playwright 를 물고 있어 클라이언트에서 값만 로컬 정의
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

// ── 타입 ────────────────────────────────────────────────────────────────────
interface ListItem {
  calcNo: string; nm: string
  totPayAmt: number; prodTaxAmt: number; resIncmTax: number; effctvTaxRate: number
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
interface RowResult {
  yts: YtsResult | null
  nts: NtsResult
  inputs: InputRow[]
  ntsMap: Record<string, number>
  excluded: { label: string; amount: number }[]
  ranAt: string; duration: number
}

// ── 유틸 ────────────────────────────────────────────────────────────────────
const won   = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString("ko-KR")
const rate  = (n: number | null | undefined) => n == null ? "—" : n.toFixed(1) + "%"
const time  = (ms: number) => (ms / 1000).toFixed(1) + "초"

function MatchIcon({ yts, nts }: { yts: number | null; nts: number | null }) {
  if (nts == null || yts == null) return <span className="text-muted-foreground/30">—</span>
  return yts === nts
    ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
    : <XCircle      className="h-3.5 w-3.5 text-red-500" />
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export function HometaxCalcPanel() {
  const [year,    setYear]    = useState(CURRENT_YEAR)
  const [items,   setItems]   = useState<ListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [running,   setRunning]   = useState<Set<string>>(new Set())
  const [results,   setResults]   = useState<Record<string, RowResult>>({})
  const [detailFor, setDetailFor] = useState<string | null>(null)

  // 연도 변경 시 목록 자동 조회
  useEffect(() => {
    setItems([])
    setResults({})
    setLoading(true)
    fetch(`/api/tools/hometax-calc/list?year=${year}`)
      .then(r => r.json())
      .then(d => setItems(d.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [year])

  async function runCompare(calcNo: string) {
    if (running.has(calcNo)) return
    setRunning(prev => new Set(prev).add(calcNo))
    const start = Date.now()
    try {
      const res  = await fetch("/api/tools/hometax-calc", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ calcNo, mode: "compare" }),
      })
      const json = await res.json()
      setResults(prev => ({
        ...prev,
        [calcNo]: {
          yts:      json.yts ?? null,
          nts:      json.nts ?? { prodTax: null, decidedTax: null, withheld: null, workDdc: null, taxBase: null, resultCode: json.error ? "E" : null },
          inputs:   json.inputs ?? [],
          ntsMap:   json.ntsMap ?? {},
          excluded: json.excluded ?? [],
          ranAt:    new Date().toLocaleTimeString("ko-KR"),
          duration: Date.now() - start,
        },
      }))
    } catch {
      setResults(prev => ({
        ...prev,
        [calcNo]: {
          yts: null,
          nts: { prodTax: null, decidedTax: null, withheld: null, workDdc: null, taxBase: null, resultCode: "E" },
          inputs: [], ntsMap: {}, excluded: [],
          ranAt: new Date().toLocaleTimeString("ko-KR"), duration: Date.now() - start,
        },
      }))
    } finally {
      setRunning(prev => { const s = new Set(prev); s.delete(calcNo); return s })
    }
  }

  const detailRes = detailFor ? results[detailFor] : null
  const detailRow = detailFor ? items.find(i => i.calcNo === detailFor) ?? null : null

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 헤더: 연도 선택 */}
      <div className="shrink-0 flex items-center gap-3 p-4 border-b">
        <span className="text-sm font-medium">연도 선택</span>
        <Select value={year} onValueChange={v => { if (v) setYear(v) }}>
          <SelectTrigger className="w-28 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CURRENT_YEAR}>{CURRENT_YEAR}년</SelectItem>
          </SelectContent>
        </Select>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {!loading && items.length > 0 && (
          <span className="text-xs text-muted-foreground">{items.length}명 조회됨</span>
        )}
      </div>

      {/* 테이블 */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
            <tr className="border-b text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">CALC_NO</th>
              <th className="px-3 py-2 text-left font-medium">이름</th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">총급여</th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">산출세액</th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">실효세율</th>
              <th className="px-3 py-2 text-center font-medium">실행</th>
              {/* 비교 결과 */}
              <th className="px-3 py-2 text-center font-medium whitespace-nowrap" colSpan={2}>산출세액 (YTS/NTS)</th>
              <th className="px-3 py-2 text-center font-medium whitespace-nowrap" colSpan={2}>결정세액 (YTS/NTS)</th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">실행일</th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">소요시간</th>
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
              <tr>
                <td colSpan={13} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {year}년 데이터가 없습니다.
                </td>
              </tr>
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
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        disabled={isRunning}
                        onClick={() => runCompare(row.calcNo)}
                        title="비교실행"
                      >
                        {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        disabled={!res}
                        onClick={() => setDetailFor(row.calcNo)}
                        title="상세조회"
                      >
                        <FileSearch className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                  {/* 산출세액 YTS/NTS */}
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{won(row.prodTaxAmt)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">
                    <span className="flex items-center justify-end gap-1">
                      {res ? won(res.nts.prodTax) : "—"}
                      {res && <MatchIcon yts={row.prodTaxAmt} nts={res.nts.prodTax} />}
                    </span>
                  </td>
                  {/* 결정세액 YTS/NTS */}
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
      </div>

      {/* 상세조회 드로어 */}
      <Sheet open={detailFor !== null} onOpenChange={o => { if (!o) setDetailFor(null) }}>
        <SheetContent
          side="right"
          className="w-full p-0"
          style={{ maxWidth: "min(92vw, 60rem)" }}
        >
          {detailRes && (
            <DetailView res={detailRes} row={detailRow} calcNo={detailFor!} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ── 상세조회 뷰 ──────────────────────────────────────────────────────────────
function DetailView({ res, row, calcNo }: { res: RowResult; row: ListItem | null; calcNo: string }) {
  const yts = res.yts
  const nts = res.nts
  const ok  = nts.resultCode === "S" || nts.resultCode === null

  const compareRows: { label: string; yts: number | null; nts: number | null }[] = [
    { label: "산출세액",   yts: yts?.prodTaxAmt ?? row?.prodTaxAmt ?? null, nts: nts.prodTax },
    { label: "결정세액",   yts: yts?.resIncmTax ?? row?.resIncmTax ?? null, nts: nts.decidedTax },
    { label: "차감징수",   yts: yts?.subIncmTax ?? null,                    nts: nts.withheld },
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
                <th className="py-1.5 text-center font-medium w-10">일치</th>
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

        {/* 3) 전송한 공제 입력 (전체, 0 포함) */}
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
                  const zero = inp.sent === 0
                  const ntsVal = res.ntsMap[inp.code]
                  return (
                    <tr key={inp.code} className={`border-t ${zero ? "text-muted-foreground/40" : "bg-blue-50/30"}`}>
                      <td className="px-2 py-1 font-mono">{inp.code}</td>
                      <td className="px-2 py-1">{inp.label}</td>
                      <td className="px-2 py-1 font-mono text-[10px]">{inp.valueKey}</td>
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
        {res.excluded.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-red-600 mb-2">④ 미전송 항목 (Stage 1 제외 · 차이 원인 후보)</h3>
            <div className="border border-red-200 rounded-md bg-red-50/40 p-3 space-y-1">
              {res.excluded.map(e => (
                <div key={e.label} className="flex justify-between text-xs">
                  <span className="text-red-700">{e.label}</span>
                  <span className="tabular-nums text-red-700">{e.amount.toLocaleString("ko-KR")}</span>
                </div>
              ))}
              <p className="text-[10px] text-red-500/80 pt-1 border-t border-red-200 mt-1">
                이 항목들은 아직 NTS 로 전송하지 않아, 결정세액 차이의 원인일 수 있습니다.
              </p>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
