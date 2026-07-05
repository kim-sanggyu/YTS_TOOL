"use client"

import { useEffect, useState } from "react"
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select"
import { AVAILABLE_YEARS } from "@/features/tax-insight/constants"

type WorkTarget = 'all' | 'continue' | 'continue-dec' | 'continue-nodec' | 'midleave'
const WORK_LABEL: Record<WorkTarget, string> = {
  all:              '전체',
  continue:         '계속근로',
  'continue-dec':   '계속근로(12개월)',
  'continue-nodec': '계속근로(12개월미만)',
  midleave:         '중도퇴사',
}

// ─── 타입 ───────────────────────────────────────────────────────────────────
interface Overview {
  total: number; refundCnt: number; extraCnt: number; zeroCnt: number
  stdCnt: number; spcCnt: number; avgRate: number
  totalRefund: number; totalExtra: number; avgPay: number
}
interface Anomalies {
  incomeExh: number; taxExh: number
  savingsMember: number; savingsLimit: number
  ralrMiss: number; ralrLenderMiss: number; ralrHabtMiss: number
  cardMiss: number; mediMiss: number
}
interface Insights {
  eligible: number; pensionNone: number; pensionUnder: number
  hdcTotal: number; hdcNoIns: number; hometownNone: number
  cardMiss: number; cardHighCredit: number; mediNear: number
}
interface DashData { overview: Overview; anomalies: Anomalies; insights: Insights }

// ─── 유틸 ───────────────────────────────────────────────────────────────────
const won = (n: number) => Math.round(n).toLocaleString("ko-KR") + "원"
const pct = (n: number | undefined, d: number) => (d && n != null && !isNaN(n)) ? (n / d * 100).toFixed(1) + "%" : "0%"

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

// ─── 특이사항 — 카드 + 고정 열폭 테이블 ────────────────────────────────────
interface CheckItem { title: string; count: number }

