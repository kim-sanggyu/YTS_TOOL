"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { RefreshCw, CheckCircle2, XCircle, AlertCircle, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

// ─── 타입 ──────────────────────────────────────────────────────────────────
interface DimStat { matched: number; label: string }

interface RegressionData {
  fromYear: string
  toYear: string
  summary: {
    total: number
    dims: {
      res:    DimStat
      prod:   DimStat
      method: DimStat
      exhpt:  DimStat
    }
  }
  mismatches: Array<{
    calcNo: string; nm: string
    resG: number;  resM: number;  resDiff: number
    prodG: number; prodM: number
    methodG: string; methodM: string
    exhptG: string;  exhptM: string
    totPayG: number; totPayM: number
  }>
  giftIntegrity: {
    rows: Array<{ dataset: string; giftYy: string; cnt: number }>
    dropOk: boolean
  }
}

function fmt(n: number) { return n.toLocaleString("ko-KR") }

// ─── 파이프라인 ────────────────────────────────────────────────────────────
function Pipeline({ fromYear, toYear }: { fromYear: string; toYear: string }) {
  const steps = [
    { label: `${fromYear}년 연말정산 완료`, done: true },
    { label: `${toYear}년 데이터 생성`, done: true, link: "/tools/data-migration" },
    { label: "재계산", done: true },
    { label: "회귀분석", active: true },
  ]
  return (
    <div className="flex items-center gap-1 mb-5 flex-wrap">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border
            ${s.active ? "bg-primary text-primary-foreground border-primary" :
              s.done   ? "bg-green-50 text-green-800 border-green-200" :
                         "bg-muted text-muted-foreground border-border"}`}>
            {s.done && !s.active && <CheckCircle2 className="h-3 w-3" />}
            <span>{s.label}</span>
            {s.link && (
              <Link href={s.link} className="ml-1 underline underline-offset-2 opacity-70 hover:opacity-100">이동</Link>
            )}
          </div>
          {i < steps.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />}
        </div>
      ))}
    </div>
  )
}

// ─── 차원별 일치율 표 ──────────────────────────────────────────────────────
function DimTable({ data }: { data: RegressionData }) {
  const { total, dims } = data.summary
  const rows = [
    { key: "res",    ...dims.res },
    { key: "prod",   ...dims.prod },
    { key: "method", ...dims.method },
    { key: "exhpt",  ...dims.exhpt },
  ]
  const anyMismatch = rows.some(r => r.matched < total)

  return (
    <div className="flex flex-col gap-3">
      <div className={`rounded-lg border px-4 py-3 flex items-start gap-3
        ${!anyMismatch ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"}`}>
        {!anyMismatch
          ? <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
          : <AlertCircle  className="h-5 w-5 text-yellow-600 mt-0.5 shrink-0" />}
        <div>
          <p className={`text-sm font-semibold ${!anyMismatch ? "text-green-800" : "text-yellow-800"}`}>
            {!anyMismatch
              ? `전체 ${fmt(total)}건 4개 차원 모두 완전 일치`
              : `일부 차원에서 불일치 발견 — 불일치 목록 탭에서 상세 확인`}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            골든: Y{data.fromYear} / 비교: X{data.toYear} / 전체 {fmt(total)}건
          </p>
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
              <th className="px-4 py-2 text-left">비교 항목</th>
              <th className="px-4 py-2 text-right">일치</th>
              <th className="px-4 py-2 text-right">불일치</th>
              <th className="px-4 py-2 text-right">일치율</th>
              <th className="px-4 py-2 text-left">판정</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const mismatch = total - r.matched
              const rate = total > 0 ? (r.matched / total * 100) : 0
              const ok = mismatch === 0
              return (
                <tr key={r.key} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-medium">{r.label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-green-700">{fmt(r.matched)}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${ok ? "text-muted-foreground" : "text-red-600"}`}>
                    {mismatch === 0 ? "—" : fmt(mismatch)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{rate.toFixed(3)}%</td>
                  <td className="px-4 py-2.5">
                    {ok
                      ? <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3 w-3" />일치</span>
                      : <span className="flex items-center gap-1 text-xs text-red-600"><XCircle className="h-3 w-3" />불일치</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── 불일치 목록 ────────────────────────────────────────────────────────────
function MismatchTable({ mismatches, fromYear, toYear }: {
  mismatches: RegressionData["mismatches"]
  fromYear: string; toYear: string
}) {
  if (mismatches.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-green-50 border-green-200 px-4 py-3 text-sm text-green-700">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        불일치 없음 — Y{fromYear} 골든과 X{toYear} 결과가 4개 차원 모두 완전히 일치합니다.
      </div>
    )
  }

  return (
    <div className="rounded-lg border overflow-auto">
      <table className="w-full text-sm min-w-[900px]">
        <thead>
          <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
            <th className="px-3 py-2 text-left">CALC_NO</th>
            <th className="px-3 py-2 text-left">성명</th>
            <th className="px-3 py-2 text-center" colSpan={2}>결정세액</th>
            <th className="px-3 py-2 text-center" colSpan={2}>산출세액</th>
            <th className="px-3 py-2 text-center" colSpan={2}>표준/특별</th>
            <th className="px-3 py-2 text-center" colSpan={2}>소진지점</th>
          </tr>
          <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
            <th className="px-3 py-1" /><th className="px-3 py-1" />
            <th className="px-3 py-1 text-right">골든</th><th className="px-3 py-1 text-right">마이그</th>
            <th className="px-3 py-1 text-right">골든</th><th className="px-3 py-1 text-right">마이그</th>
            <th className="px-3 py-1 text-center">골든</th><th className="px-3 py-1 text-center">마이그</th>
            <th className="px-3 py-1 text-center">골든</th><th className="px-3 py-1 text-center">마이그</th>
          </tr>
        </thead>
        <tbody>
          {mismatches.map((r, i) => {
            const resDiff  = r.resG  !== r.resM
            const prodDiff = r.prodG !== r.prodM
            const mthdDiff = r.methodG !== r.methodM
            const exhpDiff = r.exhptG  !== r.exhptM
            const cellDiff = "bg-red-50 text-red-700 font-medium"
            return (
              <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2 font-mono text-xs">{r.calcNo}</td>
                <td className="px-3 py-2">{r.nm}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${resDiff ? cellDiff : ""}`}>{fmt(r.resG)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${resDiff ? cellDiff : ""}`}>{fmt(r.resM)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${prodDiff ? cellDiff : ""}`}>{fmt(r.prodG)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${prodDiff ? cellDiff : ""}`}>{fmt(r.prodM)}</td>
                <td className={`px-3 py-2 text-center ${mthdDiff ? cellDiff : ""}`}>{r.methodG}</td>
                <td className={`px-3 py-2 text-center ${mthdDiff ? cellDiff : ""}`}>{r.methodM}</td>
                <td className={`px-3 py-2 text-center text-xs ${exhpDiff ? cellDiff : ""}`}>{r.exhptG}</td>
                <td className={`px-3 py-2 text-center text-xs ${exhpDiff ? cellDiff : ""}`}>{r.exhptM}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── 기부이월 무결성 ────────────────────────────────────────────────────────
function GiftIntegrityPanel({ giftIntegrity, fromYear, toYear }: {
  giftIntegrity: RegressionData["giftIntegrity"]
  fromYear: string; toYear: string
}) {
  const { rows, dropOk } = giftIntegrity
  const years = [...new Set(rows.map(r => r.giftYy))].sort()

  return (
    <div className="flex flex-col gap-3">
      <div className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border w-fit
        ${dropOk ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700"}`}>
        {dropOk ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
        당해잔여 drop: X{toYear}에 GIFT_YY={fromYear} 행 {dropOk ? "없음 ✓" : "있음 ✗"}
      </div>

      {years.length === 0 ? (
        <p className="text-sm text-muted-foreground">기부이월 데이터 없음</p>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left">기부연도(GIFT_YY)</th>
                <th className="px-3 py-2 text-right">Y{fromYear} 골든</th>
                <th className="px-3 py-2 text-right">X{toYear} 마이그</th>
                <th className="px-3 py-2 text-left">판정</th>
              </tr>
            </thead>
            <tbody>
              {years.map(yy => {
                const g = rows.find(r => r.dataset === "golden" && r.giftYy === yy)
                const m = rows.find(r => r.dataset === "migr"   && r.giftYy === yy)
                const isCurrent = yy === fromYear
                const ok = isCurrent ? !m : (g?.cnt ?? 0) === (m?.cnt ?? 0)
                return (
                  <tr key={yy} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono">{yy}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{g ? fmt(g.cnt) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m ? fmt(m.cnt) : "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {isCurrent ? (
                        ok ? <span className="text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />drop 완료</span>
                           : <span className="text-red-600 flex items-center gap-1"><XCircle className="h-3 w-3" />drop 미완</span>
                      ) : (
                        ok ? <span className="text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />보존</span>
                           : <span className="text-red-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" />건수 불일치</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── 메인 페이지 ───────────────────────────────────────────────────────────
type Tab = "summary" | "mismatch" | "gift"

export default function TaxRegressionPage() {
  const fromYear = String(new Date().getFullYear() - 1)
  const toYear   = String(new Date().getFullYear())

  const [tab,     setTab]     = useState<Tab>("summary")
  const [data,    setData]    = useState<RegressionData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/tools/tax-regression?fromYear=${fromYear}&toYear=${toYear}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d) })
      .catch(() => setError("조회 실패"))
      .finally(() => setLoading(false))
  }, [fromYear, toYear])

  useEffect(() => { load() }, [load])

  const mismatchCount = data?.mismatches.length ?? 0

  const tabs: { id: Tab; label: string }[] = [
    { id: "summary",  label: "일치율 요약" },
    { id: "mismatch", label: `불일치 목록${data ? ` (${mismatchCount}건)` : ""}` },
    { id: "gift",     label: "기부이월 무결성" },
  ]

  // 헤더 카드: 결정세액 기준 (메인 지표)
  const resDim   = data?.summary.dims.res
  const total    = data?.summary.total ?? 0
  const resMatch = resDim?.matched ?? 0
  const resRate  = total > 0 ? (resMatch / total * 100) : 0

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">세액계산 회귀검증</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Y{fromYear} 골든 데이터와 X{toYear} 재계산 결과를 비교하여 세액계산 엔진 무결성을 확인합니다.
            </p>
          </div>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "조회 중..." : "새로고침"}
          </Button>
        </div>
      </div>

      <Pipeline fromYear={fromYear} toYear={toYear} />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <XCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      {!data && !error && (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {loading ? "DB 조회 중..." : "데이터 없음"}
        </div>
      )}

      {data && (
        <>
          {/* 요약 카드 */}
          <div className="shrink-0 grid grid-cols-4 gap-3 mb-5">
            <div className="rounded-lg border bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">비교 대상</p>
              <p className="text-lg font-bold mt-0.5">{fmt(total)}건</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Y{fromYear} ↔ X{toYear}</p>
            </div>
            <div className={`rounded-lg border px-4 py-3 ${resRate === 100 ? "bg-green-50 border-green-200" : resRate >= 99 ? "bg-yellow-50 border-yellow-200" : "bg-red-50 border-red-200"}`}>
              <p className="text-xs text-muted-foreground">결정세액 일치율</p>
              <p className={`text-lg font-bold mt-0.5 ${resRate === 100 ? "text-green-700" : resRate >= 99 ? "text-yellow-700" : "text-red-700"}`}>
                {resRate.toFixed(3)}%
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">주요 지표</p>
            </div>
            <div className="rounded-lg border bg-green-50 border-green-200 px-4 py-3">
              <p className="text-xs text-muted-foreground">결정세액 일치</p>
              <p className="text-lg font-bold mt-0.5 text-green-700">{fmt(resMatch)}건</p>
            </div>
            <div className={`rounded-lg border px-4 py-3 ${mismatchCount === 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
              <p className="text-xs text-muted-foreground">전체 불일치 (4차원)</p>
              <p className={`text-lg font-bold mt-0.5 ${mismatchCount === 0 ? "text-green-700" : "text-red-700"}`}>
                {mismatchCount === 0 ? "없음" : `${fmt(mismatchCount)}건`}
              </p>
            </div>
          </div>

          {/* 탭 */}
          <div className="shrink-0 flex gap-0 border-b mb-4">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors
                  ${tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {tab === "summary"  && <DimTable data={data} />}
            {tab === "mismatch" && <MismatchTable mismatches={data.mismatches} fromYear={fromYear} toYear={toYear} />}
            {tab === "gift"     && <GiftIntegrityPanel giftIntegrity={data.giftIntegrity} fromYear={fromYear} toYear={toYear} />}
          </div>
        </>
      )}
    </div>
  )
}
