"use client"

import { useEffect, useState } from "react"

// ─── 타입 ───────────────────────────────────────────────────────────────────
interface Overview {
  total: number; refundCnt: number; extraCnt: number; zeroCnt: number
  exhaustedCnt: number; stdCnt: number; spcCnt: number
  avgRate: number; totalRefund: number; totalExtra: number; avgPay: number
}
interface Insights {
  eligible: number; pensionNone: number; pensionUnder: number; pensionOver: number
  hdcTotal: number; hdcNoIns: number; hometownNone: number
  cardMiss: number; cardHighCredit: number; mediNear: number
}
interface DistItem { RANGE: string; CNT: number }
interface DashData {
  overview: Overview; insights: Insights
  payDist: DistItem[]; rateDist: DistItem[]
}

// ─── 유틸 ───────────────────────────────────────────────────────────────────
const won = (n: number) => Math.round(n).toLocaleString("ko-KR") + "원"
const pct = (n: number, d: number) => d ? (n / d * 100).toFixed(1) + "%" : "0%"

// ─── KPI 카드 ───────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color = "" }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="rounded-xl border bg-card px-5 py-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── 바 차트 ────────────────────────────────────────────────────────────────
function BarChart({ items, total }: { items: DistItem[]; total: number }) {
  const max = Math.max(...items.map(i => i.CNT))
  return (
    <div className="flex flex-col gap-2">
      {items.map(({ RANGE, CNT }) => (
        <div key={RANGE} className="flex items-center gap-3">
          <span className="w-24 text-right text-xs text-muted-foreground shrink-0">{RANGE}</span>
          <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
            <div
              className="h-full bg-primary/70 rounded-full transition-all"
              style={{ width: `${(CNT / max) * 100}%` }}
            />
          </div>
          <span className="w-16 text-xs tabular-nums text-muted-foreground">
            {CNT}명 ({pct(CNT, total)})
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── 절세 기회 행 ───────────────────────────────────────────────────────────
function InsightRow({ label, count, base, desc, urgent = false }: {
  label: string; count: number; base: number; desc: string; urgent?: boolean
}) {
  const ratio = base ? count / base : 0
  return (
    <div className={`rounded-lg border p-3 ${urgent ? "border-amber-200 bg-amber-50" : "bg-card"}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        <span className={`text-sm font-bold tabular-nums ${urgent ? "text-amber-700" : "text-primary"}`}>
          {count}명 <span className="text-xs font-normal text-muted-foreground">/ {base}명 ({pct(count, base)})</span>
        </span>
      </div>
      <div className="w-full bg-muted rounded-full h-1.5 mb-1.5">
        <div
          className={`h-full rounded-full ${urgent ? "bg-amber-400" : "bg-primary/60"}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
  )
}

// ─── 메인 ───────────────────────────────────────────────────────────────────
export default function TaxDashboardPage() {
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/tools/tax-dashboard")
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
      집계 중...
    </div>
  )
  if (!data) return (
    <div className="flex h-full items-center justify-center text-destructive text-sm">
      데이터 조회 실패
    </div>
  )

  const { overview: o, insights: i, payDist, rateDist } = data

  return (
    <div className="flex flex-col gap-5 h-full overflow-y-auto pb-4">
      {/* 헤더 */}
      <div className="shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">연말정산 대시보드</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          2025년 연말정산 전체 현황 및 절세 기회 요약입니다.
        </p>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-6 gap-3 shrink-0">
        <KpiCard label="총 신고 인원" value={`${o.total}명`} />
        <KpiCard label="평균 총급여" value={`${Math.round(o.avgPay / 10000).toLocaleString()}만원`} />
        <KpiCard label="평균 실효세율" value={`${o.avgRate}%`} />
        <KpiCard label="환급 대상" value={`${o.refundCnt}명`}
          sub={`총 ${Math.round(o.totalRefund / 100000000).toFixed(1)}억원`} color="text-blue-600" />
        <KpiCard label="추가납부" value={`${o.extraCnt}명`}
          sub={`총 ${Math.round(o.totalExtra / 100000000).toFixed(1)}억원`} color="text-red-500" />
        <KpiCard label="결정세액 0원" value={`${o.zeroCnt}명`}
          sub={pct(o.zeroCnt, o.total)} />
      </div>

      {/* 중단: 절세 기회 + 분포 */}
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">

        {/* 절세 기회 */}
        <div className="flex flex-col gap-3 overflow-y-auto">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
            절세 기회 — 특별세액공제 + 산출세액 &gt; 0 ({i.eligible}명 기준)
          </h2>

          <InsightRow
            label="장애인전용보험 미가입"
            count={i.hdcNoIns} base={i.hdcTotal}
            desc="장애인 부양가족이 있는 직원 중 장애인전용보험 미가입자. 별도 한도 100만원 × 15% = 최대 15만원 세액공제 가능."
            urgent
          />
          <InsightRow
            label="IRP·연금저축 미납입"
            count={i.pensionNone} base={i.eligible}
            desc="연금계좌를 전혀 활용하지 않는 직원. 총급여 5,500만원 초과 시 최대 108만원, 이하 시 최대 90만원 절감 가능."
            urgent
          />
          <InsightRow
            label="IRP·연금저축 한도 미충족"
            count={i.pensionUnder} base={i.eligible}
            desc="연금계좌를 납입 중이지만 한도(5,500만원 초과: 900만원, 이하: 600만원)를 채우지 못한 직원."
          />
          <InsightRow
            label="신용카드 최저사용금액 미달"
            count={i.cardMiss} base={i.eligible}
            desc="신용카드 등을 사용했지만 총급여의 25%를 넘지 못해 공제를 전혀 받지 못한 직원."
          />
          <InsightRow
            label="신용카드 비중 과다 (체크카드 전환 권장)"
            count={i.cardHighCredit} base={i.eligible}
            desc="신용카드 사용 비중이 50% 초과. 최저사용금액 이후 지출을 체크카드·현금영수증으로 전환하면 공제율 15%→30%."
          />
          <InsightRow
            label="의료비 최저한도 100만원 이내 부족"
            count={i.mediNear} base={i.eligible}
            desc="의료비가 있으나 총급여의 3% 최저한도에 100만원 이내로 부족. 내년에 미보장 비급여 항목까지 꼼꼼히 챙기면 공제 가능."
          />
          <InsightRow
            label="고향사랑기부금 미활용"
            count={i.hometownNone} base={i.eligible}
            desc="10만원 기부 시 세액공제 90,909원 + 답례품(기부액의 30%). 실질 비용 9,091원으로 절세 가능."
          />
        </div>

        {/* 분포 차트 */}
        <div className="flex flex-col gap-4 overflow-y-auto">

          {/* 세액계산 방식 */}
          <div className="rounded-xl border bg-card p-4 shrink-0">
            <h2 className="text-sm font-semibold mb-3">세액계산 방식</h2>
            <div className="flex gap-4 items-center">
              <div className="flex-1">
                <div className="flex rounded-full overflow-hidden h-6">
                  <div
                    className="bg-primary flex items-center justify-center text-xs text-white font-semibold"
                    style={{ width: pct(o.spcCnt, o.total) }}
                  >
                    특별 {pct(o.spcCnt, o.total)}
                  </div>
                  <div
                    className="bg-muted flex items-center justify-center text-xs text-muted-foreground"
                    style={{ width: pct(o.stdCnt, o.total) }}
                  >
                    표준 {pct(o.stdCnt, o.total)}
                  </div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground shrink-0 space-y-0.5">
                <div>특별 {o.spcCnt}명</div>
                <div>표준 {o.stdCnt}명</div>
              </div>
            </div>
          </div>

          {/* 총급여 분포 */}
          <div className="rounded-xl border bg-card p-4 flex-1">
            <h2 className="text-sm font-semibold mb-3">총급여 구간 분포</h2>
            <BarChart items={payDist} total={o.total} />
          </div>

          {/* 실효세율 분포 */}
          <div className="rounded-xl border bg-card p-4 flex-1">
            <h2 className="text-sm font-semibold mb-3">실효세율 분포</h2>
            <BarChart items={rateDist} total={o.total} />
          </div>

        </div>
      </div>
    </div>
  )
}