function AnomalyGroup({ label, total, eligible, items }: {
  label: string; total: number; eligible: number; items: CheckItem[]
}) {
  return (
    <div className="rounded-lg border border-amber-200 overflow-hidden">
      <table className="w-full border-collapse table-fixed">
        <colgroup>
          <col style={{ width: "9rem" }} />
          <col />
          <col style={{ width: "3rem" }} />
          <col style={{ width: "3rem" }} />
        </colgroup>
        <tbody>
          {items.map(({ title, count }, idx) => (
            <tr key={title} className={idx < items.length - 1 ? "border-b border-amber-100" : ""}>
              {idx === 0 && (
                <td rowSpan={items.length}
                  className="px-3 bg-amber-50 text-sm font-semibold text-amber-900 text-center align-middle border-r border-amber-200">
                  {label}
                </td>
              )}
              <td className="px-3 py-1.5 text-[13px] font-semibold text-gray-800">ㆍ{title}</td>
              <td className="px-2 py-1.5 text-xs font-bold text-right tabular-nums text-gray-600 border-l border-amber-100 whitespace-nowrap">
                {count}명
              </td>
              {idx === 0 && (
                <td rowSpan={items.length}
                  className="px-2 bg-amber-50 text-sm font-bold text-amber-700 text-center align-middle border-l border-amber-200 whitespace-nowrap">
                  {total}명
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AnomalyTable({ eligible, groups }: {
  eligible: number
  groups: { label: string; total: number; items: CheckItem[] }[]
}) {
  return (
    <div className="flex flex-col gap-3">
      {groups.map(g => (
        <AnomalyGroup key={g.label} label={g.label} total={g.total} eligible={eligible} items={g.items} />
      ))}
    </div>
  )
}

// ─── 절세기회 행 ────────────────────────────────────────────────────────────
function InsightRow({ label, count, base, desc, urgent = false }: {
  label: string; count: number; base: number; desc: string; urgent?: boolean
}) {
  const ratio = base ? count / base : 0
  return (
    <div className={`rounded-lg border p-3 ${urgent ? "border-green-200 bg-green-50" : "bg-card"}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        <span className={`text-sm font-bold tabular-nums ${urgent ? "text-green-700" : "text-primary"}`}>
          {count}명 <span className="text-xs font-normal text-muted-foreground">/ {base}명 ({pct(count, base)})</span>
        </span>
      </div>
      <div className="w-full bg-muted rounded-full h-1.5 mb-1.5">
        <div className={`h-full rounded-full ${urgent ? "bg-green-400" : "bg-primary/60"}`}
          style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
  )
}

// ─── 메인 ───────────────────────────────────────────────────────────────────
export default function TaxDashboardPage() {
  const [data, setData]             = useState<DashData | null>(null)
  const [loading, setLoading]       = useState(true)
  const [year, setYear]             = useState(() =>
    (typeof window !== "undefined" && sessionStorage.getItem("tax-dashboard:year"))
      || AVAILABLE_YEARS[AVAILABLE_YEARS.length - 1]
  )
  const [workTarget, setWorkTarget] = useState<WorkTarget>(() =>
    ((typeof window !== "undefined" && sessionStorage.getItem("tax-dashboard:workTarget")) as WorkTarget) || "all"
  )

  useEffect(() => {
    sessionStorage.setItem("tax-dashboard:year", year)
    sessionStorage.setItem("tax-dashboard:workTarget", workTarget)
  }, [year, workTarget])

  useEffect(() => {
    setLoading(true)
    setData(null)
    const params = new URLSearchParams({ year, workTarget })
    fetch(`/api/tools/tax-dashboard?${params}`)
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [year, workTarget])

  if (loading) return <div className="flex h-full items-center justify-center text-muted-foreground text-sm">집계 중...</div>
  if (!data)   return <div className="flex h-full items-center justify-center text-destructive text-sm">데이터 조회 실패</div>

  const { overview: o, anomalies: a, insights: i } = data

  return (
    <div className="flex flex-col gap-5 h-full overflow-y-auto pb-4">
      {/* 헤더 */}
      <div className="shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">연말정산 대시보드</h1>
          <p className="text-muted-foreground mt-1 text-sm">2025년 연말정산 전체 현황입니다.</p>
        </div>
        <div className="flex items-center gap-2">
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
          <Select value={workTarget} onValueChange={v => setWorkTarget(v as WorkTarget)}>
            <SelectTrigger className="w-44 h-8 text-sm">
              <span className="flex-1 text-left truncate">{WORK_LABEL[workTarget]}</span>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(WORK_LABEL) as WorkTarget[]).map(k => (
                <SelectItem key={k} value={k}>{WORK_LABEL[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
        <KpiCard label="결정세액 0원" value={`${o.zeroCnt}명`} sub={pct(o.zeroCnt, o.total)} />
      </div>

      {/* 중단: 특이사항 + 절세기회 */}
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">

        {/* 특이사항 */}
        <div className="flex flex-col gap-3 overflow-y-auto">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
            입력했는데 공제가 0원인 사례 ({o.total}명 기준)
          </h2>
          <AnomalyTable eligible={o.total} groups={[
            {
              label: "표준세액공제 방식", total: o.stdCnt,
              items: [
                { title: "표준방식으로 계산 — 보험료·의료비·교육비·월세 미공제", count: o.stdCnt },
              ],
            },
            {
              label: "소득소진", total: a.incomeExh,
              items: [
                { title: "근로소득 잔액이 0이 됨 — 이후 소득공제 항목 미반영", count: a.incomeExh },
              ],
            },
            {
              label: "세액소진", total: a.taxExh,
              items: [
                { title: "산출세액이 모두 소진됨 — 이후 세액공제 항목 미반영", count: a.taxExh },
              ],
            },
            {
              label: "주택마련저축(세대원)", total: a.savingsMember,
              items: [
                { title: "세대원 — 세대주만 공제 가능", count: a.savingsMember },
              ],
            },
            {
              label: "주택마련저축(400한도)", total: a.savingsLimit,
              items: [
                { title: "400만원 한도 소진 — 주택임차차입금원리금상환액과 합산", count: a.savingsLimit },
              ],
            },
            {
              label: "원리금상환액", total: a.ralrMiss,
              items: [
                { title: "대출기관 납입 있으나 공제 없음", count: a.ralrLenderMiss },
                { title: "거주자 납입 있으나 공제 없음", count: a.ralrHabtMiss },
              ],
            },
            {
              label: "신용카드", total: a.cardMiss,
              items: [
                { title: "최저사용금액(총급여×25%) 미달로 공제 없음", count: a.cardMiss },
              ],
            },
            {
              label: "의료비", total: a.mediMiss,
              items: [
                { title: "최저한도(총급여×3%) 미달로 공제 없음", count: a.mediMiss },
              ],
            },
          ]} />
        </div>

        {/* 절세기회 */}
        <div className="flex flex-col gap-3 overflow-y-auto">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
            절세기회 — 특별세액공제 + 산출세액 &gt; 0 ({i.eligible}명 기준)
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
            desc="신용카드 사용 비중 50% 초과. 최저사용금액 이후 지출을 체크카드·현금영수증으로 전환하면 공제율 15%→30%."
          />
          <InsightRow
            label="의료비 최저한도 100만원 이내 부족"
            count={i.mediNear} base={i.eligible}
            desc="의료비가 있으나 총급여의 3% 최저한도에 100만원 이내로 부족. 내년에 미보장 비급여까지 챙기면 공제 가능."
          />
          <InsightRow
            label="고향사랑기부금 미활용"
            count={i.hometownNone} base={i.eligible}
            desc="10만원 기부 시 세액공제 90,909원 + 답례품(기부액의 30%). 실질 비용 9,091원으로 절세 가능."
          />
        </div>

      </div>
    </div>
  )
}
