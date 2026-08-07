"use client"

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useTransition, memo, createContext, useContext, Fragment, type ReactNode } from "react"
import { Loader2, Play, CheckCircle2, XCircle, FileSearch, FileText, ChevronDown, Maximize2, Minimize2, Wifi } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { CARD_SUBTOTAL_CODE } from "@/features/hometax-calc/mapping/card"
import { MEDI_SUBTOTAL_CODE } from "@/features/hometax-calc/mapping/medi"
import { type MappingRow, type Coverage } from "@/features/hometax-calc/mapping/2025"
import { coverageOf } from "@/features/hometax-calc/mapping/engine"
import { checkMappingConsistency, type ConsistencyResult } from "@/features/hometax-calc/mapping/consistency"
import { availableYears, getYearConfig } from "@/features/hometax-calc/mapping/registry"
import { GIFT_CARRY_BASE, GIFT_CODES, giftSourceOf } from "@/features/hometax-calc/mapping/gift"
import { PROC_ROW_RE, procCodeOrder } from "@/features/hometax-calc/lib/procOrder"
import { sortItems, type SortState } from "@/features/hometax-calc/lib/sortItems"
import { outCodeOf, SUBTOTAL_CODES, makeYearVerdict, type YearVerdict, type RelationType } from "@/features/hometax-calc/lib/ddcVerdict"
import type { NtsIoRow } from "@/features/hometax-calc/lib/runHometaxCalc"

// 연도별 판정 인스턴스(makeYearVerdict) 컨텍스트 — 리스트 Table·드로어가 드롭다운 연도의 판정기를 공유.
//   HometaxCalcPanel 이 ntsYear 로 인스턴스를 만들어 Provider 로 공급, 하위(Table·DetailView)는 useYearVerdict() 로 받는다.
interface YearCtxValue { verdict: YearVerdict; codeLabel: Record<string, string> }
const YearVerdictContext = createContext<YearCtxValue | null>(null)
function useYearCtx(): YearCtxValue {
  const v = useContext(YearVerdictContext)
  if (!v) throw new Error("YearVerdictContext 밖에서 호출")
  return v
}
function useYearVerdict(): YearVerdict { return useYearCtx().verdict }
function useCodeLabel(): Record<string, string> { return useYearCtx().codeLabel }

const NTS_SELECTABLE = ["2026", "2025"]   // 국세청 모의계산 연도 드롭다운(중심축). 앞이 기본선택 — 최신연도(2026) 우선.
const NTS_AVAILABLE  = availableYears()   // 실제 제공되는(=registry 등록된) 연도 — 단일원천. 미등록 연도는 "아직 없음" 안내.

// 인적+연금공제 NTS 대조 코드 — 개별 인적(본인8001·배우자8002·부양가족통합8003·경로8101·장애8102·부녀자8103·한부모8104) + 연금보험료계8919.
//   YTS 인적+연금(WORK_AMT−SPCL_SUB_AMT_SUM−BIA_AMT)과 같은 양을 NTS가 직접 계산한 값(부양가족은 8003 통합 회신, 연금은 8919 소계).
const PERS_PEN_CODES = ["8001", "8002", "8003", "8101", "8102", "8103", "8104", "8919"]

const NTS_FLOW: { code: string; label: string }[] = [
  { code: "8900", label: "총급여" },
  { code: "8901", label: "근로소득공제" },
  { code: "8902", label: "근로소득금액" },
  { code: "8903", label: "종합소득 과세표준" },
  { code: "8990", label: "산출세액" },
  { code: "8700", label: "근로소득세액공제" },
  { code: "8999", label: "결정세액" },
]


// NTS 코드 → 라벨 (실행과정 IN/OUT 전체표 항목명). 매핑 + 계산흐름코드에서 파생.
//   연도별 매핑으로 생성 → Context codeLabel 로 공급(드롭다운 연도 따라감).
function makeCodeLabel(mapping: MappingRow[]): Record<string, string> {
  const m: Record<string, string> = {}
  for (const row of mapping) if (!m[row.ntsCode]) m[row.ntsCode] = row.label
  for (const f of NTS_FLOW) if (!m[f.code]) m[f.code] = f.label
  return m
}

// 기타 탭 항목 카탈로그 — 매핑 tab:"기타"(send·resultCol) 에서 파생(etcList.ETC_ROWS 와 동일 필터).
// 기타 탭은 이 목록으로 드롭다운을 채우고, 선택된 한 항목만 본문 리스트로 필터링한다.
// 기타 드롭다운 = 그룹 항목(여러 코드 묶음) + 단일코드 항목(매핑 tab:"기타") 순.
// 그룹 = 여러 코드를 한 표에 묶어 대조하는 뷰(PersonalTable 공용). listQs=목록조회 / batchEndpoint=전체실행.
const ETC_GROUPS: Record<string, { label: string; listQs: string; batchEndpoint: string }> = {
  PERSONAL:      { label: "인적공제", listQs: "type=personal&group=income", batchEndpoint: "personal-batch?group=income" },  // 배우자·부양가족·추가공제
  FAMILY_CREDIT: { label: "혼인자녀출산", listQs: "type=personal&group=credit", batchEndpoint: "personal-batch?group=credit" },  // 혼인·자녀·출산입양
  HOUSING:       { label: "주택자금",     listQs: "type=housing",               batchEndpoint: "housing-batch" },                // 원리금·장기주택저당(한도 대조)
  HOUSING_SAVINGS: { label: "주택마련저축", listQs: "type=housingsavings",        batchEndpoint: "housingsavings-batch" },         // 청약저축·주택청약종합·근로자주택마련(×40%)
  INVESTMENT:      { label: "투자조합출자", listQs: "type=investment",            batchEndpoint: "investment-batch" },            // 3연도×3종류(벤처100/70/30%·조합10%)
  OTHER_INCOME:    { label: "그밖의소득공제", listQs: "type=otherincome",          batchEndpoint: "otherincome-batch" },           // 우리사주(8452)·장기집합(8451)·청년형(8501)·고용유지(8453)
  ETC_CREDIT:      { label: "기타세액공제",   listQs: "type=etccredit",             batchEndpoint: "etccredit-batch" },             // 외국납부(8751)·주택차입금이자(8752)·납세조합(8753)
  TAX_CUT:         { label: "세액감면",       listQs: "type=taxcut",                batchEndpoint: "cut-batch" },                   // 소득세법(8601)·조특법30조(8607/8608)·조특법30조제외·조세조약(8606)
  INSURANCE:       { label: "보장성보험료",   listQs: "type=insurance",             batchEndpoint: "insurance-batch" },             // 보장성(8710, 12%)·장애인전용 보장성(8711, 15%)
  EDUCATION:       { label: "교육비",         listQs: "type=education",             batchEndpoint: "education-batch" },             // 소계형(8735, ×15%) — SPCL_EDU_AMT 총액↔RT_EDU_AMT
}
// disabled = 표시만 하고 선택 불가(비교할 게 없는 항목). 연금보험료는 전액공제라 OUT=IN 이라 대조 무의미 → 안내용.
// 표시 순서 상규님 지정: 인적공제>연금>건강고용>주택자금>개인연금저축(8401)>혼인자녀출산, 나머지 단일코드(월세액 등)는 뒤에.
// 그밖의소득공제 그룹(OTHER_INCOME)으로 묶는 코드 — 개별 단일항목 목록에선 제외.
const OTHER_INCOME_CODES = ["8451", "8452", "8453", "8501"]
// 기타 탭 드롭다운 항목(그룹 + 단일코드) — 연도별 매핑에서 파생. 단일코드 목록(tab:"기타" send·resultCol)만 연도 의존.
function makeEtcTabItems(mapping: MappingRow[]): { code: string; label: string; disabled?: boolean }[] {
  const single = mapping
    .filter(m => m.tab === "기타" && m.send && m.resultCol && !OTHER_INCOME_CODES.includes(m.ntsCode))
    .map(m => ({ code: m.ntsCode, label: m.label }))
  return [
    { code: "PERSONAL",      label: ETC_GROUPS.PERSONAL.label },
    { code: "PENSION_INS",   label: "연금보험료",      disabled: true },
    { code: "SPECIAL_INS",   label: "건강고용보험료",  disabled: true },
    { code: "HOUSING",       label: ETC_GROUPS.HOUSING.label },
    ...single.filter(i => i.code === "8401" || i.code === "8402"),   // 주택자금 아래: 개인연금저축 > 소기업소상공인
    { code: "HOUSING_SAVINGS", label: ETC_GROUPS.HOUSING_SAVINGS.label },       // 소기업소상공인 아래: 주택마련저축(그룹)
    { code: "INVESTMENT",      label: ETC_GROUPS.INVESTMENT.label },            // 주택마련저축 아래: 투자조합출자(그룹)
    { code: "OTHER_INCOME",    label: ETC_GROUPS.OTHER_INCOME.label },          // 투자조합출자 아래: 그밖의소득공제(그룹)
    { code: "TAX_CUT",         label: ETC_GROUPS.TAX_CUT.label },               // 그밖의소득공제 아래: 세액감면(그룹)
    { code: "FAMILY_CREDIT", label: ETC_GROUPS.FAMILY_CREDIT.label },
    { code: "INSURANCE",     label: ETC_GROUPS.INSURANCE.label },             // 혼인자녀출산 아래: 보장성보험료(그룹)
    { code: "EDUCATION",     label: ETC_GROUPS.EDUCATION.label },             // 보장성보험료 아래: 교육비(그룹)
    { code: "ETC_CREDIT",    label: ETC_GROUPS.ETC_CREDIT.label },            // 혼인자녀출산 아래: 기타세액공제(그룹)
    ...single.filter(i => i.code !== "8401" && i.code !== "8402"),   // 나머지 단일코드(월세액 등)
  ]
}
// 기타 탭 그룹(ETC_GROUPS)의 구성 항목 — 검색키(listQs)에 실제 연결된 코드만.
//   그밖의소득공제 group 은 국세청 대분류라 광범(개인연금·주택마련·투자조합 포함) → OTHER_INCOME 은 OTHER_INCOME_CODES 로 좁힌다.
//   기타세액공제는 group="기타세액공제" 가 정확히 3개(8751/8752/8753)라 group 파생.
function etcGroupMembers(etcCode: string, mapping: MappingRow[]): { code: string; label: string }[] {
  const codes = etcCode === "OTHER_INCOME" ? OTHER_INCOME_CODES
              : etcCode === "ETC_CREDIT"   ? mapping.filter(m => m.group === "기타세액공제").map(m => m.ntsCode)
              : []
  return codes.map(c => { const m = mapping.find(x => x.ntsCode === c); return { code: c, label: m?.label ?? c } })
}

// ── 타입 ─────────────────────────────────────────────────────────────────────
interface ListItem {
  calcNo: string; nm: string
  totPayAmt: number; prodTaxAmt: number; resIncmTax: number; effctvTaxRate: number
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  exhausted?: boolean; exhaustLabel?: string | null
  // 중간 계(YTS) — NTS 대조로 단계별 차이 진단. NTS 코드: 특별8920·그밖의8921·감면계8924·세액공제계8923
  //   인적+연금공제 = 근로소득금액−특별−차감소득(WORK_AMT−SPCL_SUB_AMT_SUM−BIA_AMT). NTS 대조=PERS_PEN_CODES 합
  spclSubSum?: number; otoSum?: number; persPen?: number; taxCut?: number; rtSum?: number
}
// 상세조회 드로어(DetailView)가 실제로 쓰는 최소 필드 — all탭 외 다른 탭(기부금/카드/의료비/연금/기타)
// 리스트 아이템도 전부 이 필드는 갖고 있어서, 어느 탭에서 열든 계산과정·이름을 채울 수 있다.
interface DetailRowLike {
  nm: string; totPayAmt: number; calcProcTotal: string | null
  hasProc?: boolean   // 목록이 계산과정 텍스트를 lazy로 두는 탭(카드)에서 존재여부만 표시
  prodTaxAmt?: number; resIncmTax?: number
}
interface GiftLine {
  code: string | null   // NTS amtClusCd (없으면 미매핑)
  giftCls: string; label: string; giftYy: string
  ytsSub: number        // YTS 세액공제 (GIFT_SUB_AMT)
  ableSub: number       // 공제대상금액 (전송값, GIFT_ABLE_SUB_AMT)
  carried: boolean      // 이월 기부금(당해=false, 이월=true) — amber 색상 구분
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
    // 아이콘 버튼(h-6)과 동일한 높이의 플렉스 래퍼로 감싸 세로 중앙을 맞춘다(계산 아이콘과 정렬 일치)
    <span
      className="inline-flex h-6 items-center align-middle"
      title="산출세액이 앞 항목에서 소진되어 이 항목 공제가 0으로 처리됨 — YTS·NTS 차이의 원인일 수 있음"
    >
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-700 whitespace-nowrap">
        {item.exhaustLabel ?? "세액소진"}
      </span>
    </span>
  )
}

// 본행에 삽입하는 person 정보(사번/표준·특별/계속·퇴사/계산과정) 4칸 — 사람 단위 값이라 본행에 한 번만 표시
interface PersonInfo extends Exhaustable {
  calcNo: string; nm: string
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  hasProc?: boolean   // 목록이 계산과정 텍스트를 lazy로 두는 탭(카드)에서 존재여부만 표시
}
function PersonMainCells({ item, onShowProc }: {
  item: PersonInfo
  onShowProc: (info: { calcNo: string; nm: string; text: string | null }) => void
}) {
  // 계산과정 텍스트가 목록에 실려오면(대부분 탭) 그대로, lazy 탭(카드)은 hasProc로 존재여부 판단.
  const hasProc = item.calcProcTotal != null || !!item.hasProc
  return (
    <>
      <td className={`px-3 py-2 text-left ${item.calcType === "표준" ? "text-blue-600" : "text-muted-foreground"}`}>{item.calcType}</td>
      <td className={`px-3 py-2 text-left ${item.workStatus === "중도퇴사" ? "text-green-600" : "text-muted-foreground"}`}>{item.workStatus}</td>
      <td className="px-1 py-2 text-center">
        <Button
          size="sm" variant="ghost" className="h-6 w-6 p-0"
          disabled={!hasProc}
          title="계산과정" aria-label="계산과정"
          onClick={() => hasProc && onShowProc({ calcNo: item.calcNo, nm: item.nm, text: item.calcProcTotal })}
        >
          <FileText className="h-4 w-4" />
        </Button>
      </td>
      <td className="pl-0.5 pr-1 py-2 text-left"><ExhaustBadge item={item} /></td>
    </>
  )
}

// ── 계산과정(CALC_PROC_TOTAL) 전체 텍스트 드로어 ─────────────────────────────
// 파싱·순서 도출은 lib/procOrder(테스트 잠금 대상). 라벨→코드 단일 원천은 mapping/2025.
// 계산과정 한 줄의 대조 색: 매핑코드의 YTS 공제금액 ↔ NTS ntsMap[code]. 불일치=적, 일치=청, 그 외 무색.
function procLineClass(line: string, procLabelCode: Record<string, string>, ntsMap?: Record<string, number>): string {
  if (!ntsMap) return ""
  const m = PROC_ROW_RE.exec(line)
  if (!m) return ""
  const code = procLabelCode[m[2].trim()]
  if (!code || ntsMap[code] == null) return ""
  const ytsAmt = Number(m[1].replace(/,/g, ""))
  const ntsAmt = ntsMap[code]
  if (!ytsAmt && !ntsAmt) return ""
  return ytsAmt === ntsAmt ? "text-blue-600" : "text-red-600 font-semibold"
}

function ProcTotalView({ info, ntsMap, ntsYear }: { info: { calcNo: string; nm: string; text: string }; ntsMap?: Record<string, number>; ntsYear: string }) {
  const { procLabelCode } = getYearConfig(ntsYear)   // 계산과정 라벨→코드 매핑을 드롭다운 연도로 라우팅
  const lines = info.text.split("\n")
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="border-b px-4 py-3 pr-12 shrink-0">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="font-mono text-sm">{info.calcNo}</span>
          <span className="text-foreground">{info.nm}</span>
          <span className="text-muted-foreground text-sm font-normal">계산과정</span>
          {ntsMap && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
              <span className="text-red-600">■</span>불일치 <span className="text-blue-600">■</span>일치
            </span>
          )}
        </div>
      </div>
      <div
        className="flex-1 min-h-0 overflow-auto px-4 py-3 text-xs leading-relaxed"
        style={{ fontFamily: "'D2Coding', 'GulimChe', '굴림체', monospace" }}
      >
        {lines.map((line, i) => (
          <div key={i} className={`whitespace-pre ${procLineClass(line, procLabelCode, ntsMap)}`}>{line || " "}</div>
        ))}
      </div>
    </div>
  )
}
interface MediLine {
  code: string          // NTS amtClusCd (전송 코드)
  label: string         // 본인·65세·장애인 / 그밖 / 난임 / 미숙아
  useAmt: number        // 전송 지출금액 (CALC_PROC_MEDI 대상자별)
  selfAmt: number       // 검증도구 자체집계 (원천 FMLY_DTL 독립 재집계) — 대조a
}
interface MediListItem {
  calcNo: string; nm: string; totPayAmt: number
  mediDdc: number       // YTS 의료비 세액공제 (=RT_MEDI_AMT, 비교 기준)
  exhausted?: boolean; exhaustLabel?: string | null
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  selfAggMismatch: boolean   // 자체집계 vs CALC_PROC 불일치(목록 배지용)
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
  ytsInput?: number     // 전송 사용액(납입액 등) — 주택마련저축 등 일부 그룹만
  birthBreakdown?: string  // 출산입양(8761) 전송 사용액을 순번별로("첫째 1·둘째 1"). 있으면 ytsInput 대신 표시
}
interface PersonalListItem {
  calcNo: string; nm: string; totPayAmt: number
  exhausted?: boolean; exhaustLabel?: string | null
  empNo: string; calcType: string; workStatus: string; calcProcTotal: string | null
  lines: PersonalLine[]
}
interface NtsResult {
  prodTax: number | null; decidedTax: number | null
  workDdc: number | null; taxBase: number | null; resultCode: string | null
}
interface YtsResult {
  totPayAmt: number; workTax: number; workAmt: number; taxBase: number
  prodTaxAmt: number; wiaCredit: number; resIncmTax: number
  taxCut: number; rtSum: number   // 세액감면 계(TAX_CUT)·세액공제 계(RT_SUM)
}
interface InputRow {
  code: string; label: string; group: string; ytsCol: string | null; valueKey: string; sent: number; outCode?: string
}
interface MissingRow { code: string; label: string; amount: number }
interface RowResult {
  yts: YtsResult | null
  nts: NtsResult
  inputs: InputRow[]
  ntsMap: Record<string, number>
  ntsIn: NtsIoRow[]
  ntsOut: NtsIoRow[]
  ytsDdcMap: Record<string, number>
  missing: MissingRow[]
  ranAt: string; duration: number
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────
const won  = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString("ko-KR")
const time = (ms: number) => (ms / 1000).toFixed(1) + "초"
// 오류 행 = 국세청 계산 실패/성공외 응답 (성공 "S"·미실행 null 외의 resultCode). 세션만료·차단·예외 등.
const isErrorRow = (res: RowResult | undefined) => !!res && res.nts.resultCode != null && res.nts.resultCode !== "S"
// 비교 본행 배경색(모든 비교탭 공통 — 색은 여기 한 곳에서만 바꾼다):
//   선택(클릭)=파랑 최우선 > 오류=주황 > 그 외(일치·불일치·미실행) 무색. 일치·불일치는 ✓/✗ 아이콘·차이 컬럼으로 구분.
const rowBg = (res: RowResult | undefined, selected: boolean) =>
  selected ? "bg-blue-100 hover:bg-blue-200" : isErrorRow(res) ? "bg-amber-200/70 hover:bg-amber-300" : "hover:bg-gray-200"

// ── 목록 열 정렬 (공통) — 헤더 클릭으로 오름/내림 토글. 정렬 로직은 sortItems(클라/서버 공통 원천, 화면↔배치 순서 일치).
//    정렬 상태는 상위(HometaxCalcPanel)가 관리(controlled) — 전체실행이 현재 화면 정렬순을 배치에 전달하기 위함.
function useSortedList<T>(items: T[], sort: SortState | null, setSort: (s: SortState | null) => void): { sorted: T[]; sort: SortState | null; onSort: (k: string) => void } {
  const sorted = sortItems(items, sort)
  const onSort = (k: string) => setSort(sort?.key === k ? { key: k, dir: sort.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" })
  return { sorted, sort, onSort }
}
// 정렬 가능한 헤더 셀 — 활성 열에 ▲/▼ 표시.
function SortableTh({ label, k, sort, onSort, className = "" }: {
  label: string; k: string; sort: SortState | null; onSort: (k: string) => void; className?: string
}) {
  const active = sort?.key === k
  return (
    <th className={`px-3 py-2 font-medium whitespace-nowrap cursor-pointer select-none hover:text-foreground ${className}`} onClick={() => onSort(k)}>
      <span className="inline-flex items-center gap-0.5">{label}<span className="text-[9px] w-2 text-primary">{active ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span></span>
    </th>
  )
}

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

// 본행 그룹 헤더 = 라벨 + 항목수만큼 점(●). 검증정보는 세부행이 담당, 본행은 개수만 시각화(N항목 텍스트 대신).
function GroupHeader({ label, n }: { label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={`${n}항목`}>
      {label}
      <span className="inline-flex items-center gap-1">
        {Array.from({ length: n }).map((_, i) => (
          <span key={i} className="inline-block h-2.5 w-2.5 rounded-full bg-amber-300" />
        ))}
      </span>
    </span>
  )
}

// ── 리스트↔드로어 모순 표시 ─────────────────────────────────────────────────
// 드로어 ③표에서 ✗ 인데 리스트 라인에 없던 코드(hiddenDiffCodes)를 리스트에 강제 노출.
//   ★도구 존재이유: 오류가 어느 화면에서든 반드시 눈에 띄어야 사람이 발견한다(상규님 2026-07-28).
// 본행 배지 — 그 사람의 숨은 불일치 개수.
function HiddenBadge({ n }: { n: number }) {
  return (
    <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white"
          title="드로어 ③표엔 ✗ 인데 목록 세부행엔 없던 불일치 — 아래 경고행 참고">
      숨은 불일치 {n}
    </span>
  )
}
// 세부행과 같은 컬럼 배치의 경고행. 테이블마다 컬럼이 달라 span 을 파라미터로:
//   leftSpan=좌측 병합 열수 · labelSpan=항목열 칸수(gift=2 항목+연도, 그 외=1) · hasInput=입력열 유무 · rightSpan=우측 병합.
//   합계(leftSpan + labelSpan + (hasInput?5:4) + rightSpan)가 그 테이블 총 열수와 같아야 정렬이 맞는다.
function HiddenDiffRow({ code, res, leftSpan, labelSpan = 1, hasInput = true, rightSpan = 2 }:
  { code: string; res: RowResult; leftSpan: number; labelSpan?: number; hasInput?: boolean; rightSpan?: number }) {
  const codeLabel = useCodeLabel()
  const nts = res.ntsMap[code] ?? 0
  const yts = res.ytsDdcMap[code]
  const label = codeLabel[code] ?? SUBTOTAL_CODES.get(code)?.label ?? "국세청 코드"
  return (
    <tr className="border-b border-red-200 bg-red-50 text-xs">
      <td colSpan={leftSpan} />
      <td className="px-3 py-1 whitespace-nowrap font-semibold text-red-700" colSpan={labelSpan}>⚠ [{code}] {label} — 목록에 없음</td>
      {hasInput && <td className="px-3 py-1 text-right tabular-nums text-red-700">—</td>}
      <td className="px-3 py-1 text-right tabular-nums text-red-700">{yts != null ? won(yts) : "—"}</td>
      <td className="px-3 py-1 text-right tabular-nums text-red-700">{won(nts)}</td>
      <td className="px-3 py-1 text-center"><XCircle className="inline h-3.5 w-3.5 text-red-500" /></td>
      <td className="px-3 py-1 text-right tabular-nums font-medium text-red-600">{won(nts - (yts ?? 0))}</td>
      <td colSpan={rightSpan} />
    </tr>
  )
}

// ranAt 미지정 시 현재시각(라이브 실행). 캐시 복원 시엔 원래 실행시각 표시문자열을 넘긴다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildRowResult(json: any, duration: number, ranAt?: string): RowResult {
  return {
    yts:      json.yts     ?? null,
    nts:      json.nts     ?? { prodTax: null, decidedTax: null, workDdc: null, taxBase: null, resultCode: json.error ? "E" : null },
    inputs:   json.inputs  ?? [],
    ntsMap:   json.ntsMap  ?? {},
    ntsIn:    json.ntsIn   ?? [],
    ntsOut:   json.ntsOut  ?? [],
    ytsDdcMap: json.ytsDdcMap ?? {},
    missing:  json.missing ?? [],
    ranAt:    ranAt ?? formatRanAt(new Date()),
    duration,
  }
}

function errorRowResult(duration: number, ranAt?: string): RowResult {
  return {
    yts: null,
    nts: { prodTax: null, decidedTax: null, workDdc: null, taxBase: null, resultCode: "E" },
    inputs: [], ntsMap: {}, ntsIn: [], ntsOut: [], ytsDdcMap: {}, missing: [],
    ranAt: ranAt ?? formatRanAt(new Date()), duration,
  }
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export function HometaxCalcPanel() {
  const [ntsYear,        setNtsYear]        = useState(NTS_SELECTABLE[0])       // 국세청 모의계산 귀속연도 (중심축)
  const [year,           setYear]           = useState(NTS_SELECTABLE[0])       // YTS 데이터 연도 = 국세청 연도에 자동 연동(항상 동일, 수정 불가)
  const ntsAvailable = NTS_AVAILABLE.includes(ntsYear)                          // 국세청 모의계산 제공 연도 여부
  // 연도 파생물 — 드롭다운 연도(ntsYear)의 매핑에서 판정 인스턴스·코드라벨·기타탭 항목을 생성.
  //   verdict/codeLabel 은 Provider 로 하위(Table·드로어)에 공유, etcTabItems 는 이 컴포넌트 내부 소비.
  const cfg = useMemo(() => getYearConfig(ntsYear), [ntsYear])
  const verdict = useMemo(() => makeYearVerdict(cfg.mapping), [cfg])
  const codeLabel = useMemo(() => makeCodeLabel(cfg.mapping), [cfg])
  const etcTabItems = useMemo(() => makeEtcTabItems(cfg.mapping), [cfg])
  type Tab = "all" | "gift" | "card" | "medi" | "pension" | "etc"   // 맵현황은 팝업(/hometax-calc-map)으로 분리 — 탭 아님
  const [tab,            setTab]            = useState<Tab>("all")   // 콘텐츠 구동(무거운 렌더) — 전환은 백그라운드
  const [selectedTab,    setSelectedTab]   = useState<Tab>("all")   // 탭 하이라이트 전용 — 클릭 즉시 반영(체감 반응성)
  const [isTabPending,   startTabTransition] = useTransition()
  // 탭 클릭: 하이라이트(색)는 즉시, 무거운 목록 렌더는 transition으로 미뤄 클릭 반응이 막히지 않게 한다.
  const selectTab = (t: Tab) => {
    if (t === selectedTab) {
      // 같은 탭 재클릭 = 새로고침: 캐시 가드를 무효화해 YTS 목록 재조회 + NTS 결과 캐시 재읽기(기존 행 덮어쓰기) 유도.
      listLoaded.current.delete(`${tab}|${year}|${ntsYear}`)   // 현재 탭 목록 재조회
      cacheLoadedKey.current = null                            // NTS 결과 캐시 재읽기
      overwriteCacheRef.current = true                         // 재읽기 시 기존 행도 최신 캐시값으로 교체
      setIoDetail({})                                          // 드로어 IN/OUT 캐시도 무효화 → 최신 재조회
      setRefreshNonce(n => n + 1)
      return
    }
    setSelectedTab(t)
    startTabTransition(() => setTab(t))
  }
  const [allItems,       setAllItems]       = useState<ListItem[]>([])
  const [giftItems,      setGiftItems]      = useState<GiftListItem[]>([])
  const [cardItems,      setCardItems]      = useState<CardListItem[]>([])
  const [mediItems,      setMediItems]      = useState<MediListItem[]>([])
  const [pensionItems,   setPensionItems]   = useState<PensionListItem[]>([])
  const [etcItems,       setEtcItems]       = useState<EtcListItem[]>([])
  const [groupItems,  setGroupItems]  = useState<PersonalListItem[]>([])   // 기타>인적공제 그룹
  const [groupLoading, setGroupLoading] = useState(false)                  // 그룹 데이터 전용 로딩 — 목록 loading(effect1)과 별도 fetch(effect2)라 빈-메시지 깜빡임 방지
  const [etcCode,        setEtcCode]        = useState<string>(() => makeEtcTabItems(getYearConfig(NTS_SELECTABLE[0]).mapping)[0]?.code ?? "")   // 기타 탭에서 선택된 항목(드롭다운). 초기값=기본연도 첫 항목
  const [etcMenuOpen,    setEtcMenuOpen]    = useState(false)                                  // 기타 드롭다운 열림(항목 선택 시 닫기)
  const [loading,        setLoading]        = useState(false)
  const [running,        setRunning]        = useState<Set<string>>(new Set())
  const [results,        setResults]        = useState<Record<string, RowResult>>({})
  const [detailFor,      setDetailFor]      = useState<string | null>(null)
  const [selectedCalcNo, setSelectedCalcNo] = useState<string | null>(null)   // 클릭된 본행(파랑 표시) — 드로어(detailFor)와 분리
  const [listSort, setListSort] = useState<SortState | null>({ key: "nm", dir: "asc" })   // 목록 정렬(전 탭 공유, 기본 이름순) — 전체실행 처리순서를 화면 정렬순과 일치시킴
  const [procTotalFor,   setProcTotalFor]   = useState<{ calcNo: string; nm: string; text: string } | null>(null)
  // 상세조회 드로어 좌우 패널 리사이즈 (계산과정 ↔ 실행과정)
  const [detailLeftPct,  setDetailLeftPct]  = useState(40)   // 좌 계산과정 40% / 우 실행과정 60% (3:2)
  const detailDragRef    = useRef(false)
  const detailPanelRef   = useRef<HTMLDivElement>(null)
  // 계산과정·실행과정 드로어 전체보기(최대폭) 토글 — 드로어별로 독립
  const [calcDrawerFull, setCalcDrawerFull] = useState(false)
  const [execDrawerFull, setExecDrawerFull] = useState(false)
  const [sessionInfo,    setSessionInfo]    = useState<{ active: boolean; ageMinutes: number | null }>({ active: false, ageMinutes: null })
  const [sessionLoading, setSessionLoading] = useState(false)
  const [batchRunning,   setBatchRunning]   = useState(false)
  const [batchProgress,  setBatchProgress]  = useState<{ done: number; total: number; skipped: number } | null>(null)
  const [diffOnly,       setDiffOnly]       = useState(false)
  const [cachedAt,       setCachedAt]       = useState<string | null>(null)   // 복원된 이전 실행 결과 저장시각(ISO)
  // 저장된 전체실행 결과 중 국세청 계산 실패(resultCode≠"S": 세션만료·차단·예외) 건수 — 캐시(results)만으로 집계, 추가 로드 0.
  //   사람 단위(탭 무관) 전역 지표 → 매 탭을 눈으로 훑지 않아도 "오류 있나"를 헤더에서 즉시 확인.
  const errorCount = useMemo(() => Object.values(results).filter(isErrorRow).length, [results])
  const [procTexts,      setProcTexts]      = useState<Record<string, string>>({})   // 계산과정 텍스트 lazy 캐시(calcNo→text) — 카드 등 목록에서 CLOB 뺀 탭용
  const [drawerProc,     setDrawerProc]     = useState<{ calcNo: string; text: string | null }>({ calcNo: "", text: null })   // 드로어 계산과정 — 열 때마다 최신 CLOB 재조회(목록 calcProcTotal이 세액 재계산 후 stale 되는 것 방지, 정확성>성능)
  const [ioDetail,       setIoDetail]       = useState<Record<string, { ntsIn: NtsIoRow[]; ntsOut: NtsIoRow[] }>>({})   // 드로어 IN/OUT lazy 캐시 — 목록 페이로드에서 뺀 상세를 열 때 단건 로드
  const listLoaded       = useRef<Set<string>>(new Set())    // 이미 fetch한 목록(`tab|year|ntsYear`) — 탭 재진입 시 재조회 스킵
  const cacheLoadedKey   = useRef<string | null>(null)       // 이미 읽은 캐시 (`year|ntsYear`) — 탭 전환마다 24MB 재읽기 방지
  const [refreshNonce, setRefreshNonce] = useState(0)        // 같은 탭 재클릭 시 목록·결과를 강제 새로고침하는 트리거(값이 바뀌면 로드 effect 재실행)
  const overwriteCacheRef = useRef(false)                    // 다음 NTS 캐시 재읽기에서 기존 결과행도 최신 캐시값으로 덮어쓸지(새로고침 시 true, 라이브 단건 결과는 캐시에 없으면 보존)
  const headerRef      = useRef<HTMLDivElement>(null)        // 툴바 폭 측정 — 넘치면 저우선 항목을 단계적으로 숨김
  const [compactLevel, setCompactLevel] = useState(0)        // 툴바 축약 레벨(0=full, 넘칠수록 ↑). 레벨별 숨김항목은 아래 derived 플래그

  // 세션 상태 30초마다 폴링 — 드롭다운 연도(ntsYear)별 세션을 조회(연도 바뀌면 재폴링)
  useEffect(() => {
    const check = () =>
      fetch(`/api/tools/hometax-calc/session?year=${ntsYear}`)
        .then(r => r.json()).then(setSessionInfo).catch(() => {})
    check()
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [ntsYear])

  // 툴바가 넘치면(스크롤 대신) 저우선 항목을 단계적으로 숨김. 스크롤바 없음(overflow-hidden).
  //   방식: 트리거(리사이즈·내용변화)마다 레벨 0부터 시작 → 넘치면 한 단계씩 올려 재측정(useLayoutEffect 반복, 페인트 전)
  //   → 맞는 최소 레벨에서 멈춤. full 폭 기준으로 매번 0부터 재수렴 → 진동 없음. MAX_COMPACT_LEVEL 초과분은 클립.
  const MAX_COMPACT_LEVEL = 6
  const measuringRef = useRef(true)
  const [, forceMeasureTick] = useState(0)   // 값 미사용 — 레벨이 이미 0이어도 강제 리렌더해 측정 이펙트를 돌린다
  const startMeasure = useCallback(() => { measuringRef.current = true; setCompactLevel(0); forceMeasureTick(t => t + 1) }, [])
  useLayoutEffect(() => {
    if (!measuringRef.current) return
    const el = headerRef.current
    if (!el) { measuringRef.current = false; return }
    setCompactLevel(lv => {
      if (el.scrollWidth > el.clientWidth + 1 && lv < MAX_COMPACT_LEVEL) return lv + 1   // 넘침 → 한 단계 더 숨김(재측정)
      measuringRef.current = false   // 맞음(또는 최대) → 종료
      return lv
    })
  })
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    startMeasure()
    const ro = new ResizeObserver(startMeasure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [startMeasure])
  // 레벨별 숨김(누적): 1 실행시간 · 2 지우기 · 3 조회/차이 축약 · 4 타이틀 · 5 조회/차이 숨김 · 6 탭·전체실행 압축.
  const hideRunTime = compactLevel >= 1
  const hideClear   = compactLevel >= 2
  const shortCount  = compactLevel >= 3
  const hideTitles  = compactLevel >= 4
  const hideCount   = compactLevel >= 5
  const compactTabs = compactLevel >= 6

  // 상세조회 드로어 좌우 리사이즈 드래그
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!detailDragRef.current || !detailPanelRef.current) return
      const rect = detailPanelRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setDetailLeftPct(Math.min(Math.max(pct, 20), 80))
    }
    const onMouseUp = () => { detailDragRef.current = false }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [])

  // 계산과정 팝업 ESC 닫기
  useEffect(() => {
    if (!procTotalFor) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setProcTotalFor(null) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [procTotalFor])

  async function startSession() {
    setSessionLoading(true)
    try {
      const res = await fetch("/api/tools/hometax-calc/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", year: ntsYear }),
      })
      setSessionInfo(await res.json())
    } finally {
      setSessionLoading(false)
    }
  }

  async function stopSession() {
    await fetch("/api/tools/hometax-calc/session", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop", year: ntsYear }),
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
    setIoDetail({})   // 드로어 IN/OUT 캐시도 비움 → 지우기 후 최신 재조회
    setCachedAt(null)
  }

  // 계산과정 텍스트 로드 — 목록 쿼리에서 뺀 CLOB(CALC_PROC_TOTAL)을 그 한 명치만 조회.
  //   정확성 우선: 캐시 재사용 없이 매번 최신으로 재조회·덮어씀(목록 calcProcTotal이 세액 재계산 후 stale 되는 것 방지).
  //   콜백은 procTexts 미의존([] deps)이라 참조 안정 → 테이블 React.memo 유지.
  const ensureProcText = useCallback(async (calcNo: string): Promise<string | null> => {
    try {
      const d = await fetch(`/api/tools/hometax-calc/proc-total?calcNo=${calcNo}`).then(r => r.json())
      if (d.text != null) setProcTexts(prev => ({ ...prev, [calcNo]: d.text }))
      return d.text ?? null
    } catch { return null }
  }, [])

  // 계산과정 팝업 열기 — 정확성 우선: 목록에 실린 값(재계산 후 stale 가능) 대신 항상 최신 CLOB 재조회, 실패 시 목록값 폴백.
  const showProc = useCallback(async (info: { calcNo: string; nm: string; text: string | null }) => {
    const text = (await ensureProcText(info.calcNo)) ?? info.text
    if (text != null) setProcTotalFor({ calcNo: info.calcNo, nm: info.nm, text })
  }, [ensureProcText])

  // year/ntsYear 변경 → 전 탭 목록·결과·캐시 무효화(탭 전환만으론 유지 = 재조회/재읽기 방지).
  useEffect(() => {
    setAllItems([]); setGiftItems([]); setCardItems([]); setMediItems([]); setPensionItems([]); setEtcItems([]); setGroupItems([]); setResults({}); setIoDetail({})
    listLoaded.current = new Set()
    cacheLoadedKey.current = null
  }, [year, ntsYear])

  // 현재 탭 목록 로드 — 이미 로드한 (tab,year,ntsYear)면 재조회 스킵(탭 전환마다 DB 재조회 방지).
  useEffect(() => {
    setDiffOnly(false)
    if (!ntsAvailable) { setLoading(false); return }   // 국세청 미개시 연도(2026 등)는 조회 없음 → 안내 배너
    const key = `${tab}|${year}|${ntsYear}`
    if (listLoaded.current.has(key)) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    const load = async () => {
      const url = tab === "all"
        ? `/api/tools/hometax-calc/list?year=${year}&ntsYear=${ntsYear}`
        : `/api/tools/hometax-calc/list?year=${year}&ntsYear=${ntsYear}&type=${tab}`
      try {
        const d = await fetch(url).then(r => r.json())
        if (cancelled) return
        listLoaded.current.add(key)
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
  }, [tab, year, ntsYear, ntsAvailable, refreshNonce])

  // 기타>그룹(인적공제/혼인자녀출산/주택자금) 선택 시 사람별 YTS 공제 조회 (NTS 값은 results.ntsMap 에서 조인).
  //   이 fetch는 목록 loading(effect1, type=etc)과 별도라 groupLoading으로 조회중 표시 → 빈-메시지 깜빡임 방지.
  useEffect(() => {
    if (tab !== "etc" || !ETC_GROUPS[etcCode]) { setGroupLoading(false); return }
    let cancelled = false
    setGroupLoading(true)
    fetch(`/api/tools/hometax-calc/list?year=${year}&ntsYear=${ntsYear}&${ETC_GROUPS[etcCode].listQs}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setGroupItems(d.items ?? []) })
      .catch(() => { /* 무시 */ })
      .finally(() => { if (!cancelled) setGroupLoading(false) })
    return () => { cancelled = true }
  }, [tab, etcCode, year, ntsYear, refreshNonce])

  // 저장된 이전 실행 결과 복원 — 배치탭 진입/파라미터 변경 시 캐시(JSON)를 읽어 results를 채운다.
  // 라이브 결과(현재 세션에서 방금 실행한 건)는 덮지 않는다("이미 있으면 유지" = 최신 우선).
  useEffect(() => {
    if (tab !== "all" && tab !== "gift" && tab !== "card" && tab !== "medi" && tab !== "pension" && tab !== "etc") return
    const key = `${year}|${ntsYear}`
    if (cacheLoadedKey.current === key) return   // 이 (year,ntsYear) 캐시를 이미 읽음 → 탭 전환마다 24MB 재읽기 방지
    let cancelled = false
    fetch(`/api/tools/hometax-calc/batch-results?year=${year}&ntsYear=${ntsYear}`)
      .then(r => r.json())
      .then((d: { savedAt: string | null; rows: { calcNo: string; ok: boolean; result: unknown; error: string | null; ranAt: string; duration: number }[] }) => {
        const overwrite = overwriteCacheRef.current   // 새로고침 재클릭이면 기존 행도 최신 캐시로 교체(아니면 라이브 결과 우선 유지)
        overwriteCacheRef.current = false             // 취소 여부와 무관하게 소비 즉시 리셋 → 플래그가 다음 읽기로 새지 않게
        if (cancelled) return                    // 취소(로딩 중 탭·연도 전환)면 잠그지 않음 → 다음 진입에서 재조회
        cacheLoadedKey.current = key              // ★성공 로드 후에만 잠금(취소된 fetch가 재조회를 막지 않게)
        if (!d.rows?.length) return
        setResults(prev => {
          const next = { ...prev }
          for (const row of d.rows) {
            if (next[row.calcNo] && !overwrite) continue
            const ranAt = formatRanAt(new Date(row.ranAt))
            next[row.calcNo] = row.ok
              ? buildRowResult(row.result, row.duration, ranAt)
              : errorRowResult(row.duration, ranAt)
          }
          return next
        })
        setCachedAt(d.savedAt)
      })
      .catch(() => { /* 실패 시 key 미설정 → 다음 진입에서 재시도 */ })
    return () => { cancelled = true }
  }, [tab, year, ntsYear, refreshNonce])

  // 진행중 가드는 ref로(running state 의존 제거) → runCompare를 안정화해 테이블 React.memo 유지.
  const inFlightRef = useRef<Set<string>>(new Set())
  const runCompare = useCallback(async (calcNo: string) => {
    if (inFlightRef.current.has(calcNo)) return
    inFlightRef.current.add(calcNo)
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
      setIoDetail(prev => { const n = { ...prev }; delete n[calcNo]; return n })   // 드로어 IN/OUT 캐시 무효화 → 재실행 후 최신 재조회(옛 스냅샷이 detailRes를 덮어쓰던 것 방지)
      // 재비교한 행의 list 원본(전송 사용액·YTS공제 등)도 최신 DB로 교체 — 대조결과만 갱신되고 list가 stale로 남던 것 방지.
      //   그 calcNo 1건만 재조회(list route calcNo 필터) → 해당 탭 items 상태의 그 행만 splice.
      try {
        const base = `year=${year}&ntsYear=${ntsYear}&calcNo=${calcNo}`
        const url =
          tab === "all" ? `/api/tools/hometax-calc/list?${base}`
          : tab === "etc" && ETC_GROUPS[etcCode] ? `/api/tools/hometax-calc/list?${base}&${ETC_GROUPS[etcCode].listQs}`
          : `/api/tools/hometax-calc/list?${base}&type=${tab}`
        const fresh = (await fetch(url).then(r => r.json())).items?.[0]
        if (fresh) {
          const upd = <T extends { calcNo: string }>(prev: T[]): T[] => prev.map(it => it.calcNo === calcNo ? (fresh as T) : it)
          if (tab === "gift")         setGiftItems(upd)
          else if (tab === "card")    setCardItems(upd)
          else if (tab === "medi")    setMediItems(upd)
          else if (tab === "pension") setPensionItems(upd)
          else if (tab === "all")     setAllItems(upd)
          else if (tab === "etc")     (ETC_GROUPS[etcCode] ? setGroupItems : setEtcItems)(upd)
        }
      } catch { /* list refresh 실패는 대조결과에 영향 없음 */ }
      // 세션이 새로 생성됐을 수 있으므로 상태 갱신
      fetch(`/api/tools/hometax-calc/session?year=${ntsYear}`).then(r => r.json()).then(setSessionInfo).catch(() => {})
    } catch {
      setResults(prev => ({ ...prev, [calcNo]: errorRowResult(Date.now() - start) }))
    } finally {
      inFlightRef.current.delete(calcNo)
      setRunning(prev => { const s = new Set(prev); s.delete(calcNo); return s })
    }
  }, [ntsYear, year, tab, etcCode])

  // ── 비교탭 전체 실행 (백그라운드 배치, SSE로 진행상황 수신) ────────────────────
  const BATCH_ENDPOINT = { all: "all-batch", gift: "gift-batch", card: "card-batch", medi: "medi-batch", pension: "pension-batch", etc: "etc-batch" } as const
  type BatchTab = keyof typeof BATCH_ENDPOINT
  const BATCH_TAB_COUNT: Record<BatchTab, number> = {
    all: allItems.length, gift: giftItems.length, card: cardItems.length, medi: mediItems.length, pension: pensionItems.length, etc: etcItems.length,
  }
  const batchEsRef = useRef<EventSource | null>(null)
  // 배치 결과 throttle 버퍼 — row마다 setResults(거대객체+테이블 전체 리렌더) 대신 0.5초마다 모아 flush.
  //   렌더 폭주(캐시 스킵 대량 시 수백 row가 순식간)를 막아 메인스레드가 안 멈춤 → 중단 클릭이 먹힌다.
  const batchBufRef   = useRef<{ calcNo: string; ok: boolean; result: unknown; duration: number }[]>([])
  const batchFlushRef = useRef<ReturnType<typeof setInterval> | null>(null)
  function flushBatchRows() {
    const buf = batchBufRef.current
    if (buf.length === 0) return
    batchBufRef.current = []
    setResults(prev => {
      const next = { ...prev }
      for (const d of buf) next[d.calcNo] = d.ok ? buildRowResult(d.result, d.duration) : errorRowResult(d.duration)
      return next
    })
  }
  function stopBatchFlush() {
    if (batchFlushRef.current) { clearInterval(batchFlushRef.current); batchFlushRef.current = null }
    flushBatchRows()   // 남은 버퍼 최종 반영(중단 시 부분결과 표시)
  }
  useEffect(() => () => { if (batchFlushRef.current) clearInterval(batchFlushRef.current) }, [])   // 언마운트 시 타이머 정리

  function stopBatch() {
    batchEsRef.current?.close()
    batchEsRef.current = null
    stopBatchFlush()
    setBatchRunning(false)
    toast("전체 실행 중단됨 — 부분 결과는 저장되었습니다", { duration: Infinity })
  }

  // endpoint = 라우트명(그룹은 쿼리 포함 가능 예 "personal-batch?group=income"), total = 진행바 분모.
  function runItemBatch(endpoint: string, total: number) {
    if (batchRunning) return
    let doneCount = 0, skipCount = 0   // 클로저 카운터 — done 시점 완료 toast용(state 클로저 회피)
    const startedAt = Date.now()       // 배치 시작 시각 — 완료 toast 소요시간 표시용
    setBatchRunning(true)
    setBatchProgress({ done: 0, total, skipped: 0 })
    setIoDetail({})   // 전체실행 = 전 결과 교체 → 드로어 IN/OUT 캐시 초기화
    batchBufRef.current = []
    batchFlushRef.current = setInterval(flushBatchRows, 500)   // row는 버퍼에 쌓고 0.5초마다 반영

    const sep = endpoint.includes("?") ? "&" : "?"
    const es = new EventSource(`/api/tools/hometax-calc/${endpoint}${sep}year=${year}&ntsYear=${ntsYear}&sortKey=${encodeURIComponent(listSort?.key ?? "")}&sortDir=${listSort?.dir ?? "asc"}`)
    batchEsRef.current = es

    es.addEventListener("start", (e) => {
      const { total } = JSON.parse((e as MessageEvent).data) as { total: number }
      setBatchProgress({ done: 0, total, skipped: 0 })
    })

    es.addEventListener("running", (e) => {   // ★행 처리 시작 — 그 행에 스피너(running)
      const { calcNo } = JSON.parse((e as MessageEvent).data) as { calcNo: string }
      setRunning(prev => new Set(prev).add(calcNo))
    })

    es.addEventListener("row", (e) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = JSON.parse((e as MessageEvent).data) as { calcNo: string; ok: boolean; result?: any; error?: string; duration: number; cached?: boolean }
      doneCount++; if (data.cached) skipCount++
      batchBufRef.current.push({ calcNo: data.calcNo, ok: data.ok, result: data.result, duration: data.duration })   // flush는 타이머가(0.5초)
      setBatchProgress(prev => prev ? { ...prev, done: prev.done + 1, skipped: prev.skipped + (data.cached ? 1 : 0) } : prev)
      setRunning(prev => { const s = new Set(prev); s.delete(data.calcNo); return s })   // 그 행 스피너 해제(결과는 buffer flush)
    })

    es.addEventListener("blocked", (e) => {
      const { message } = JSON.parse((e as MessageEvent).data) as { message: string }
      toast.error(message, { duration: Infinity })
    })

    es.addEventListener("done", () => {
      stopBatchFlush()   // 타이머 정지 + 남은 버퍼 최종 반영
      setCachedAt(new Date().toISOString())   // 방금 돌린 결과도 캐시에 저장됨 → "저장된 결과 한 벌"로 통일 표시
      setBatchRunning(false); setRunning(new Set())
      es.close()
      batchEsRef.current = null
      const secs = (Date.now() - startedAt) / 1000
      const elapsed = secs < 60 ? `${secs.toFixed(1)}초` : `${Math.floor(secs / 60)}분${Math.round(secs % 60)}초`
      toast.success(
        <div className="leading-snug">
          <div>전체 실행 완료</div>
          <div className="text-xs">총 {doneCount}건{skipCount ? `(스킵 ${skipCount})` : ""}ㆍ소요 {elapsed}</div>
        </div>,
        { duration: Infinity },
      )
      fetch(`/api/tools/hometax-calc/session?year=${ntsYear}`).then(r => r.json()).then(setSessionInfo).catch(() => {})
    })

    es.addEventListener("error", (e) => {
      stopBatchFlush()
      let message = "배치 실행 중 오류가 발생했습니다."
      try {
        message = (JSON.parse((e as MessageEvent).data) as { message: string }).message
      } catch { /* 기본 메시지 유지 */ }
      toast.error(message, { duration: Infinity })
      setBatchRunning(false); setRunning(new Set())
      es.close()
      batchEsRef.current = null
    })

    es.onerror = () => {
      stopBatchFlush()
      setBatchRunning(false); setRunning(new Set())
      es.close()
      batchEsRef.current = null
    }
  }


  // 목록 캐시는 IN/OUT을 뺀 슬림이라, 드로어용으로 lazy 로드한 ioDetail을 병합해 DetailView에 넘긴다.
  // (라이브 실행 결과는 이미 ntsIn/ntsOut 보유 → 병합 불필요·fetch 스킵.) 병합은 드로어 한정이라 목록 테이블 리렌더에 영향 없음.
  const detailResBase = detailFor ? results[detailFor] : null
  const detailRes = detailResBase && detailFor && ioDetail[detailFor]
    ? { ...detailResBase, ...ioDetail[detailFor] }
    : detailResBase
  // all탭뿐 아니라 지금 켜져있지 않은 다른 탭에서 열었을 수도 있어 전 탭 리스트를 다 뒤진다.
  const detailRow: DetailRowLike | null = detailFor ? (
    allItems.find(i => i.calcNo === detailFor)
    ?? giftItems.find(i => i.calcNo === detailFor)
    ?? cardItems.find(i => i.calcNo === detailFor)
    ?? mediItems.find(i => i.calcNo === detailFor)
    ?? pensionItems.find(i => i.calcNo === detailFor)
    ?? etcItems.find(i => i.calcNo === detailFor)
    ?? groupItems.find(i => i.calcNo === detailFor)
    ?? null
  ) : null

  // 계산과정 텍스트 — 드로어 열 때 재조회한 최신 CLOB(drawerProc) 우선, 로딩 중엔 목록값으로 자리 유지.
  //   목록의 calcProcTotal 은 세액 재계산 후 stale 될 수 있어(주택자금 결합한도 변경 등) 최신 재조회값을 앞세운다.
  const detailProcText: string | null =
    (drawerProc.calcNo === detailFor && drawerProc.text != null)
      ? drawerProc.text
      : detailRow?.calcProcTotal ?? (detailFor ? procTexts[detailFor] ?? null : null)
  // 계산과정 패널 자리 확보 여부 — 텍스트가 lazy 로드되기 전에도 hasProc면 좌패널을 그려
  // 첫 열림부터 최종 레이아웃(좌 계산 / 우 실행)으로 뜨게 한다(실행과정 100%→축소 깜빡임 제거).
  const hasProcPanel = !!detailProcText || !!detailRow?.hasProc

  // 드로어 열 때마다 계산과정 CLOB을 최신으로 재조회(정확성>성능). 목록에 실린 calcProcTotal은
  // 세액 재계산 후 stale일 수 있어(예: 주택자금 결합한도 변경) 항상 서버에서 그 한 명치만 다시 읽는다.
  useEffect(() => {
    if (!detailFor) return
    let cancelled = false
    fetch(`/api/tools/hometax-calc/proc-total?calcNo=${detailFor}`)
      .then(r => r.json())
      .then((d: { text?: string | null }) => { if (!cancelled) setDrawerProc({ calcNo: detailFor, text: d.text ?? null }) })
      .catch(() => { if (!cancelled) setDrawerProc({ calcNo: detailFor, text: null }) })
    return () => { cancelled = true }
  }, [detailFor])

  // 드로어 열림 → IN/OUT 상세 lazy 로드. 목록 캐시는 슬림(ntsIn 비어있음)이라 그 한 명치만 가져온다.
  // 라이브 실행 결과(ntsIn 보유)·이미 로드한 건은 스킵.
  useEffect(() => {
    if (!detailFor) return
    const r = results[detailFor]
    if (!r || r.ntsIn.length > 0 || ioDetail[detailFor]) return
    let cancelled = false
    fetch(`/api/tools/hometax-calc/batch-results/detail?year=${year}&ntsYear=${ntsYear}&calcNo=${detailFor}`)
      .then(res => res.json())
      .then((d: { ntsIn?: NtsIoRow[]; ntsOut?: NtsIoRow[] }) => {
        if (!cancelled) setIoDetail(prev => ({ ...prev, [detailFor]: { ntsIn: d.ntsIn ?? [], ntsOut: d.ntsOut ?? [] } }))
      })
      .catch(() => { /* 무시 */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailFor])

  // 모순 감지기(dev)용 — 이 사람 리스트 라인 코드 합집합(탭별 lines). 드로어 diff 가 이 밖이면 경고.
  const detailListCodes: string[] = detailFor
    ? [giftItems, cardItems, mediItems, pensionItems, etcItems, groupItems]
        .flatMap(list => list.filter(i => i.calcNo === detailFor))
        .flatMap(it => ("lines" in it ? it.lines : []).map(l => l.code))
        .filter((c): c is string => !!c)
    : []

  // 기타 탭: 드롭다운으로 고른 한 항목(etcCode)만 남긴다 — 각 사람의 lines 를 해당 code 한 줄로 축소.
  // useMemo로 참조 안정화(매 렌더 새 배열 방지) → EtcTable React.memo가 무관한 리렌더에 스킵되게.
  const etcByCode: EtcListItem[] = useMemo(() => etcItems
    .map(row => {
      const line = row.lines.find(l => l.code === etcCode)
      return line ? { ...row, lines: [line], etcDdc: line.ytsDdc } : null
    })
    .filter((r): r is EtcListItem => r !== null), [etcItems, etcCode])

  const etcLabel = etcTabItems.find(i => i.code === etcCode)?.label ?? ""
  const isGroup = tab === "etc" && !!ETC_GROUPS[etcCode]   // 기타>그룹(인적공제/혼인자녀출산/주택자금) 뷰

  const currentCount = tab === "gift" ? giftItems.length : tab === "card" ? cardItems.length : tab === "medi" ? mediItems.length : tab === "pension" ? pensionItems.length : tab === "etc" ? (isGroup ? groupItems.length : etcByCode.length) : allItems.length

  // 탭별 YTS·NTS 값이 다른지 판정 (실행 전이면 false) — 차이 건수 집계·필터링에 공통 사용
  // ── 항목층 차이 판정: 전부 ddcVerdict 단일원천 사용(드로어 ③표와 동일 규칙) ──
  //   코드집합 중 diff 가 하나라도 있으면 그 사람을 "차이"로 카운트(배지·차이만보기).
  //   과거 합/소계/?? 0 파편화 제거 → 리스트 배지 = 드로어 ✗ 개수 항상 일치.
  const rowHasDiff = (calcNo: string, codes: Iterable<string | null>): boolean => {
    const res = results[calcNo]
    return !!res && verdict.diffCodesOf(res, codes).length > 0
  }
  // 기부: YTS 라인 없는 국세청 자체생성 코드(고향특별 8784 등)도 잡도록 기부 전체 도메인으로 대조
  const giftHasDiff    = (i: GiftListItem)     => rowHasDiff(i.calcNo, GIFT_CODES)
  const etcHasDiff     = (i: EtcListItem)      => rowHasDiff(i.calcNo, i.lines.map(l => l.code))
  const pensionHasDiff = (i: PensionListItem)  => rowHasDiff(i.calcNo, i.lines.map(l => l.code))
  const groupHasDiff   = (i: PersonalListItem) => rowHasDiff(i.calcNo, i.lines.map(l => l.code))
  // 소계형(카드8430·의료8726): per-code 불가라 소계코드 한 점이 유일 대조점(구조적 예외)
  const subtotalHasDiff = (calcNo: string, code: string): boolean => {
    const res = results[calcNo]
    return !!res && verdict.ddcVerdict(res, code) === "diff"
  }
  // 의료비 "차이" = 세액 차이(대조b, 8726) OR fmly_dtl집계 불일치(대조a). 집계 불일치는 NTS 실행 전에도 잡힘.
  const mediHasDiff = (i: MediListItem) => subtotalHasDiff(i.calcNo, MEDI_SUBTOTAL_CODE) || i.selfAggMismatch
  // 전체탭 "차이" = 표시되는 전 열(인적연금·특별·그밖의·감면·세액공제·산출·결정) 중 하나라도 diff.
  //   각 열 셀의 diff 계산과 동일 로직 → 빨갛게 보이는 것이 곧 카운트·필터에 잡힌다(화면↔필터 일치).
  function allHasDiff(i: ListItem): boolean {
    const res = results[i.calcNo]
    if (!res) return false
    const nm = res.ntsMap
    const cellDiff = (code: string, yts?: number) => { const nts = nm[code]; return nts != null && nts !== (yts ?? 0) }
    const persPenDiff = PERS_PEN_CODES.some(c => nm[c] != null)
      && PERS_PEN_CODES.reduce((s, c) => s + (nm[c] ?? 0), 0) !== (i.persPen ?? 0)
    return (
      persPenDiff ||
      cellDiff("8920", i.spclSubSum) || cellDiff("8921", i.otoSum) ||
      cellDiff("8924", i.taxCut)     || cellDiff("8923", i.rtSum) ||
      (res.nts.prodTax    != null && res.nts.prodTax    !== i.prodTaxAmt) ||
      (res.nts.decidedTax != null && res.nts.decidedTax !== i.resIncmTax)
    )
  }

  const diffCount =
    tab === "gift"    ? giftItems.filter(giftHasDiff).length :
    tab === "card"    ? cardItems.filter(i => subtotalHasDiff(i.calcNo, CARD_SUBTOTAL_CODE)).length :
    tab === "medi"    ? mediItems.filter(mediHasDiff).length :
    tab === "pension" ? pensionItems.filter(pensionHasDiff).length :
    tab === "etc"     ? (isGroup ? groupItems.filter(groupHasDiff).length : etcByCode.filter(etcHasDiff).length) :
    allItems.filter(allHasDiff).length

  // 툴바 내용 변화(실행결과·조회수·차이·탭·연도)로 폭이 바뀌면 레벨 0부터 재측정 — RO는 el 자체 크기만 감지하므로 보완.
  useEffect(() => { startMeasure() }, [startMeasure, cachedAt, currentCount, diffCount, selectedTab, etcLabel, ntsYear, batchRunning])

  // 차이만 보기 필터 활성 시 현재 탭의 items를 차이나는 건만 추림
  const showDiffOnly     = diffOnly && diffCount > 0
  const shownAllItems     = showDiffOnly ? allItems.filter(allHasDiff) : allItems
  const shownGiftItems    = showDiffOnly ? giftItems.filter(giftHasDiff) : giftItems
  const shownCardItems    = showDiffOnly ? cardItems.filter(i => subtotalHasDiff(i.calcNo, CARD_SUBTOTAL_CODE)) : cardItems
  const shownMediItems    = showDiffOnly ? mediItems.filter(mediHasDiff) : mediItems
  const shownPensionItems = showDiffOnly ? pensionItems.filter(pensionHasDiff) : pensionItems
  const shownEtcItems     = showDiffOnly ? etcByCode.filter(etcHasDiff) : etcByCode
  const shownGroupItems = showDiffOnly ? groupItems.filter(groupHasDiff) : groupItems

  return (
    <YearVerdictContext.Provider value={{ verdict, codeLabel }}>
    <div className="flex flex-col h-full min-h-0">
      {/* 헤더 — 한 줄 유지(줄바꿈 금지). 넘치면 저우선 항목 숨김+탭/전체실행 1자 압축(compactTabs). 스크롤바 없이 클립. */}
      <div ref={headerRef} className="shrink-0 flex items-center gap-2 p-4 border-b overflow-hidden">
        {/* 국세청 모의계산 연도 (중심축) — 선택하면 YTS 데이터 연도가 자동 연동 */}
        {!hideTitles && <span className="text-xs text-muted-foreground whitespace-nowrap">모의계산</span>}
        {/* 전체 실행 중엔 연도 변경 잠금 — 연도는 계산 파라미터라 진행 중 바뀌면 옛 연도 결과가 새 화면에 섞임(탭=뷰는 자유). */}
        <Select value={ntsYear} disabled={batchRunning} onValueChange={v => { if (v) { setNtsYear(v); setYear(v) } }}>
          <SelectTrigger className="w-20 h-7 shrink-0 text-sm" title={batchRunning ? "전체 실행 중에는 연도를 변경할 수 없습니다 — 중단 후 변경하세요" : undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NTS_SELECTABLE.map(y => (
              <SelectItem key={y} value={y}>{y}년</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* YTS 데이터 연도 = 국세청 연도에 자동 연동(수정 불가) */}
        {!hideTitles && <span className="text-xs text-muted-foreground whitespace-nowrap">데이터</span>}
        <div
          className="w-20 h-7 shrink-0 whitespace-nowrap flex items-center justify-center rounded-md border bg-muted text-sm text-muted-foreground cursor-not-allowed"
          title="국세청 모의계산 연도에 자동 연동됩니다"
        >{year}년</div>

        <div className="w-px h-5 bg-border mx-1" />
        <div className="flex shrink-0 whitespace-nowrap rounded-md border overflow-hidden text-xs font-medium">
          <button
            className={`px-3 py-1.5 whitespace-nowrap transition-colors ${selectedTab === "all" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => selectTab("all")}
            title="전체"
          >{compactTabs ? "전…" : "전체"}</button>
        </div>

        <div className="flex shrink-0 whitespace-nowrap rounded-md border overflow-hidden text-xs font-medium">
          <button
            className={`px-3 py-1.5 transition-colors ${selectedTab === "gift" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => selectTab("gift")}
            title="기부금"
          >{compactTabs ? "기…" : "기부금"}</button>
          <button
            className={`px-3 py-1.5 border-l transition-colors ${selectedTab === "card" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => selectTab("card")}
            title="신용카드"
          >{compactTabs ? "신…" : "신용카드"}</button>
          <button
            className={`px-3 py-1.5 border-l transition-colors ${selectedTab === "medi" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => selectTab("medi")}
            title="의료비"
          >{compactTabs ? "의…" : "의료비"}</button>
          <button
            className={`px-3 py-1.5 border-l transition-colors ${selectedTab === "pension" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => selectTab("pension")}
            title="연금계좌"
          >{compactTabs ? "연…" : "연금계좌"}</button>
          {/* 기타 = 드롭다운: 잡다 세액공제 항목 중 하나를 골라 본문 리스트 필터로 사용 */}
          <DropdownMenu open={etcMenuOpen} onOpenChange={setEtcMenuOpen}>
            <DropdownMenuTrigger
              className={`px-3 py-1.5 border-l transition-colors inline-flex items-center gap-1 ${selectedTab === "etc" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              title={`기타${etcLabel ? `: ${etcLabel}` : ""}`}
            >
              {compactTabs ? "기…" : `기타${etcLabel ? `: ${etcLabel}` : ""}`}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup value={etcCode} onValueChange={c => { setEtcCode(c); selectTab("etc"); setEtcMenuOpen(false) }}>
                {etcTabItems.map(it => {
                  const members = etcGroupMembers(it.code, cfg.mapping)
                  return (
                    <DropdownMenuRadioItem key={it.code} value={it.code} disabled={it.disabled} className="text-xs flex flex-col items-start gap-0">
                      <span>{it.label}</span>
                      {members.length > 0 && (
                        <span className="text-[10px] text-muted-foreground/70 max-w-[16rem] truncate">{members.map(m => m.label).join(" · ")}</span>
                      )}
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {(tab === "all" || tab === "gift" || tab === "card" || tab === "medi" || tab === "pension" || tab === "etc") && (
          <>
            <Button
              size="sm" variant={batchRunning ? "destructive" : "outline"} className="h-7 text-xs shrink-0" title="전체 실행"
              disabled={!batchRunning && (isGroup ? groupItems.length === 0 : BATCH_TAB_COUNT[tab] === 0)}
              onClick={() => batchRunning
                ? stopBatch()
                : isGroup
                  ? runItemBatch(ETC_GROUPS[etcCode].batchEndpoint, groupItems.length)
                  : runItemBatch(BATCH_ENDPOINT[tab], BATCH_TAB_COUNT[tab])}
            >
              {batchRunning
                ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />중단 ({batchProgress?.done ?? 0}/{batchProgress?.total ?? 0}{batchProgress?.skipped ? `, 스킵 ${batchProgress.skipped}` : ""})</>
                : compactTabs ? "전…" : "전체 실행"}
            </Button>
            {/* 저장된 전체실행 결과 = 한 벌. 실행시각·지우기는 저우선(공간 없으면 숨김). ⚠오류는 중요해 유지. */}
            {cachedAt && !batchRunning && (
              <span className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
                {!hideRunTime && (
                  <span title="저장된 전체실행 결과입니다. 다시 실행하면 갱신됩니다.">
                    실행 {formatRanAt(new Date(cachedAt))}
                  </span>
                )}
                {errorCount > 0 && (
                  <span className="text-amber-700 font-semibold" title="국세청 계산 실패(세션만료·차단·예외) 건수 — 해당 인원 재실행 필요">
                    ⚠ 오류 {errorCount}건
                  </span>
                )}
                {!hideClear && (
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs text-muted-foreground" onClick={clearCache}>
                    지우기
                  </Button>
                )}
              </span>
            )}
          </>
        )}

        {(loading || isTabPending) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {!loading && !isTabPending && currentCount > 0 && !hideCount && (
          <span className="text-xs text-muted-foreground flex items-center gap-1 whitespace-nowrap">
            <span>{currentCount}명{!shortCount && " 조회됨"}</span>
            {diffCount > 0 && (
              <button
                className={`rounded px-1.5 py-0.5 font-medium whitespace-nowrap transition-colors ${diffOnly ? "bg-red-600 text-white" : "text-red-600 hover:bg-red-50"}`}
                onClick={() => setDiffOnly(v => !v)}
              >
                ({diffCount}명{!shortCount && " 차이"})
              </button>
            )}
          </span>
        )}

        {/* 맵현황 — 탭 인라인이 아니라 바로 전용 팝업 창으로(기부금 등 다른 탭 보며 나란히). 차단 시 새 탭 폴백 */}
        <div className="ml-auto flex shrink-0 whitespace-nowrap rounded-md border overflow-hidden text-xs font-medium">
          <button
            className="px-3 py-1.5 transition-colors hover:bg-muted"
            title="맵현황을 새 창으로 열기 — 다른 탭과 나란히 보기"
            onClick={() => {
              const url = `/hometax-calc-map?year=${ntsYear}`
              const w = window.open(url, "mapStatus", "popup,width=1480,height=900,left=80,top=60")
              if (!w) window.open(url, "_blank")   // 팝업 차단 → 새 탭으로라도
            }}
          >맵현황 ↗</button>
        </div>

        {/* 세션 상태 = 아이콘 하나. 활성=녹색·없음=회색. 실행 시 세션 자동 생성(getOrCreateSession)이라 시작 버튼 불필요.
            활성일 때 클릭하면 종료(강제 재생성용). */}
        <button
          type="button"
          onClick={sessionInfo.active ? stopSession : undefined}
          disabled={!sessionInfo.active || sessionLoading}
          title={sessionLoading ? "NTS 세션 준비 중…"
            : sessionInfo.active ? `NTS 세션 활성 (${sessionInfo.ageMinutes}분) — 클릭하면 종료`
            : "NTS 세션 없음 — 실행 시 자동 생성됩니다"}
          className="shrink-0 flex items-center"
        >
          {sessionLoading
            ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            : <Wifi className={`h-4 w-4 ${sessionInfo.active ? "text-green-600" : "text-muted-foreground/40"}`} />}
        </button>
      </div>

      {/* 기타 그룹 선택 시 구성 항목 캡션 (MAPPING group 파생) */}
      {tab === "etc" && isGroup && etcGroupMembers(etcCode, cfg.mapping).length > 0 && (
        <div className="shrink-0 px-4 py-2 text-xs text-muted-foreground border-b bg-muted/30">
          <span className="font-medium text-foreground">{etcLabel}</span> 포함: {etcGroupMembers(etcCode, cfg.mapping).map(m => `${m.label}(${m.code})`).join(" · ")}
        </div>
      )}
      {/* 테이블 */}
      <div className="flex-1 min-h-0 overflow-auto">
        {!ntsAvailable ? (
          <div className="flex flex-col items-center justify-center h-full gap-1 p-8 text-center text-sm text-muted-foreground">
            <span className="font-medium">{ntsYear}년 국세청 모의계산은 아직 제공되지 않습니다.</span>
            <span>국세청 서비스가 개시되면 지원 예정입니다.</span>
          </div>
        ) : (<>
        {tab === "all"  && <AllTableMemo  items={shownAllItems}  loading={loading} results={results} running={running} onRun={runCompare} onDetail={setDetailFor} onShowProc={showProc} onSelect={setSelectedCalcNo} selectedCalcNo={selectedCalcNo} listSort={listSort} onListSort={setListSort} />}
        {tab === "gift" && <GiftTableMemo items={shownGiftItems} loading={loading} results={results} running={running} onRun={runCompare} onDetail={setDetailFor} onShowProc={showProc} onSelect={setSelectedCalcNo} selectedCalcNo={selectedCalcNo} listSort={listSort} onListSort={setListSort} />}
        {tab === "card" && <CardTableMemo items={shownCardItems} loading={loading} results={results} running={running} onRun={runCompare} onDetail={setDetailFor} onShowProc={showProc} onSelect={setSelectedCalcNo} selectedCalcNo={selectedCalcNo} listSort={listSort} onListSort={setListSort} />}
        {tab === "medi" && <MediTableMemo items={shownMediItems} loading={loading} results={results} running={running} onRun={runCompare} onDetail={setDetailFor} onShowProc={showProc} onSelect={setSelectedCalcNo} selectedCalcNo={selectedCalcNo} listSort={listSort} onListSort={setListSort} />}
        {tab === "pension" && <PensionTableMemo items={shownPensionItems} loading={loading} results={results} running={running} onRun={runCompare} onDetail={setDetailFor} onShowProc={showProc} onSelect={setSelectedCalcNo} selectedCalcNo={selectedCalcNo} listSort={listSort} onListSort={setListSort} />}
        {tab === "etc" && (isGroup
          ? <PersonalTableMemo items={shownGroupItems} title={etcLabel} loading={loading || groupLoading} results={results} running={running} onRun={runCompare} onDetail={setDetailFor} onShowProc={showProc} onSelect={setSelectedCalcNo} selectedCalcNo={selectedCalcNo} listSort={listSort} onListSort={setListSort} />
          : <EtcTableMemo items={shownEtcItems} loading={loading} results={results} running={running} onRun={runCompare} onDetail={setDetailFor} onShowProc={showProc} onSelect={setSelectedCalcNo} selectedCalcNo={selectedCalcNo} listSort={listSort} onListSort={setListSort} />)}
        </>)}
      </div>

      {/* 상세조회 드로어 — 좌: 계산과정 / 우: 실행과정 (팝업과 동일하게 나란히) */}
      <Sheet open={detailFor !== null} onOpenChange={o => { if (!o) setDetailFor(null) }}>
        <SheetContent
          side="right" className="w-full p-0 gap-0 flex-row"
          style={execDrawerFull
            ? { left: "3rem", right: 0, width: "auto", maxWidth: "none" }   // 왼쪽 사이드바(아이콘폭) 남기고 나머지 전부
            : { maxWidth: "min(96vw, 100rem)" }}
        >
          <Button
            variant="ghost" size="icon-sm" className="absolute top-3 right-12 z-10"
            onClick={() => setExecDrawerFull(v => !v)}
            title={execDrawerFull ? "기본 크기" : "전체보기"}
          >
            {execDrawerFull ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <div ref={detailPanelRef} className="flex min-w-0 flex-1">
            {hasProcPanel && (
              <div
                className="flex min-w-0 flex-col border-r"
                style={{ width: detailRes ? `${detailLeftPct}%` : "100%" }}
              >
                {detailProcText
                  ? <ProcTotalView info={{ calcNo: detailFor!, nm: detailRow!.nm, text: detailProcText }} ntsMap={detailRes?.ntsMap} ntsYear={ntsYear} />
                  : <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />계산과정 불러오는 중…
                    </div>}
              </div>
            )}
            {hasProcPanel && detailRes && (
              <div
                className="w-1.5 shrink-0 cursor-col-resize bg-border hover:bg-primary/40 transition-colors"
                onMouseDown={e => { e.preventDefault(); detailDragRef.current = true }}
              />
            )}
            {detailRes && (
              <div className="flex min-w-0 flex-1 flex-col">
                <DetailView
                  res={detailRes} row={detailRow} calcNo={detailFor!}
                  procOrder={detailProcText ? procCodeOrder(detailProcText) : undefined}
                  listCodes={detailListCodes} ntsYear={ntsYear}
                />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* 계산과정 드로어 — 실행여부와 상관없이 본인 계산과정만 표시 */}
      <Sheet open={procTotalFor !== null} onOpenChange={o => { if (!o) setProcTotalFor(null) }}>
        <SheetContent
          side="right" className="w-full p-0"
          style={calcDrawerFull
            ? { left: "3rem", right: 0, width: "auto", maxWidth: "none" }   // 왼쪽 사이드바(아이콘폭) 남기고 나머지 전부
            : { maxWidth: "min(92vw, 60rem)" }}
        >
          <Button
            variant="ghost" size="icon-sm" className="absolute top-3 right-12 z-10"
            onClick={() => setCalcDrawerFull(v => !v)}
            title={calcDrawerFull ? "기본 크기" : "전체보기"}
          >
            {calcDrawerFull ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          {procTotalFor && <ProcTotalView info={procTotalFor} ntsMap={results[procTotalFor.calcNo]?.ntsMap} ntsYear={ntsYear} />}
        </SheetContent>
      </Sheet>
    </div>
    </YearVerdictContext.Provider>
  )
}

// ── 전체 비교 테이블 ─────────────────────────────────────────────────────────
function AllTable({ items, loading, results, running, onRun, onDetail, onShowProc, onSelect, selectedCalcNo, listSort, onListSort }: {
  items: ListItem[]; loading: boolean; onSelect: (calcNo: string) => void; selectedCalcNo: string | null
  results: Record<string, RowResult>; running: Set<string>
  onRun: (calcNo: string) => void; onDetail: (calcNo: string) => void
  onShowProc: (info: { calcNo: string; nm: string; text: string | null }) => void
  listSort: SortState | null; onListSort: (s: SortState | null) => void
}) {
  const { sorted, sort, onSort } = useSortedList(items, listSort, onListSort)
  // 한 항목을 "YTS값 (차이)" 1컬럼으로. 차이=NTS−YTS: null(미실행)="(—)", 0=정상(회색), ≠0=이상(빨강)
  //   emphasize=최종 지표(산출세액·결정세액) 컬럼에 흐린 회색 배경 → 중간 공제 컬럼과 시각 구분(글꼴은 동일).
  const calcCell = (yts: number | undefined, diff: number | null, emphasize = false) => (
    <td className={`px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap ${emphasize ? "bg-muted/70" : ""}`}>
      {won(yts)}{" "}
      <span className={diff == null ? "text-muted-foreground/40" : diff !== 0 ? "text-red-600 font-medium" : "text-muted-foreground/50"}>
        ({diff == null ? "—" : diff === 0 ? "0" : (diff > 0 ? "+" : "") + diff.toLocaleString("ko-KR")})
      </span>
    </td>
  )
  return (
    <table className="w-full min-w-max text-sm border-collapse">
      <thead className="sticky top-0 z-10 bg-muted">
        <tr className="border-b text-xs text-muted-foreground">
          <SortableTh label="이름" k="nm" sort={sort} onSort={onSort} className="text-left w-20" />
          <SortableTh label="사번" k="empNo" sort={sort} onSort={onSort} className="text-center w-20" />
          <SortableTh label="CALC_NO" k="calcNo" sort={sort} onSort={onSort} className="text-left w-28" />
          <SortableTh label="표준/특별" k="calcType" sort={sort} onSort={onSort} className="text-left w-24" />
          <SortableTh label="계속/퇴사" k="workStatus" sort={sort} onSort={onSort} className="text-left w-24" />
          <th className="px-1 py-2 text-center font-medium whitespace-nowrap w-10">계산</th>
          <th className="px-1 py-2 text-left font-medium w-16">소진지점</th>
          <SortableTh label="총급여" k="totPayAmt" sort={sort} onSort={onSort} className="text-right w-32" />
          <th className="px-3 py-2 text-center font-medium w-24">실행 / 분석</th>
          <SortableTh label="인적·연금공제(차이)" k="persPen" sort={sort} onSort={onSort} className="text-right" />
          <SortableTh label="특별소득공제(차이)" k="spclSubSum" sort={sort} onSort={onSort} className="text-right" />
          <SortableTh label="그밖의소득공제(차이)" k="otoSum" sort={sort} onSort={onSort} className="text-right" />
          <SortableTh label="산출세액(차이)" k="prodTaxAmt" sort={sort} onSort={onSort} className="text-right" />
          <SortableTh label="세액감면(차이)" k="taxCut" sort={sort} onSort={onSort} className="text-right" />
          <SortableTh label="세액공제(차이)" k="rtSum" sort={sort} onSort={onSort} className="text-right" />
          <SortableTh label="결정세액(차이)" k="resIncmTax" sort={sort} onSort={onSort} className="text-right" />
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">비교일시</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">소요</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 && !loading && (
          <tr><td colSpan={18} className="px-3 py-8 text-center text-sm text-muted-foreground">데이터가 없습니다.</td></tr>
        )}
        {sorted.map(row => {
          const res       = results[row.calcNo]
          const isRunning = running.has(row.calcNo)
          const prodNts   = res ? res.nts.prodTax : null
          const dcdNts    = res ? res.nts.decidedTax : null
          const prodDiff  = prodNts != null ? prodNts - row.prodTaxAmt : null
          const dcdDiff   = dcdNts  != null ? dcdNts  - row.resIncmTax : null
          // 중간 계 NTS(ntsMap 코드) − YTS. res 없으면(미실행) null → "—", 0=정상·≠0=이상
          const subDiff = (code: string, yts: number | undefined) => {
            const nts = res ? (res.ntsMap[code] ?? null) : null
            return nts != null ? nts - (yts ?? 0) : null
          }
          // 인적+연금공제 — NTS는 개별 인적코드+연금계(PERS_PEN_CODES) 합. YTS(row.persPen)=WORK_AMT−특별−차감소득과 대응.
          const ntsPersPen  = res && PERS_PEN_CODES.some(c => res.ntsMap[c] != null) ? PERS_PEN_CODES.reduce((s, c) => s + (res.ntsMap[c] ?? 0), 0) : null
          const persPenDiff = ntsPersPen != null ? ntsPersPen - (row.persPen ?? 0) : null
          return (
            <tr key={row.calcNo} onClick={() => onSelect(row.calcNo)} className={`cursor-default border-b ${rowBg(res, row.calcNo === selectedCalcNo)}`}>
              <td className="px-3 py-2 whitespace-nowrap">{row.nm}</td>
              <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{row.empNo}</td>
              <td className="px-3 py-2 font-mono text-xs">{row.calcNo}</td>
              <PersonMainCells item={row} onShowProc={onShowProc} />
              <td className="px-3 py-2 text-right tabular-nums">{won(row.totPayAmt)}</td>
              <td className="px-3 py-2 text-center whitespace-nowrap">
                <div className="flex items-center justify-center gap-1">
                  <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={isRunning} title="실행" onClick={() => onRun(row.calcNo)}>
                    {isRunning ? <Loader2 className="h-3 w-3 animate-spin text-red-600" /> : <Play className="h-3 w-3" />}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs disabled:opacity-100" disabled={!res} title="분석" onClick={() => onDetail(row.calcNo)}>
                    <FileSearch className={`h-3.5 w-3.5 ${res ? "" : "opacity-25"}`} />
                  </Button>
                </div>
              </td>
              {calcCell(row.persPen,    persPenDiff)}
              {calcCell(row.spclSubSum, subDiff("8920", row.spclSubSum))}
              {calcCell(row.otoSum,     subDiff("8921", row.otoSum))}
              {calcCell(row.prodTaxAmt, prodDiff, true)}
              {calcCell(row.taxCut,     subDiff("8924", row.taxCut))}
              {calcCell(row.rtSum,      subDiff("8923", row.rtSum))}
              {calcCell(row.resIncmTax, dcdDiff, true)}
              <td className="px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">{res?.ranAt ?? "—"}</td>
              <td className="px-3 py-2 text-right text-xs text-muted-foreground">{res ? time(res.duration) : "—"}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// 기부금 항목(라벨)만 강조 — 정치·고향(일반+특별)=청색, 특례=녹색, 우리사주=보라색 (적색계통은 오류 전용).
// (이월은 별도로 '연도' 칸만 보라 — 항목/금액엔 색 없음. 색 최소화.)
const GIFT_TYPE_HL: Record<string, string> = {
  "548-020": "text-blue-600 font-semibold",     // 정치자금
  "548-100": "text-blue-600 font-semibold",     // 고향(일반)
  "548-110": "text-blue-600 font-semibold",     // 고향(특별)
  "548-010": "text-green-600 font-semibold",    // 특례기부금
  "548-080": "text-purple-600 font-semibold",   // 우리사주
}

// ── 기부금 비교 테이블 (본행 합계 + 유형×연도 세부행) ────────────────────────
function GiftTable({ items, loading, results, running, onRun, onDetail, onShowProc, onSelect, selectedCalcNo, listSort, onListSort }: {
  items: GiftListItem[]; loading: boolean; onSelect: (calcNo: string) => void; selectedCalcNo: string | null
  results: Record<string, RowResult>; running: Set<string>
  onRun: (calcNo: string) => void; onDetail: (calcNo: string) => void
  onShowProc: (info: { calcNo: string; nm: string; text: string | null }) => void
  listSort: SortState | null; onListSort: (s: SortState | null) => void
}) {
  const { hiddenDiffCodes } = useYearVerdict()
  const { sorted, sort, onSort } = useSortedList(items, listSort, onListSort)
  return (
    <table className="w-full min-w-max text-sm border-collapse">
      <thead className="sticky top-0 z-10 bg-muted">
        <tr className="border-b text-xs text-muted-foreground">
          <SortableTh label="이름" k="nm" sort={sort} onSort={onSort} className="text-left w-20" />
          <SortableTh label="사번" k="empNo" sort={sort} onSort={onSort} className="text-center w-20" />
          <SortableTh label="CALC_NO" k="calcNo" sort={sort} onSort={onSort} className="text-left w-28" />
          <SortableTh label="표준/특별" k="calcType" sort={sort} onSort={onSort} className="text-left w-24" />
          <SortableTh label="계속/퇴사" k="workStatus" sort={sort} onSort={onSort} className="text-left w-24" />
          <th className="px-1 py-2 text-center font-medium whitespace-nowrap w-10">계산</th>
          <th className="px-1 py-2 text-left font-medium w-16">소진지점</th>
          <SortableTh label="총급여" k="totPayAmt" sort={sort} onSort={onSort} className="text-right w-32" />
          <th className="px-3 py-2 text-center font-medium w-24">실행 / 분석</th>
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">항목</th>
          <th className="px-3 py-2 text-center font-medium whitespace-nowrap">연도</th>
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
          <tr><td colSpan={18} className="px-3 py-8 text-center text-sm text-muted-foreground">기부금 데이터가 없습니다.</td></tr>
        )}
        {sorted.map(row => {
          const res       = results[row.calcNo]
          const isRunning = running.has(row.calcNo)
          const hidden    = res ? hiddenDiffCodes(res, GIFT_CODES, row.lines.map(l => l.code).filter((c): c is string => !!c)) : []
          return (
            <Fragment key={row.calcNo}>
              {/* 본행 = 그룹 헤더(항목수만). 총액·판정은 검증화면에 불필요(시선 분산) → 검증정보는 세부행 유형×연도 self 대조가 담당. */}
              <tr onClick={() => onSelect(row.calcNo)} className={`cursor-default [&>td]:py-0 [&_button]:h-5 ${rowBg(res, row.calcNo === selectedCalcNo)}`}>
                <td className="px-3 py-2 whitespace-nowrap">{row.nm}</td>
                <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{row.empNo}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.calcNo}</td>
                <PersonMainCells item={row} onShowProc={onShowProc} />
                <td className="px-3 py-2 text-right tabular-nums">{won(row.totPayAmt)}</td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  <div className="flex items-center justify-center gap-1">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={isRunning} title="실행" onClick={() => onRun(row.calcNo)}>
                      {isRunning ? <Loader2 className="h-3 w-3 animate-spin text-red-600" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs disabled:opacity-100" disabled={!res} title="분석" onClick={() => onDetail(row.calcNo)}>
                      <FileSearch className={`h-3.5 w-3.5 ${res ? "" : "opacity-25"}`} />
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground" colSpan={2}><GroupHeader label="기부금" n={row.lines.length} />{hidden.length > 0 && <HiddenBadge n={hidden.length} />}</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">{res?.ranAt ?? "—"}</td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground">{res ? time(res.duration) : "—"}</td>
              </tr>
              {/* 유형×연도 세부행 */}
              {row.lines.map((line, i) => {
                const ntsVal = res && line.code ? (res.ntsMap[line.code] ?? 0) : null
                const d = ntsVal != null ? ntsVal - line.ytsSub : null
                const last = i === row.lines.length - 1
                // 색 최소화: 항목=정치/고향 청·특례 녹·우리사주 보라, 연도=이월 보라, 금액은 무색. (대조컬럼 불일치만 적색)
                const labelCls = GIFT_TYPE_HL[line.giftCls] ?? "text-muted-foreground"
                const yearCls  = line.carried ? "text-purple-600 font-semibold" : "text-muted-foreground"
                return (
                  <tr key={`${line.giftCls}-${line.giftYy}`} className={`${last ? "border-b" : ""} text-xs`}>
                    <td colSpan={9} />
                    <td className={`px-3 py-1 whitespace-nowrap ${labelCls}`}>{line.label}</td>
                    <td className={`px-3 py-1 text-center tabular-nums ${yearCls}`}>{line.giftYy}</td>
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
              {/* 드로어 ③표 ✗ 인데 세부행에 없던 코드 = 숨은 불일치 → 빨간 경고행으로 강제 노출 */}
              {res && hidden.map(code => <HiddenDiffRow key={`hidden-${code}`} code={code} res={res} leftSpan={9} labelSpan={2} rightSpan={2} />)}
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
function CardTable({ items, loading, results, running, onRun, onDetail, onShowProc, onSelect, selectedCalcNo, listSort, onListSort }: {
  items: CardListItem[]; loading: boolean; onSelect: (calcNo: string) => void; selectedCalcNo: string | null
  results: Record<string, RowResult>; running: Set<string>
  onRun: (calcNo: string) => void; onDetail: (calcNo: string) => void
  onShowProc: (info: { calcNo: string; nm: string; text: string | null }) => void
  listSort: SortState | null; onListSort: (s: SortState | null) => void
}) {
  const { sorted, sort, onSort } = useSortedList(items, listSort, onListSort)
  return (
    <table className="w-full min-w-max text-sm border-collapse">
      <thead className="sticky top-0 z-10 bg-muted">
        <tr className="border-b text-xs text-muted-foreground">
          <SortableTh label="이름" k="nm" sort={sort} onSort={onSort} className="text-left w-20" />
          <SortableTh label="사번" k="empNo" sort={sort} onSort={onSort} className="text-center w-20" />
          <SortableTh label="CALC_NO" k="calcNo" sort={sort} onSort={onSort} className="text-left w-28" />
          <SortableTh label="표준/특별" k="calcType" sort={sort} onSort={onSort} className="text-left w-24" />
          <SortableTh label="계속/퇴사" k="workStatus" sort={sort} onSort={onSort} className="text-left w-24" />
          <th className="px-1 py-2 text-center font-medium whitespace-nowrap w-10">계산</th>
          <th className="px-1 py-2 text-left font-medium w-16">소진지점</th>
          <SortableTh label="총급여" k="totPayAmt" sort={sort} onSort={onSort} className="text-right w-32" />
          <th className="px-3 py-2 text-center font-medium w-24">실행 / 분석</th>
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
          <tr><td colSpan={17} className="px-3 py-8 text-center text-sm text-muted-foreground">신용카드 데이터가 없습니다.</td></tr>
        )}
        {sorted.map(row => {
          const res       = results[row.calcNo]
          const isRunning = running.has(row.calcNo)
          const ntsDdc    = res ? (res.ntsMap[CARD_SUBTOTAL_CODE] ?? 0) : null
          const diff      = ntsDdc != null ? ntsDdc - row.cardDdc : null
          const useTotal  = row.lines.reduce((s, l) => s + l.useAmt, 0)
          return (
            <Fragment key={row.calcNo}>
              {/* 본행 = 카드공제 소계 */}
              <tr onClick={() => onSelect(row.calcNo)} className={`cursor-default [&>td]:py-0 [&_button]:h-5 ${rowBg(res, row.calcNo === selectedCalcNo)}`}>
                <td className="px-3 py-2 whitespace-nowrap">{row.nm}</td>
                <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{row.empNo}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.calcNo}</td>
                <PersonMainCells item={row} onShowProc={onShowProc} />
                <td className="px-3 py-2 text-right tabular-nums">{won(row.totPayAmt)}</td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  <div className="flex items-center justify-center gap-1">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={isRunning} title="실행" onClick={() => onRun(row.calcNo)}>
                      {isRunning ? <Loader2 className="h-3 w-3 animate-spin text-red-600" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs disabled:opacity-100" disabled={!res} title="분석" onClick={() => onDetail(row.calcNo)}>
                      <FileSearch className={`h-3.5 w-3.5 ${res ? "" : "opacity-25"}`} />
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap font-bold">카드공제 소계</td>
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
                    <td colSpan={9} />
                    <td className="px-3 py-1 text-muted-foreground whitespace-nowrap">
                      {line.label}
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
function MediTable({ items, loading, results, running, onRun, onDetail, onShowProc, onSelect, selectedCalcNo, listSort, onListSort }: {
  items: MediListItem[]; loading: boolean; onSelect: (calcNo: string) => void; selectedCalcNo: string | null
  results: Record<string, RowResult>; running: Set<string>
  onRun: (calcNo: string) => void; onDetail: (calcNo: string) => void
  onShowProc: (info: { calcNo: string; nm: string; text: string | null }) => void
  listSort: SortState | null; onListSort: (s: SortState | null) => void
}) {
  const { sorted, sort, onSort } = useSortedList(items, listSort, onListSort)
  return (
    <table className="w-full min-w-max text-sm border-collapse">
      <thead className="sticky top-0 z-10 bg-muted">
        <tr className="border-b text-xs text-muted-foreground">
          <SortableTh label="이름" k="nm" sort={sort} onSort={onSort} className="text-left w-20" />
          <SortableTh label="사번" k="empNo" sort={sort} onSort={onSort} className="text-center w-20" />
          <SortableTh label="CALC_NO" k="calcNo" sort={sort} onSort={onSort} className="text-left w-28" />
          <SortableTh label="표준/특별" k="calcType" sort={sort} onSort={onSort} className="text-left w-24" />
          <SortableTh label="계속/퇴사" k="workStatus" sort={sort} onSort={onSort} className="text-left w-24" />
          <th className="px-1 py-2 text-center font-medium whitespace-nowrap w-10">계산</th>
          <th className="px-1 py-2 text-left font-medium w-16">소진지점</th>
          <SortableTh label="총급여" k="totPayAmt" sort={sort} onSort={onSort} className="text-right w-32" />
          <th className="px-3 py-2 text-center font-medium w-24">실행 / 분석</th>
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">항목</th>
          <th className="px-3 py-2 text-right font-medium whitespace-nowrap">fmly_dtl집계</th>
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
          <tr><td colSpan={18} className="px-3 py-8 text-center text-sm text-muted-foreground">의료비 데이터가 없습니다.</td></tr>
        )}
        {sorted.map(row => {
          const res       = results[row.calcNo]
          const isRunning = running.has(row.calcNo)
          const ntsDdc    = res ? (res.ntsMap[MEDI_SUBTOTAL_CODE] ?? 0) : null
          const diff      = ntsDdc != null ? ntsDdc - row.mediDdc : null
          const useTotal  = row.lines.reduce((s, l) => s + l.useAmt, 0)
          const selfTotal = row.lines.reduce((s, l) => s + l.selfAmt, 0)   // 자체집계 총합(원천 독립 재집계)
          return (
            <Fragment key={row.calcNo}>
              {/* 본행 = 의료비 세액공제 소계 */}
              <tr onClick={() => onSelect(row.calcNo)} className={`cursor-default [&>td]:py-0 [&_button]:h-5 ${rowBg(res, row.calcNo === selectedCalcNo)}`}>
                <td className="px-3 py-2 whitespace-nowrap">{row.nm}</td>
                <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{row.empNo}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.calcNo}</td>
                <PersonMainCells item={row} onShowProc={onShowProc} />
                <td className="px-3 py-2 text-right tabular-nums">{won(row.totPayAmt)}</td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  <div className="flex items-center justify-center gap-1">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={isRunning} title="실행" onClick={() => onRun(row.calcNo)}>
                      {isRunning ? <Loader2 className="h-3 w-3 animate-spin text-red-600" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs disabled:opacity-100" disabled={!res} title="분석" onClick={() => onDetail(row.calcNo)}>
                      <FileSearch className={`h-3.5 w-3.5 ${res ? "" : "opacity-25"}`} />
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap font-bold">의료비공제 소계</td>
                <td className={`px-3 py-2 text-right tabular-nums ${selfTotal !== useTotal ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>{won(selfTotal)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${selfTotal !== useTotal ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>{won(useTotal)}</td>
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
                // 특이 항목 강조는 항목명만 — 난임=청색·미숙아=녹색(청→녹→보라 순). 적색계통은 오류 전용이라 회피.
                const hi = line.code === "8725" ? "text-blue-600 font-semibold" : line.code === "8729" ? "text-green-600 font-semibold" : ""
                // 대조a 불일치(오류)만 적색. 금액 자체는 강조색 없이 본연 색상 유지.
                const amtCls = line.selfAmt !== line.useAmt ? "text-red-600 font-semibold" : ""
                return (
                  <tr key={line.code} className={`${last ? "border-b" : ""} text-xs`}>
                    <td colSpan={9} />
                    <td className={`px-3 py-1 whitespace-nowrap ${hi || "text-muted-foreground"}`}>
                      {line.label}
                    </td>
                    {/* fmly_dtl집계 = 원천 FMLY_DTL 독립 재집계 (전송값과 나란히 대조) */}
                    <td className={`px-3 py-1 text-right tabular-nums ${amtCls}`}
                        title="검증도구 fmly_dtl 집계 — 원천(FMLY_DTL)에서 실손차감·유형분류 독립 재집계">
                      {won(line.selfAmt)}
                    </td>
                    <td className={`px-3 py-1 text-right tabular-nums ${amtCls}`}>{won(line.useAmt)}</td>
                    <td /><td />
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
function EtcTable({ items, loading, results, running, onRun, onDetail, onShowProc, onSelect, selectedCalcNo, listSort, onListSort }: {
  items: EtcListItem[]; loading: boolean; onSelect: (calcNo: string) => void; selectedCalcNo: string | null
  results: Record<string, RowResult>; running: Set<string>
  onRun: (calcNo: string) => void; onDetail: (calcNo: string) => void
  onShowProc: (info: { calcNo: string; nm: string; text: string | null }) => void
  listSort: SortState | null; onListSort: (s: SortState | null) => void
}) {
  const { hiddenDiffCodes } = useYearVerdict()
  const { sorted, sort, onSort } = useSortedList(items, listSort, onListSort)
  return (
    <table className="w-full min-w-max text-sm border-collapse">
      <thead className="sticky top-0 z-10 bg-muted">
        <tr className="border-b text-xs text-muted-foreground">
          <SortableTh label="이름" k="nm" sort={sort} onSort={onSort} className="text-left w-20" />
          <SortableTh label="사번" k="empNo" sort={sort} onSort={onSort} className="text-center w-20" />
          <SortableTh label="CALC_NO" k="calcNo" sort={sort} onSort={onSort} className="text-left w-28" />
          <SortableTh label="표준/특별" k="calcType" sort={sort} onSort={onSort} className="text-left w-24" />
          <SortableTh label="계속/퇴사" k="workStatus" sort={sort} onSort={onSort} className="text-left w-24" />
          <th className="px-1 py-2 text-center font-medium whitespace-nowrap w-10">계산</th>
          <th className="px-1 py-2 text-left font-medium w-16">소진지점</th>
          <SortableTh label="총급여" k="totPayAmt" sort={sort} onSort={onSort} className="text-right w-32" />
          <th className="px-3 py-2 text-center font-medium w-24">실행 / 분석</th>
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
          <tr><td colSpan={17} className="px-3 py-8 text-center text-sm text-muted-foreground">기타 세액공제 데이터가 없습니다.</td></tr>
        )}
        {sorted.map(row => {
          const res       = results[row.calcNo]
          const isRunning = running.has(row.calcNo)
          const hidden    = res ? hiddenDiffCodes(res, items.flatMap(i => i.lines.map(l => l.code)).filter((c): c is string => !!c), row.lines.map(l => l.code).filter((c): c is string => !!c)) : []
          return (
            <Fragment key={row.calcNo}>
              {/* 본행 = 그룹 헤더(항목수만). 총액·판정은 검증화면에 불필요(시선 분산) → 검증정보는 세부행 항목별 self 대조가 담당. */}
              <tr onClick={() => onSelect(row.calcNo)} className={`cursor-default [&>td]:py-0 [&_button]:h-5 ${rowBg(res, row.calcNo === selectedCalcNo)}`}>
                <td className="px-3 py-2 whitespace-nowrap">{row.nm}</td>
                <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{row.empNo}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.calcNo}</td>
                <PersonMainCells item={row} onShowProc={onShowProc} />
                <td className="px-3 py-2 text-right tabular-nums">{won(row.totPayAmt)}</td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  <div className="flex items-center justify-center gap-1">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={isRunning} title="실행" onClick={() => onRun(row.calcNo)}>
                      {isRunning ? <Loader2 className="h-3 w-3 animate-spin text-red-600" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs disabled:opacity-100" disabled={!res} title="분석" onClick={() => onDetail(row.calcNo)}>
                      <FileSearch className={`h-3.5 w-3.5 ${res ? "" : "opacity-25"}`} />
                    </Button>
                  </div>
                </td>
                {/* 기타 탭은 드롭다운으로 한 항목만 필터 → 헤더도 그 항목명(월세액 등)으로. 다중이면 "기타" 폴백. */}
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap"><GroupHeader label={row.lines.length === 1 ? row.lines[0].label : "기타"} n={row.lines.length} />{hidden.length > 0 && <HiddenBadge n={hidden.length} />}</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
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
                    <td colSpan={9} />
                    <td className="px-3 py-1 text-muted-foreground whitespace-nowrap">
                      {line.label}
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
              {res && hidden.map(code => <HiddenDiffRow key={`hidden-${code}`} code={code} res={res} leftSpan={9} labelSpan={1} rightSpan={2} />)}
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
function PensionTable({ items, loading, results, running, onRun, onDetail, onShowProc, onSelect, selectedCalcNo, listSort, onListSort }: {
  items: PensionListItem[]; loading: boolean; onSelect: (calcNo: string) => void; selectedCalcNo: string | null
  results: Record<string, RowResult>; running: Set<string>
  onRun: (calcNo: string) => void; onDetail: (calcNo: string) => void
  onShowProc: (info: { calcNo: string; nm: string; text: string | null }) => void
  listSort: SortState | null; onListSort: (s: SortState | null) => void
}) {
  const { hiddenDiffCodes } = useYearVerdict()
  const { sorted, sort, onSort } = useSortedList(items, listSort, onListSort)
  return (
    <table className="w-full min-w-max text-sm border-collapse">
      <thead className="sticky top-0 z-10 bg-muted">
        <tr className="border-b text-xs text-muted-foreground">
          <SortableTh label="이름" k="nm" sort={sort} onSort={onSort} className="text-left w-20" />
          <SortableTh label="사번" k="empNo" sort={sort} onSort={onSort} className="text-center w-20" />
          <SortableTh label="CALC_NO" k="calcNo" sort={sort} onSort={onSort} className="text-left w-28" />
          <SortableTh label="표준/특별" k="calcType" sort={sort} onSort={onSort} className="text-left w-24" />
          <SortableTh label="계속/퇴사" k="workStatus" sort={sort} onSort={onSort} className="text-left w-24" />
          <th className="px-1 py-2 text-center font-medium whitespace-nowrap w-10">계산</th>
          <th className="px-1 py-2 text-left font-medium w-16">소진지점</th>
          <SortableTh label="총급여" k="totPayAmt" sort={sort} onSort={onSort} className="text-right w-32" />
          <th className="px-3 py-2 text-center font-medium w-24">실행 / 분석</th>
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
          <tr><td colSpan={17} className="px-3 py-8 text-center text-sm text-muted-foreground">연금계좌 데이터가 없습니다.</td></tr>
        )}
        {sorted.map(row => {
          const res       = results[row.calcNo]
          const isRunning = running.has(row.calcNo)
          const hidden    = res ? hiddenDiffCodes(res, items.flatMap(i => i.lines.map(l => l.code)).filter((c): c is string => !!c), row.lines.map(l => l.code).filter((c): c is string => !!c)) : []
          return (
            <Fragment key={row.calcNo}>
              {/* 본행 = 그룹 헤더(항목수만). 총액·판정은 검증화면에 불필요(시선 분산) → 검증정보는 세부행 self 대조가 담당. */}
              <tr onClick={() => onSelect(row.calcNo)} className={`cursor-default [&>td]:py-0 [&_button]:h-5 ${rowBg(res, row.calcNo === selectedCalcNo)}`}>
                <td className="px-3 py-2 whitespace-nowrap">{row.nm}</td>
                <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{row.empNo}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.calcNo}</td>
                <PersonMainCells item={row} onShowProc={onShowProc} />
                <td className="px-3 py-2 text-right tabular-nums">{won(row.totPayAmt)}</td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  <div className="flex items-center justify-center gap-1">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={isRunning} title="실행" onClick={() => onRun(row.calcNo)}>
                      {isRunning ? <Loader2 className="h-3 w-3 animate-spin text-red-600" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs disabled:opacity-100" disabled={!res} title="분석" onClick={() => onDetail(row.calcNo)}>
                      <FileSearch className={`h-3.5 w-3.5 ${res ? "" : "opacity-25"}`} />
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap"><GroupHeader label="연금계좌" n={row.lines.length} />{hidden.length > 0 && <HiddenBadge n={hidden.length} />}</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">{res?.ranAt ?? "—"}</td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground">{res ? time(res.duration) : "—"}</td>
              </tr>
              {/* 세부행 = 종류별 self 대조 (전송 납입액 + YTS공제 ↔ NTS) */}
              {row.lines.map((line, i) => {
                const last   = i === row.lines.length - 1
                const ntsVal = res ? (res.ntsMap[line.code] ?? null) : null
                const ldiff  = ntsVal != null ? ntsVal - line.ytsDdc : null
                // ISA만기 추가납입(8707 퇴직연금·8708 연금저축)은 강조색(indigo)으로 — 연금계좌 리스트에서 순수 연금(8701~8703)과 구분
                const isa    = line.code === "8707" || line.code === "8708"
                return (
                  <tr key={line.code} className={`${last ? "border-b" : ""} text-xs`}>
                    <td colSpan={9} />
                    <td className={`px-3 py-1 whitespace-nowrap ${isa ? "text-indigo-600 font-semibold" : "text-muted-foreground"}`}>
                      {line.label}
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
              {res && hidden.map(code => <HiddenDiffRow key={`hidden-${code}`} code={code} res={res} leftSpan={9} labelSpan={1} rightSpan={2} />)}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

// 인적공제 그룹 = 본인 제외, 배우자·부양가족·추가공제(소득공제) + 혼인·자녀·출산(세액공제) 항목별 대조.
// 소득/세액 혼재라 소계 합산은 무의미 → 본행은 "N항목 중 M 불일치" 요약, 세부행이 항목별 YTS↔NTS 판정.
function PersonalTable({ items, title, loading, results, running, onRun, onDetail, onShowProc, onSelect, selectedCalcNo, listSort, onListSort }: {
  items: PersonalListItem[]; title: string; loading: boolean; onSelect: (calcNo: string) => void; selectedCalcNo: string | null
  results: Record<string, RowResult>; running: Set<string>
  onRun: (calcNo: string) => void; onDetail: (calcNo: string) => void
  onShowProc: (info: { calcNo: string; nm: string; text: string | null }) => void
  listSort: SortState | null; onListSort: (s: SortState | null) => void
}) {
  const { hiddenDiffCodes } = useYearVerdict()
  const showInput = items.some(it => it.lines.some(l => l.ytsInput != null))   // 전송 사용액(납입액) 있는 그룹만 컬럼 표시
  const { sorted, sort, onSort } = useSortedList(items, listSort, onListSort)
  return (
    <table className="w-full min-w-max text-sm border-collapse">
      <thead className="sticky top-0 z-10 bg-muted">
        <tr className="border-b text-xs text-muted-foreground">
          <SortableTh label="이름" k="nm" sort={sort} onSort={onSort} className="text-left w-20" />
          <SortableTh label="사번" k="empNo" sort={sort} onSort={onSort} className="text-center w-20" />
          <SortableTh label="CALC_NO" k="calcNo" sort={sort} onSort={onSort} className="text-left w-28" />
          <SortableTh label="표준/특별" k="calcType" sort={sort} onSort={onSort} className="text-left w-24" />
          <SortableTh label="계속/퇴사" k="workStatus" sort={sort} onSort={onSort} className="text-left w-24" />
          <th className="px-1 py-2 text-center font-medium whitespace-nowrap w-10">계산</th>
          <th className="px-1 py-2 text-left font-medium w-16">소진지점</th>
          <SortableTh label="총급여" k="totPayAmt" sort={sort} onSort={onSort} className="text-right w-32" />
          <th className="px-3 py-2 text-center font-medium w-24">실행 / 분석</th>
          <th className="px-3 py-2 text-left font-medium whitespace-nowrap">항목</th>
          {showInput && <th className="px-3 py-2 text-right font-medium whitespace-nowrap">전송 사용액</th>}
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
          <tr><td colSpan={showInput ? 17 : 16} className="px-3 py-8 text-center text-sm text-muted-foreground">{title} 데이터가 없습니다.</td></tr>
        )}
        {sorted.map(row => {
          const res       = results[row.calcNo]
          const isRunning = running.has(row.calcNo)
          const hidden    = res ? hiddenDiffCodes(res, items.flatMap(i => i.lines.map(l => l.code)).filter((c): c is string => !!c), row.lines.map(l => l.code).filter((c): c is string => !!c)) : []
          return (
            <Fragment key={row.calcNo}>
              {/* 본행 = 대상 요약(항목수). 소득/세액 혼재라 공제액 합산은 표시 안 함 → 비교값이 없어 일치/차이 판정도 비움(세부행이 항목별 판정 담당). */}
              <tr onClick={() => onSelect(row.calcNo)} className={`cursor-default [&>td]:py-0 [&_button]:h-5 ${rowBg(res, row.calcNo === selectedCalcNo)}`}>
                <td className="px-3 py-2 whitespace-nowrap">{row.nm}</td>
                <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{row.empNo}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.calcNo}</td>
                <PersonMainCells item={row} onShowProc={onShowProc} />
                <td className="px-3 py-2 text-right tabular-nums">{won(row.totPayAmt)}</td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  <div className="flex items-center justify-center gap-1">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={isRunning} title="실행" onClick={() => onRun(row.calcNo)}>
                      {isRunning ? <Loader2 className="h-3 w-3 animate-spin text-red-600" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs disabled:opacity-100" disabled={!res} title="분석" onClick={() => onDetail(row.calcNo)}>
                      <FileSearch className={`h-3.5 w-3.5 ${res ? "" : "opacity-25"}`} />
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap"><GroupHeader label={title} n={row.lines.length} />{hidden.length > 0 && <HiddenBadge n={hidden.length} />}</td>
                {showInput && <td className="px-3 py-2" />}
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                {/* 본행은 공제값을 표시하지 않아(합산 무의미 그룹) 비교 대상이 없음 → 일치/차이 판정은 세부행이 담당, 본행은 비움 */}
                <td className="px-3 py-2" />
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">{res?.ranAt ?? "—"}</td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground">{res ? time(res.duration) : "—"}</td>
              </tr>
              {/* 세부행 = 항목별 YTS 공제 ↔ NTS ntsMap[code] */}
              {row.lines.map((line, i) => {
                const last   = i === row.lines.length - 1
                const ntsVal = res ? (res.ntsMap[line.code] ?? 0) : null
                // YTS 공제 = self 재계산 포함 단일원천(res.ytsDdcMap) 우선. 조특30제외 등 공유컬럼(RT_R_LAW)은
                //   SQL line.ytsDdc(합)가 아니라 코드별 self(ytsDdcMap)를 써야 함. 배치 전(res 없음)엔 SQL 폴백.
                const ytsD   = res ? (res.ytsDdcMap[line.code] ?? line.ytsDdc) : line.ytsDdc
                const ldiff  = ntsVal != null ? ntsVal - ytsD : null
                // 세부행 강조색(라벨만, 금액은 본연): 8711=violet, 주택임차(8311/8312)=cyan,
                //   부녀자(8103)·혼인세액공제(8790)=청, 한부모(8104)·출산입양(8761·8764~66)=녹. (적색계통은 오류 전용 회피)
                //   (리터럴 클래스 유지 — Tailwind JIT 퍼지 안전)
                const hiText = line.code === "8711" ? "text-violet-600 font-semibold"
                             : (line.code === "8311" || line.code === "8312") ? "text-cyan-600 font-semibold"
                             : (line.code === "8103" || line.code === "8790") ? "text-blue-600 font-semibold"
                             : (line.code === "8104" || line.code === "8761" || line.code === "8764" || line.code === "8765" || line.code === "8766") ? "text-green-600 font-semibold" : ""
                return (
                  <tr key={line.code} className={`${last ? "border-b" : ""} text-xs`}>
                    <td colSpan={9} />
                    <td className={`px-3 py-1 whitespace-nowrap ${hiText || "text-muted-foreground"}`}>
                      {line.label}
                    </td>
                    {showInput && <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">{line.birthBreakdown ?? (line.ytsInput != null ? won(line.ytsInput) : "—")}</td>}
                    <td className="px-3 py-1 text-right tabular-nums">{won(ytsD)}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{ntsVal != null ? won(ntsVal) : "—"}</td>
                    <td className="px-3 py-1 text-center">
                      <span className="inline-flex justify-center"><MatchIcon yts={ntsVal != null ? ytsD : null} nts={ntsVal} /></span>
                    </td>
                    <td className={`px-3 py-1 text-right tabular-nums ${ldiff != null && ldiff !== 0 ? "text-red-600 font-medium" : "text-muted-foreground/40"}`}>
                      {ldiff == null ? "—" : ldiff === 0 ? "0" : (ldiff > 0 ? "+" : "") + ldiff.toLocaleString("ko-KR")}
                    </td>
                    <td colSpan={2} />
                  </tr>
                )
              })}
              {res && hidden.map(code => <HiddenDiffRow key={`hidden-${code}`} code={code} res={res} leftSpan={9} labelSpan={1} hasInput={showInput} rightSpan={2} />)}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

// 리스트 테이블 React.memo 래퍼 — 무관한 상위 상태 변화(세션 30초 폴링·배치 진행·드로어 열기·procTexts 등)에
// 프롭이 그대로면 거대한 테이블(수백~수천 행) 리렌더를 건너뛴다.
// 프롭 안정화 전제: runCompare·showProc = useCallback, etcByCode = useMemo, 나머지 setter는 useState 고정.
const AllTableMemo      = memo(AllTable)
const GiftTableMemo     = memo(GiftTable)
const CardTableMemo     = memo(CardTable)
const MediTableMemo     = memo(MediTable)
const EtcTableMemo      = memo(EtcTable)
const PensionTableMemo  = memo(PensionTable)
const PersonalTableMemo = memo(PersonalTable)

// 실행과정의 접이식 영역(결과비교/전송한 공제입력/IN·OUT 대조) 공용 껍데기.
// 펼침 = flex-1(남는 영역끼리 공유) + 내부만 세로·가로 스크롤, 접힘 = 헤더만 남기고 다른 영역에 공간 양보.
// grow=false 면 내용 길이만큼만 차지(짧은 표에서 밑에 빈 여백 안 남게) — 나머지 flex-1 영역이 남는 공간을 가져간다.
function DetailPanel({ title, extra, rightExtra, collapsed, onToggle, onExpandOnly, maximized = false, grow = true, headerBg = "bg-background", children }: {
  title: string; extra?: ReactNode; rightExtra?: ReactNode; collapsed: boolean; onToggle?: () => void; onExpandOnly?: () => void; maximized?: boolean; grow?: boolean; headerBg?: string; children: ReactNode
}) {
  const expand = !collapsed && grow
  return (
    <div className={`flex flex-col border rounded-md overflow-hidden ${expand ? "flex-1 min-h-0" : "shrink-0"}`}>
      <div
        onClick={onToggle}
        onDoubleClick={onExpandOnly}
        title={onToggle ? "클릭: 접기/펼치기 · 더블클릭: 이 영역만 최대화" : "더블클릭: 이 영역만 전체보기(최대화)"}
        className={`flex items-center justify-between gap-2 px-3 py-2 ${headerBg} border-b text-xs font-semibold shrink-0 select-none ${onToggle || onExpandOnly ? "cursor-pointer" : ""}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="shrink-0">{title}</span>
          {extra}
        </span>
        {/* 오른쪽 컨트롤(rightExtra=전체보기/값보기 등 + 접기·최대화) — 클릭이 헤더 토글로 번지지 않게 정지 */}
        <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
          {rightExtra}
          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              title={collapsed ? "펼치기" : "접기"}
              className="p-0.5 rounded text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
            </button>
          )}
          {onExpandOnly && (
            <button
              type="button"
              onClick={onExpandOnly}
              title={maximized ? "원래대로" : "최대로 (이 영역만)"}
              className="p-0.5 rounded text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
            >
              {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>
      {!collapsed && <div className={expand ? "flex-1 min-h-0 overflow-auto" : "overflow-auto"}>{children}</div>}
    </div>
  )
}

// 비교 패널(①·③) 헤더 배지 — 색 범례 대신 불일치 건수. 0이면 무채색.
function MismatchBadge({ n }: { n: number }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${n > 0 ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"}`}>
      불일치 {n}건
    </span>
  )
}

// ── 상세조회 뷰 ──────────────────────────────────────────────────────────────
function DetailView({ res, row, calcNo, procOrder, nm, listCodes, ntsYear }: { res: RowResult; row: DetailRowLike | null; calcNo: string; procOrder?: string[]; nm?: string; listCodes?: string[]; ntsYear: string }) {
  const { mapping, procLabelCode } = getYearConfig(ntsYear)   // ②표 원천컬럼·③표 로스터 순서를 드롭다운 연도로 라우팅
  // 판정·정렬 단일원천(연도별 인스턴스) — 이름을 그대로 구조분해해 이하 코드는 무변경.
  const { MAP_ORDER, SUBTOTAL_OF, DDC_DOMAIN, ddcVerdict, diffCodesOf, hiddenDiffCodes, COMPOSITE_MEMBERS } = useYearVerdict()
  const codeLabel = useCodeLabel()
  const yts = res.yts
  const nts = res.nts
  const ok  = nts.resultCode === "S" || nts.resultCode === null
  const displayNm = nm ?? row?.nm

  // ── 리스트↔드로어 모순 감지기(dev 전용) ──────────────────────────────────
  // 불변식: 드로어 ③표에서 ✗(diff)인 코드 중 "YTS 가 공제를 배정한(ytsDdcMap 실재)" 코드는
  //   반드시 리스트 라인에도 보여야 한다. 어긋나면 = 한 화면 자기모순 → 사람이 오류를 못 찾는다.
  //   YTS 배정 없는 국세청 자체생성 코드(고향특별 8784 등)는 제외(정당한 편차, 리스트 라인 없음).
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !listCodes) return
    const hidden = hiddenDiffCodes(res, DDC_DOMAIN, listCodes)   // 전체 도메인 안전망(어느 탭에도 안 걸리는 코드 포착)
    if (hidden.length) console.warn(
      `[검증도구 모순] ${nm ?? calcNo}: 드로어 ③표 ✗ 인데 리스트에 없는 코드 → ${hidden.join(", ")}. ` +
      `리스트=드로어 판정이 갈리면 사람이 오류를 못 찾는다.`)
  }, [res, calcNo, nm, listCodes, hiddenDiffCodes, DDC_DOMAIN])

  // 3개 영역(결과비교/전송한 공제입력/IN·OUT) 접기 상태 — 기본 ①②접힘·③(IN·OUT)만 펼침
  const [collapsed, setCollapsed] = useState({ compare: true, inputs: true, io: false })
  // 더블클릭으로 "이 영역만 최대화" — 포커스된 영역은 grow(자기 기본값 무관) + 나머지는 접힘
  const [focusedPanel, setFocusedPanel] = useState<keyof typeof collapsed | null>(null)
  const toggle = (k: keyof typeof collapsed) => { setFocusedPanel(null); setCollapsed(c => ({ ...c, [k]: !c[k] })) }
  const expandOnly = (k: keyof typeof collapsed) => setFocusedPanel(p => (p === k ? null : k))
  const isCollapsed = (k: keyof typeof collapsed) => (focusedPanel ? k !== focusedPanel : collapsed[k])
  const isGrow = (k: keyof typeof collapsed, defaultGrow: boolean) => (focusedPanel ? k === focusedPanel : defaultGrow)
  // ③ 소계형(카드8430/의료8726/교육8735/출산8761/투자조합8410) 개별 멤버 접기 — 기본 펼침, chevron 으로 접기
  // displaySubtotal 표시전용 소계(부양가족 8003 등)도 소계로 취급 — SUBTOTAL_OF.values()에 그 소계코드가 있음.
  const displaySubCodes = useMemo(() => new Set(SUBTOTAL_OF.values()), [SUBTOTAL_OF])
  const [openSubs, setOpenSubs] = useState<Set<string>>(() => new Set([...SUBTOTAL_CODES.keys(), ...SUBTOTAL_OF.values()]))
  const toggleSub = (c: string) => setOpenSubs(s => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n })
  // ③ 전체보기(로스터+매핑 전 항목, 값 없으면 —) / 값보기(실제 값이 오간 코드만)
  const [ioShowAll, setIoShowAll] = useState(true)
  // ①②③ 리스트 행 클릭 선택 — 선택행 청색(hover 진청색) / 비선택행 hover 회색. key = "패널:코드"
  const [selRow, setSelRow] = useState<string | null>(null)
  const rowCls = (key: string, base = "") =>
    `cursor-pointer ${selRow === key ? "bg-blue-100 hover:bg-blue-200" : `${base} hover:bg-gray-200`}`

  // 8900(총급여)은 국세청 "입력" 코드라 ddcAmt(공제액)가 아니라 회신에 그대로 echo 된 useAmt를 대조값으로 쓴다.
  const totPayNts = res.ntsOut.find(r => r.code === "8900")?.useAmt ?? null

  // 계산 흐름 순서(총급여→결정세액) 그대로 YTS39·NTS 값을 나란히 대조 — 어느 단계에서 갈렸는지 바로 보임
  //   소득공제 = 총급여−과세표준(양변 직접 계산, 자기정합). 단일 컬럼/코드가 없어 파생: 근로소득공제+종합소득공제 포함(실데이터 485/485 검증).
  const ytsTotPay   = yts?.totPayAmt ?? row?.totPayAmt ?? null
  const ytsTaxBase  = yts?.taxBase ?? null
  const ntsTaxBase  = res.ntsMap["8903"] ?? null
  const ytsIncomeDdc = ytsTotPay != null && ytsTaxBase != null ? ytsTotPay - ytsTaxBase : null
  const ntsIncomeDdc = totPayNts != null && ntsTaxBase != null ? totPayNts - ntsTaxBase : null
  const compareRows: { label: string; code: string; ytsCol: string; yts: number | null; nts: number | null }[] = [
    { label: "총급여",   code: "8900", ytsCol: "TOT_PAY_AMT",    yts: ytsTotPay,                                  nts: totPayNts },
    { label: "소득공제", code: "",     ytsCol: "총급여−과세표준", yts: ytsIncomeDdc,                               nts: ntsIncomeDdc },
    { label: "과세표준", code: "8903", ytsCol: "TOT_PTB",        yts: ytsTaxBase,                                 nts: ntsTaxBase },
    { label: "산출세액", code: "8990", ytsCol: "PROD_TAX_AMT",   yts: yts?.prodTaxAmt ?? row?.prodTaxAmt ?? null, nts: res.ntsMap["8990"] ?? null },
    // 근로소득세액공제(8700)는 ③표로 이동(2026-08-05) — 계산과정 로스터 순서(세액공제 항목들 사이)에서 self 대조.
    //   국세청 자체계산 OUT ↔ YTS RT_WIA(mapping 8700 resultCol). ①표엔 더 안 둠(계산과정↔실행과정③ 정합).
    { label: "세액감면", code: "8924", ytsCol: "TAX_CUT",        yts: yts?.taxCut ?? null,                        nts: res.ntsMap["8924"] ?? null },
    { label: "세액공제", code: "8923", ytsCol: "RT_SUM",         yts: yts?.rtSum ?? null,                         nts: res.ntsMap["8923"] ?? null },
    { label: "결정세액", code: "8999", ytsCol: "RES_INCM_TAX",   yts: yts?.resIncmTax ?? row?.resIncmTax ?? null, nts: res.ntsMap["8999"] ?? null },
  ]
  const compareCodes = new Set(compareRows.map(r => r.code))   // ①결과비교에 나오는 계산흐름 코드(8900~8999·8700) — ③표에서 중복 제거

  // NTS 원본 IN/OUT 코드 union (전송 payload ∪ 회신) — 코드별 전 필드 대조
  const ioMap = new Map<string, { i?: NtsIoRow; o?: NtsIoRow }>()
  res.ntsIn.forEach(r => ioMap.set(r.code, { ...ioMap.get(r.code), i: r }))
  res.ntsOut.forEach(r => ioMap.set(r.code, { ...ioMap.get(r.code), o: r }))
  // 정렬: 계산과정 등장 순서(procOrder) 우선. 소계 멤버는 소계코드 위치 바로 뒤 블록으로 묶음.
  //   앵커 = [계산과정위치, 계층(0=소계/직접 · 1=소계멤버), 코드]. 계산과정에 없으면 맨 뒤 코드순.
  // ③표 항목 = MAPPING_2025 정의 항목만(국세청 내부 코드 제외). mapOrder 는 항목 필터 + tie-break 용.
  const mapOrder = MAP_ORDER   // 판정·정렬 단일원천(모듈 상수)
  // ③표 순서 = 현황 '계산과정 순서 로스터'와 동일(PROC_LABEL_CODE_2025 등장순). 소계 멤버는 소계코드 위치 바로 뒤.
  const rosterOrder = new Map<string, number>()
  Object.values(procLabelCode).forEach((code, i) => { if (!rosterOrder.has(code)) rosterOrder.set(code, i) })
  const anchorOf = (c: string): [number, number, string] => {
    const di = rosterOrder.get(c)
    if (di != null) return [di, 0, c]                                             // 로스터(계산과정) 순서
    const sub = SUBTOTAL_OF.get(c)
    if (sub) { const si = rosterOrder.get(sub); if (si != null) return [si, 1, c] }   // 소계 멤버는 소계코드 뒤
    const gb = GIFT_CARRY_BASE[c]
    if (gb) { const gi = rosterOrder.get(gb); if (gi != null) return [gi, 1, c] }  // 이월 기부금은 당해 유형(base) 뒤(코드순 -1년,-2년…)
    return [Number.MAX_SAFE_INTEGER, mapOrder.get(c) ?? 0, c]                     // 로스터에 없는 매핑항목은 맨 뒤(매핑순)
  }
  // 전체보기: 매핑+소계 전 항목(값 없으면 —). 값보기: IN(전송) 또는 공제(YTS/NTS ddcAmt)가 있는 코드만 —
  //   OUT의 대상(ddcTrgtAmt)·한도(ddcLmtAmt)·인원(incDdcNfpCnt)만 있고 IN·공제가 없는 코드는 제외. 둘 다 매핑 밖 제외.
  const ioBaseCodes = ioShowAll
    ? new Set<string>([...mapOrder.keys(), ...SUBTOTAL_CODES.keys()])
    : new Set<string>([...ioMap.keys()].filter(code => {
        const io = ioMap.get(code)
        const hasIn  = !!(io?.i && (io.i.useAmt || io.i.incDdcNfpCnt || io.i.ddcTrgtAmt))   // 전송(IN)
        const hasDdc = !!io?.o?.ddcAmt || !!res.ytsDdcMap[code]                              // 공제(NTS ddcAmt / YTS)
        return hasIn || hasDdc
      }))
  const ioRows = [...ioBaseCodes]
    .filter(code => mapOrder.has(code) || SUBTOTAL_CODES.has(code))
    .map(code => ({ code, i: ioMap.get(code)?.i, o: ioMap.get(code)?.o }))
    .sort((a, b) => { const x = anchorOf(a.code), y = anchorOf(b.code); return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]) })
  const ioNum = (n?: number) => (n ? n.toLocaleString("ko-KR") : "—")
  // 로스터(계산과정)에 있는 항목은 위, 없는 매핑항목은 "기타" 구분행 아래로. 소계 멤버는 소계코드로 판정.
  const isRosterItem = (c: string): boolean => {
    if (rosterOrder.has(c)) return true
    const sub = SUBTOTAL_OF.get(c)
    if (sub != null && rosterOrder.has(sub)) return true
    const gb = GIFT_CARRY_BASE[c]                                                  // 이월 기부금은 당해 유형(base)이 로스터에 있으면 로스터 항목으로 간주
    return gb != null && rosterOrder.has(gb)
  }
  const firstEtcCode = ioRows.find(r => {
    const sp = SUBTOTAL_OF.get(r.code)
    if (sp && !openSubs.has(sp)) return false                                     // 접힌 소계 멤버는 표시 안 됨
    if (compareCodes.has(r.code)) return false                                    // ①중복 제외분
    if (!mapOrder.has(r.code) && !SUBTOTAL_CODES.has(r.code)) return false        // 매핑 밖 제외분
    return !isRosterItem(r.code)
  })?.code
  // ② YTS 원천 표시용: code → 물리 원천컬럼(전송값 ytsInOf) / 물리 공제컬럼(ytsOutOf). 가상변수(CARD_/CUT_ 등)는 실제 테이블 컬럼으로 환원.
  const ytsColOf = new Map<string, string>()
  const resultColOf = new Map<string, string>()
  mapping.forEach(m => {
    if (m.ytsCol && !ytsColOf.has(m.ntsCode)) ytsColOf.set(m.ntsCode, ytsSrcWithTable(m))
    const oc = m.outCode ?? m.ntsCode
    if (m.resultCol && !resultColOf.has(oc)) resultColOf.set(oc, ytsOutWithTable(m))
  })
  SUBTOTAL_CODES.forEach((v, code) => { if (!resultColOf.has(code)) resultColOf.set(code, "calc." + v.ytsOut) })
  // ② 전용 정렬: 매핑(MAPPING_2025) 정의 순서(그룹별). 소계코드는 멤버 바로 앞. ③(로스터)과 달리 '기타' 분리 없음.
  const anchorMap = (c: string): [number, number, string] => {
    const di = mapOrder.get(c)
    if (di != null) return [di, 1, c]
    if (SUBTOTAL_CODES.has(c)) {
      let min = Infinity
      for (const [mem, sub] of SUBTOTAL_OF) if (sub === c) { const mo = mapOrder.get(mem); if (mo != null && mo < min) min = mo }
      if (min < Infinity) return [min, 0, c]
    }
    return [Number.MAX_SAFE_INTEGER, 0, c]
  }
  const ioRowsByMap = [...ioRows].sort((a, b) => { const x = anchorMap(a.code), y = anchorMap(b.code); return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]) })

  // ① 결과비교 불일치 건수 (계산흐름 8행 중 차이≠0)
  const compareDiffCount = compareRows.filter(r => r.yts != null && r.nts != null && r.nts - r.yts !== 0).length

  // 백단위(코드 8XYZ 의 XY, 예 8201→82) 그룹이 바뀌는 행 = 굵은 윗선 대상. ②③표에서 그룹 경계 시각 구분.
  //   ②③ map 과 동일한 표시 조건(계산흐름 중복·매핑밖·접힌 소계 제외)으로 실제 보이는 행만 대상.
  const bucketBreaks = (rows: { code: string }[]): Set<string> => {
    const set = new Set<string>(); let prev: number | null = null
    for (const { code } of rows) {
      if (compareCodes.has(code)) continue
      if (!mapOrder.has(code) && !SUBTOTAL_CODES.has(code)) continue
      const sp = SUBTOTAL_OF.get(code); if (sp && !openSubs.has(sp)) continue
      const b = Math.floor(Number(code) / 100)
      if (prev != null && b !== prev) set.add(code)
      prev = b
    }
    return set
  }
  const ioBreakMap = bucketBreaks(ioRowsByMap)   // ② 매핑순
  const ioBreak    = bucketBreaks(ioRows)         // ③ 계산과정(로스터)순
  // ③ NTS IN/OUT 대조 불일치 건수 — ddcVerdict 단일원천(리스트 배지와 동일 규칙 → 항상 일치)
  const ioDiffCount = diffCodesOf(res, [...mapOrder.keys(), ...SUBTOTAL_CODES.keys()]).length

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="border-b px-4 py-3 pr-12 shrink-0">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="font-mono text-sm">{calcNo}</span>
          {displayNm && <span className="text-foreground">{displayNm}</span>}
          <span className="text-muted-foreground text-sm font-normal">실행과정</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
            응답 {nts.resultCode ?? "—"}
          </span>
          <span className="text-muted-foreground text-xs font-normal">
            {res.ranAt} · {time(res.duration)}
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-3 px-4 py-3 overflow-hidden">
        {/* 1) 결과 비교 */}
        <DetailPanel title="① 결과 비교 (YTS ↔ NTS)" extra={<MismatchBadge n={compareDiffCount} />} collapsed={isCollapsed("compare")} onToggle={() => toggle("compare")} onExpandOnly={() => expandOnly("compare")} maximized={focusedPanel === "compare"} grow={isGrow("compare", false)}>
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b text-[11px] text-muted-foreground">
                <th className="py-1.5 px-3 text-left font-medium">항목</th>
                <th className="py-1.5 px-3 text-right font-medium">필드명</th>
                <th className="py-1.5 px-3 text-right font-medium">YTS</th>
                <th className="py-1.5 px-3 text-right font-medium">NTS</th>
                <th className="py-1.5 px-3 text-right font-medium w-14">차이</th>
              </tr>
            </thead>
            <tbody>
              {compareRows.map(r => {
                const diff = r.yts != null && r.nts != null ? r.nts - r.yts : null
                return (
                  <tr key={r.code} onClick={() => setSelRow(`c:${r.code}`)} className={`border-b last:border-0 ${rowCls(`c:${r.code}`)}`}>
                    <td className="py-1.5 px-3">
                      {r.label}
                      <span className="ml-1 font-mono text-[10px] text-muted-foreground/50">{r.code}</span>
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono text-[10px] text-muted-foreground/50 whitespace-nowrap">{r.ytsCol}</td>
                    <td className={`py-1.5 px-3 text-right tabular-nums ${diff ? "text-red-600" : ""}`}>{won(r.yts)}</td>
                    <td className={`py-1.5 px-3 text-right tabular-nums ${diff ? "text-red-600" : ""}`}>{won(r.nts)}</td>
                    <td className={`py-1.5 px-3 text-right tabular-nums text-xs ${diff ? "text-red-600" : "text-muted-foreground/50"}`}>
                      {diff == null ? "—" : diff === 0 ? "0" : (diff > 0 ? "+" : "") + diff.toLocaleString("ko-KR")}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </DetailPanel>

        {/* 2) YTS 원천 — 보낸값·공제값을 YTS 어느 컬럼에서 찾아왔나(제대로 된 값인지 확인). ③과 동일 항목·순서(로스터). */}
        <DetailPanel
          title="② YTS 원천 (보낸값·공제값 출처)"
          rightExtra={
            <div className="inline-flex rounded border overflow-hidden text-[10px] font-normal">
              <button type="button" onClick={() => setIoShowAll(true)} className={`px-2 py-0.5 ${ioShowAll ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>전체보기</button>
              <button type="button" onClick={() => setIoShowAll(false)} className={`px-2 py-0.5 border-l ${!ioShowAll ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>값보기</button>
            </div>
          }
          collapsed={isCollapsed("inputs")} onToggle={() => toggle("inputs")} onExpandOnly={() => expandOnly("inputs")} maximized={focusedPanel === "inputs"}
        >
          <table className="min-w-full text-xs border-collapse whitespace-nowrap">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr className="text-[10px] text-muted-foreground">
                <th className="px-2 py-1.5 text-left font-medium">코드</th>
                <th className="px-2 py-1.5 text-left font-medium">항목</th>
                <th className="px-2 py-1.5 text-left font-medium border-l">YTS 원천컬럼(보낸값)</th>
                <th className="px-2 py-1.5 text-right font-medium">보낸값</th>
                <th className="px-2 py-1.5 text-left font-medium border-l">YTS 공제컬럼</th>
                <th className="px-2 py-1.5 text-right font-medium">YTS 공제값</th>
              </tr>
            </thead>
            <tbody>
              {ioRowsByMap.map(({ code, i }) => {
                if (compareCodes.has(code)) return null
                if (!mapOrder.has(code) && !SUBTOTAL_CODES.has(code)) return null
                const subParent  = SUBTOTAL_OF.get(code)
                if (subParent && !openSubs.has(subParent)) return null
                const isSubtotal = SUBTOTAL_CODES.has(code) || displaySubCodes.has(code)
                const label = codeLabel[code] ?? SUBTOTAL_CODES.get(code)?.label ?? "—"
                const sent   = i?.useAmt || i?.incDdcNfpCnt || i?.ddcTrgtAmt
                const ytsCol = ytsColOf.get(code)
                const resCol = resultColOf.get(code)
                const ytsD   = res.ytsDdcMap[code]
                return (
                  <tr key={code} onClick={() => setSelRow(`i:${code}`)} className={`${ioBreakMap.has(code) ? "border-t-2 border-muted-foreground/40" : "border-t"} ${rowCls(`i:${code}`)}`}>
                    <td className="px-2 py-1 font-mono">{code}</td>
                    <td className={`px-2 py-1 ${subParent ? "pl-6" : ""}`}>
                      {isSubtotal ? (
                        <button type="button" onClick={e => { e.stopPropagation(); toggleSub(code) }} className="inline-flex items-center gap-1 hover:text-foreground">
                          {label}
                          <ChevronDown className={`h-3 w-3 opacity-60 transition-transform ${openSubs.has(code) ? "" : "-rotate-90"}`} />
                        </button>
                      ) : label}
                    </td>
                    <td className="px-2 py-1 text-left font-mono text-[10px] text-muted-foreground border-l"><SrcCell text={ytsCol ?? "—"} /></td>
                    <td className={`px-2 py-1 text-right tabular-nums ${sent ? "" : "text-muted-foreground/30"}`}>{ioNum(sent)}</td>
                    <td className="px-2 py-1 text-left font-mono text-[10px] text-muted-foreground border-l"><SrcCell text={resCol ?? "—"} /></td>
                    <td className={`px-2 py-1 text-right tabular-nums ${ytsD ? "" : "text-muted-foreground/30"}`}>{ioNum(ytsD)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </DetailPanel>

        {/* 3) NTS 원본 IN/OUT + YTS 대조 (코드별 전 필드, 불일치 적색·일치 청색) */}
        {(res.ntsIn.length > 0 || res.ntsOut.length > 0) && (
          <DetailPanel
            title="③ NTS 원본 IN / OUT + YTS 대조"
            extra={<MismatchBadge n={ioDiffCount} />}
            rightExtra={
              <div className="inline-flex rounded border overflow-hidden text-[10px] font-normal">
                <button type="button" onClick={() => setIoShowAll(true)} className={`px-2 py-0.5 ${ioShowAll ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>전체보기</button>
                <button type="button" onClick={() => setIoShowAll(false)} className={`px-2 py-0.5 border-l ${!ioShowAll ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>값보기</button>
              </div>
            }
            collapsed={isCollapsed("io")} onToggle={() => toggle("io")} onExpandOnly={() => expandOnly("io")} maximized={focusedPanel === "io"}
          >
            <table className="min-w-full text-xs border-collapse whitespace-nowrap">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr className="text-[10px] text-muted-foreground">
                  <th className="px-2 py-1.5 text-left font-medium">코드</th>
                  <th className="px-2 py-1.5 text-left font-medium">항목</th>
                  <th className="px-2 py-1.5 text-right font-medium">IN 금액</th>
                  <th className="px-2 py-1.5 text-right font-medium">IN 인원</th>
                  <th className="px-2 py-1.5 text-right font-medium">IN 대상</th>
                  <th className="px-2 py-1.5 text-right font-medium border-l">YTS 공제</th>
                  <th className="px-2 py-1.5 text-right font-medium">NTS 공제</th>
                  <th className="px-2 py-1.5 text-center font-medium w-8">판정</th>
                  <th className="px-2 py-1.5 text-right font-medium border-l">OUT 대상</th>
                  <th className="px-2 py-1.5 text-right font-medium">OUT 한도</th>
                  <th className="px-2 py-1.5 text-right font-medium">OUT 인원</th>
                </tr>
              </thead>
              <tbody>
                {ioRows.map(({ code, i, o }) => {
                  if (compareCodes.has(code)) return null                      // ①결과비교에 나오는 계산흐름 코드는 ③에서 제외(중복)
                  if (!mapOrder.has(code) && !SUBTOTAL_CODES.has(code)) return null   // 매핑 밖(국세청 내부 코드 8464~8467 등) 제외 — 항목도 YTS 기준
                  const subParent  = SUBTOTAL_OF.get(code)                     // 소계형 개별 멤버면 그 소계코드(카드8430 등)
                  if (subParent && !openSubs.has(subParent)) return null       // 소계가 접혀 있으면 멤버 숨김(기본은 펼침)
                  const isSubtotal = SUBTOTAL_CODES.has(code) || displaySubCodes.has(code)   // 소계코드 행(카드8430/의료8726/부양가족8003 등)
                  const label = codeLabel[code] ?? SUBTOTAL_CODES.get(code)?.label ?? "—"
                  // 순수 소계 멤버(카드8431 등)는 입력(IN)만 표시 — YTS·NTS·판정·OUT은 소계행이 담당(카드·의료 동형).
                  //   ★복합멤버(투자조합8415~23·ISA8707/08, selfComparable)는 per-code OUT 유지 — 소계 밑에 그룹핑하되
                  //     per-code YTS(PEN_SAVE_SUB_AMT, ytsDdcMap 병합)로 per-code 판정·표시까지 한다(2026-08-04 통일).
                  const isSubMember = subParent != null
                  const keepPerCode = isSubMember && COMPOSITE_MEMBERS.has(code)   // 복합멤버 = 그룹핑하되 per-code 유지
                  const oOut = isSubMember && !keepPerCode ? undefined : o
                  const ytsD = isSubMember && !keepPerCode ? undefined : res.ytsDdcMap[code]
                  const ntsD = oOut?.ddcAmt
                  const cmp  = ddcVerdict(res, code)   // 판정 단일원천(리스트 배지·불일치 건수와 공유)
                  const cmpCls = cmp === "diff" ? "text-red-600 font-semibold" : cmp === "match" ? "text-blue-600" : ""
                  return (
                    <Fragment key={code}>
                      {code === firstEtcCode && (
                        <tr className="border-t-2 border-muted-foreground/50 bg-muted-foreground/15">
                          <td colSpan={11} className="px-2 py-1 text-[11px] font-bold text-foreground">기타 (계산과정 로스터 밖)</td>
                        </tr>
                      )}
                      <tr onClick={() => setSelRow(`o:${code}`)} className={`${ioBreak.has(code) ? "border-t-2 border-muted-foreground/40" : "border-t"} ${rowCls(`o:${code}`, cmp === "diff" ? "bg-red-50/50" : "")}`}>
                      <td className="px-2 py-1 font-mono">{code}</td>
                      <td className={`px-2 py-1 ${subParent ? "pl-6" : ""}`}>
                        {isSubtotal ? (
                          <button type="button" onClick={e => { e.stopPropagation(); toggleSub(code) }} className="inline-flex items-center gap-1 hover:text-foreground">
                            {label}
                            <ChevronDown className={`h-3 w-3 opacity-60 transition-transform ${openSubs.has(code) ? "" : "-rotate-90"}`} />
                          </button>
                        ) : label}
                      </td>
                      <td className={`px-2 py-1 text-right tabular-nums ${i?.useAmt ? "" : "text-muted-foreground/30"}`}>{ioNum(i?.useAmt)}</td>
                      <td className={`px-2 py-1 text-right tabular-nums ${i?.incDdcNfpCnt ? "" : "text-muted-foreground/30"}`}>{ioNum(i?.incDdcNfpCnt)}</td>
                      <td className={`px-2 py-1 text-right tabular-nums ${i?.ddcTrgtAmt ? "" : "text-muted-foreground/30"}`}>{ioNum(i?.ddcTrgtAmt)}</td>
                      <td className={`px-2 py-1 text-right tabular-nums border-l ${cmpCls || (ytsD ? "" : "text-muted-foreground/30")}`}>{ioNum(ytsD)}</td>
                      <td className={`px-2 py-1 text-right tabular-nums ${cmpCls || (ntsD ? "" : "text-muted-foreground/30")}`}>{ioNum(ntsD)}</td>
                      <td className={`px-2 py-1 text-center ${cmpCls}`}>{cmp === "diff" ? "✗" : cmp === "match" ? "✓" : "—"}</td>
                      <td className={`px-2 py-1 text-right tabular-nums border-l ${oOut?.ddcTrgtAmt ? "" : "text-muted-foreground/30"}`}>{ioNum(oOut?.ddcTrgtAmt)}</td>
                      <td className={`px-2 py-1 text-right tabular-nums ${oOut?.ddcLmtAmt ? "" : "text-muted-foreground/30"}`}>{ioNum(oOut?.ddcLmtAmt)}</td>
                      <td className={`px-2 py-1 text-right tabular-nums ${oOut?.incDdcNfpCnt ? "" : "text-muted-foreground/30"}`}>{ioNum(oOut?.incDdcNfpCnt)}</td>
                    </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </DetailPanel>
        )}

        {/* 4) 미전송 항목 */}
        {res.missing.length > 0 && (
          <div className="shrink-0 border border-red-200 rounded-md bg-red-50/40 p-3 space-y-1">
            <h3 className="text-xs font-semibold text-red-600 mb-1">④ 미전송 항목 (차이 원인 후보)</h3>
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
        )}
      </div>
    </div>
  )
}

// ── 매핑 현황(진도) 뷰 — MAPPING_2025 를 그대로 렌더(코드=화면 항상 동기) ──
//   각 항목의 계약 5축(원천/IN/OUT/실측/전송)을 그룹별로 조회. 국세청 in-out 정리 진도판.
// 판정 단일원천(outCodeOf·SUBTOTAL_CODES·SUBTOTAL_OF·MAP_ORDER·ddcVerdict·diffCodesOf)은
//   lib/ddcVerdict.ts 로 추출 — 상단 import 참조. 유닛테스트·모순 감지기가 같은 모듈을 공유한다.

// 기타세액공제 ETX_ 가상컬럼 → PAY_WRK_MAIN 실제 원천 컬럼
const ETX_SRC: Record<string, string> = {
  ETX_8751: "FRGN_PAY_TAX", ETX_8754: "FRGN_TOT_PAY_AMT", ETX_8752: "HOUSE_ALR", ETX_8753: "ASSO_SUB_TAX_AMT",
}
// 부양가족 FAM_ 가상컬럼 → PAY_WRK_FMLY.FMLY_RELN 관계코드(원천 필터). 맵현황 yts IN 에 원천을 구체화.
//   ★injectFamilyVals(runCompareForCalcNo.ts) SQL 의 CASE 조건과 동기 유지할 것(코드 바뀌면 여기도).
const FAM_RELN: Record<string, string> = {
  FAM_8002: "550-040",
  FAM_8004: "550-020/030", FAM_8005: "550-050", FAM_8006: "550-055",
  FAM_8007: "550-060", FAM_8008: "550-070", FAM_8009: "550-080",
  FAM_8764: "550-050·순번3", FAM_8765: "550-050·순번5", FAM_8766: "550-050·순번7",
  FAM_MRRG: "550-010·혼인",
}
// 주택자금 LOAN_ 가상컬럼 → PAY_WRK_MAIN 원본 상환액 컬럼(원리금·장기주택저당)
const LOAN_SRC: Record<string, string> = {
  LOAN_8311: "HOUSE_RALR_LENDER", LOAN_8312: "PAY_WRK_RENT_HABT_SPEC.PNINT_SUM",   // 8312 거주자=SPEC B0 합(MAIN 아님, 2026-07-23 실측정정)
  LOAN_8321: "LH_LRSF1", LOAN_8322: "LH_LRSF2", LOAN_8323: "LH_LRSF3",
  LOAN_8324: "LH_LRSF10", LOAN_8325: "LH_LRSF20", LOAN_8326: "LH_LRSF30",
  LOAN_8327: "LH_LRSF40", LOAN_8328: "LH_LRSF50", LOAN_8329: "LH_LRSF60",
}
// 그밖의소득공제 OTHER_ 가상컬럼 → 원본 원천(개인연금저축·주택마련저축=PEN_SAVE_SPEC CLS별, 노란우산=PAY_WRK_MAIN.SM_ETPR_AMT)
const OTHER_SRC: Record<string, string> = {
  OTHER_8401: "PEN_SAVE_SPEC(562-030)",   // 개인연금저축
  OTHER_8402: "SM_ETPR_AMT",              // 소기업소상공인
  OTHER_8403: "PEN_SAVE_SPEC(562-050)",   // 청약저축
  OTHER_8404: "PEN_SAVE_SPEC(562-080)",   // 근로자주택마련저축
  OTHER_8407: "PEN_SAVE_SPEC(562-060)",   // 주택청약종합저축
  OTHER_8452: "STOCK_URDM",               // 우리사주출연금 (PAY_WRK_MAIN)
  OTHER_8451: "PEN_SAVE_SPEC(562-100)",   // 장기집합투자증권저축
  OTHER_8501: "PEN_SAVE_SPEC(562-140)",   // 청년형 장기집합투자증권저축
  OTHER_8453: "EMPL_MTN_WAGE_CUT",        // 고용유지중소기업 임금삭감액 (PAY_WRK_MAIN)
  // 투자조합출자(8415~8423) = PEN_SAVE_SPEC 562-110, INVST_CLS/INVST_YY 로 연도/종류 분리
  ...Object.fromEntries(["8415","8416","8417","8418","8419","8420","8421","8422","8423"].map(c => [`OTHER_${c}`, "PEN_SAVE_SPEC(562-110)"])),
}
// yts IN/OUT 원천 셀 — "table.COLUMN" 에서 테이블명(첫 '.' 앞)만 볼드. '.' 없으면(테이블만·함수형) 통째 볼드. (2026-07-31 테이블명 굵게·소문자 통일)
function SrcCell({ text }: { text: string }) {
  if (!text || text === "—") return <span className="text-muted-foreground/40">—</span>
  const dot = text.indexOf(".")
  if (dot < 0) return <span className="font-bold text-blue-600">{text}</span>
  return <><span className="font-bold text-blue-600">{text.slice(0, dot)}</span>{text.slice(dot)}</>
}
// yts 원천컬럼에 소속 테이블 접두(소문자 축약, PAY_WRK_ 제거): route 가 주입하는 가상컬럼(CARD_/MEDI_/PEN_/GIFT_ 등)은
//   실제 원천으로 환원하고, 소속 테이블을 소문자 축약(calc/main/gift_adj/pen_save_spec 등)으로 앞에 붙인다. ②표·현황표 공용.
//   렌더(SrcCell)가 테이블명만 볼드 처리. (2026-07-31 테이블명 굵게·소문자 통일)
// inSource(구조화 취득 명세) → "table.field [where] ·agg" 문자열. 테이블은 PAY_WRK_ 제거·소문자(SrcCell 볼드 규칙과 일관).
function inSourceToStr(s: NonNullable<MappingRow["inSource"]>): string {
  let out = s.table.replace(/^PAY_WRK_/, "").toLowerCase()
  if (s.field) out += "." + s.field   // sum 대상 컬럼 등
  if (s.where) out += (s.field ? " " : ".") + `[${s.where}]`   // field 있으면 "field [where]", 없으면(카운트) "table.[where]"
  if (s.agg && s.agg !== "none") out += ` ·${s.agg}`
  return out
}
function ytsSrcWithTable(m: MappingRow): string {
  if (m.inSource) return inSourceToStr(m.inSource)   // 구조화 명세가 있으면 정본(가상컬럼 폴백보다 우선)
  const c = m.ytsCol
  if (!c) return "—"
  if (c.startsWith("CARD_")) return "calc.CALC_PROC_CARD"
  if (c.startsWith("MEDI_")) return "calc.CALC_PROC_MEDI"
  if (c.startsWith("PEN_"))  return "pen_save_spec.PEN_SAVE_PMT_AMT"
  if (c.startsWith("GIFT_")) { const s = giftSourceOf(c.slice(5)); return s ? `gift_adj.GIFT_ABLE_SUB_AMT [${s.cls} · ${s.year}]` : "gift_adj.GIFT_ABLE_SUB_AMT" }
  if (c.startsWith("RENT_")) return "main.HOUSE_RENT"
  if (c.startsWith("FAM_"))  return FAM_RELN[c] ? `fmly ${FAM_RELN[c]}` : "fmly"   // 인원 집계 + FMLY_RELN 원천
  if (c.startsWith("ETX_"))  return "main." + (ETX_SRC[c] ?? c)
  if (c.startsWith("LOAN_")) {
    const s = LOAN_SRC[c] ?? c
    if (s.includes(".")) { const [t, col] = s.split("."); return t.replace(/^PAY_WRK_/, "").toLowerCase() + "." + col }   // 테이블명 이미 포함(8312 SPEC)
    return "main." + s
  }
  if (c.startsWith("OTHER_")) { const s = OTHER_SRC[c] ?? c; return s.startsWith("PEN_SAVE_SPEC") ? "pen_save_spec" + s.slice("PEN_SAVE_SPEC".length) : "main." + s }
  if (c === "CUT_8601")      return "main.TAX_GOVM_AGREE"
  if (c.startsWith("CUT_"))  return "fn_pay_get_wrk_ntax(Txx)"
  return "calc." + c   // 매핑이 직접 지정한 PAY_WRK_CALC 컬럼(BASC_SUB_*·SPCL_*·NP_INSU_* 등)
}
// 현황표·②표용 yts OUT 공제컬럼(소문자 테이블 접두): 기부금은 gift_adj.GIFT_SUB_AMT, 그 외 resultCol 은 전부 PAY_WRK_CALC.
function ytsOutWithTable(m: MappingRow): string {
  if (m.group === "기부금") return "gift_adj.GIFT_SUB_AMT"   // IN 표기와 일관
  return m.resultCol ? "calc." + m.resultCol : "—"
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
  doneSeq?:   number   // 완료 순번(status="완료"만) — 상태열 "완료 N" 표시
  depNote?:   string   // 동반/참조 의존 안내 — 항목 옆 "?" 버블
  isSubtotal: boolean
  relation:   RelationType   // 실행과정 대응관계 유형(1:0·1:1·N:1) — relationTypeOf 파생
}

// 한 그룹의 매핑행 → 렌더행. self형=IN·OUT 한 행, 소계형=개별행(OUT —) + 소계행(IN —, OUT).
function statusRowsOf(rows: MappingRow[], ntsYear: number, relationOf: (m: MappingRow) => RelationType): StatusRow[] {
  const out: StatusRow[] = []
  const emitted = new Set<string>()   // 소계행을 이미 낸 코드(중복 방지)
  rows.forEach((m, i) => {
    const oc    = outCodeOf(m)
    const isSub = SUBTOTAL_CODES.has(oc)
    // self-subtotal: 매핑행 자체가 소계코드(예 투자조합 8410) — 결과전용(nts IN=— / nts OUT=ddcAmt / yts OUT=resultCol).
    //   멤버가 별도 outCode 로 몰지 않고 자기 코드로 소계를 받으므로 합성 소계행 대신 이 행이 소계 역할.
    const selfSub = SUBTOTAL_CODES.get(m.ntsCode)
    // 혼인공제(8790): 특수전송(incDdcNfpCnt=1+ddcAmt 직접, 국세청 미검산) — 결정세액만 반영, 항목대조 안 함
    const isMrrg = m.ntsCode === "8790"
    // 연도별 코드(투자조합출자 등): 입력연도(ntsYear)+offset 로 "○○○○년" 을 라벨 앞에 렌더
    const label = m.yearOffset != null ? `투자조합출자 ${ntsYear + m.yearOffset}년 ${m.label}` : m.label
    out.push({
      key:   m.ntsCode + m.label,
      label,
      // 실제 국세청 입력코드가 표시코드와 다르면 병기(sendCode 지정 행. 현재 없음 — 인프라만 유지)
      code:  m.sendCode && m.sendCode !== m.ntsCode ? `${m.ntsCode} (입력 ${m.sendCode})` : m.ntsCode,
      ntsIn: !m.send ? "—" : isMrrg ? "incDdcNfpCnt+ddcAmt" : selfSub ? "—" : m.valueKey,   // send:false(8003 통합=altSent 등)는 자기전송 안 함 → IN "—"(실제 전송은 8004~09 유형별)
      ntsOut: m.selfComparable ? "ddcAmt" : selfSub ? "ddcAmt" : (oc === "—" || isSub ? "—" : "ddcAmt"),   // 복합유형(ISA·투자조합)은 국세청 per-code ddcAmt 회신 → OUT 채움. 혼인(8790)도 self(소진캡후 ddcAmt). 소계 멤버는 소계행이 받음
      ytsIn:  !m.send ? "—" : selfSub ? "—" : ytsSrcWithTable(m),
      ytsOut: m.selfComparable ? "pen_save_spec.PEN_SAVE_SUB_AMT" : selfSub ? "calc." + selfSub.ytsOut : (isSub ? "—" : ytsOutWithTable(m)),   // 복합유형 per-code YTS = SPEC 공제대상액(collectCompositePerCodeYtsDdc). RT_ISA_PEN_AMT는 합산이라 per-code 불가. 혼인=calc.RT_MRRG. 소계 멤버는 소계행에 몰림
      status: m.status,
      doneSeq: m.doneSeq,
      depNote: m.depNote,
      isSubtotal: !!selfSub,
      relation: relationOf(m),
    })
    // 소계행은 해당 소계의 "마지막 멤버" 바로 뒤에 삽입 → 개별행 옆에 붙음(카드·의료는 그룹말미라 위치 동일, 출산입양은 세액공제 그룹 중간이라 8766 뒤로 이동)
    if (isSub && !emitted.has(oc) && !rows.slice(i + 1).some(r => outCodeOf(r) === oc)) {
      emitted.add(oc)
      const meta = SUBTOTAL_CODES.get(oc)!
      const members = rows.filter(r => outCodeOf(r) === oc)   // 이 소계로 몰리는 멤버들
      const subDone = members.length > 0 && members.every(r => r.status === "완료")   // 멤버 전원 완료면 소계도 완료
      out.push({
        key:   "sub-" + oc,
        label: meta.label,
        code:  oc,
        ntsIn: "—",
        ntsOut: "ddcAmt",
        ytsIn:  "—",
        ytsOut: "calc." + meta.ytsOut,
        status: subDone ? "완료" : "진행",   // 멤버 전원 완료면 소계도 완료(순번은 멤버 승계)
        doneSeq: subDone ? members.find(r => r.doneSeq != null)?.doneSeq : undefined,
        isSubtotal: true,
        relation: "N:1·",   // 합성 소계행 = 1-집계 대조코드(카드8430·의료8726 등)
      })
    }
  })
  return out
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "완료" ? "bg-green-100 text-green-700"
            : "bg-muted text-muted-foreground"   // 진행
  return <span className={`px-1.5 py-0.5 rounded text-[10px] ${cls}`}>{status}</span>   // doneSeq 순번은 기록만, 표시는 '완료'만
}

// 실행과정 대응관계 유형 배지(1:0·1:1·N:1). 커버리지/상태 배지(녹/적/황/muted)와 안 겹치게 sky/violet/slate 계열.
const REL_CLS: Record<RelationType, string> = {
  "1:0": "bg-slate-100 text-slate-600",
  "1:1": "bg-sky-100 text-sky-700",
  "·N:1": "bg-violet-100 text-violet-600",   // N-멤버(전송만)
  "N:1·": "bg-violet-100 text-violet-800",   // 1-집계(대조점)
  "1:1·N:1": "",                          // 복합 — 두 칩(1:1+·N:1)으로 분리 렌더라 자체 클래스 미사용
  "1:N": "bg-teal-100 text-teal-700",     // 보류(현재 미노출)
  "0:1": "bg-slate-100 text-slate-500",   // 회신전용 — 입력없이 국세청 자체계산 OUT 대조(근로소득세액공제 8700)
}
const REL_TITLE: Record<RelationType, string> = {
  "1:0": "입력만 — 대조 회신 없음(동반입력, 예 8754 국외총급여)",
  "1:1": "self 대조 — 송신코드=대조코드(총급여 8900은 echo 대조)",
  "·N:1": "N:1 멤버 — 전송만(nts/yts IN 있음, OUT 없음), 대조는 집계코드서(카드8431·부양가족8004~09)",
  "N:1·": "N:1 집계 — IN 없이 통합 회신 받아 대조(nts/yts OUT 있음, IN 없음)(8003·8430·8726·8410)",
  "1:1·N:1": "복합 — self(per-code YTS 있어 동일코드 대조 가능)이면서 소계 멤버. 투자조합8415~23·ISA8707/08",
  "1:N": "국세청 구간분해(보류) — 정치자금·고향사랑",
  "0:1": "회신전용 — 입력 없이 국세청 자체계산 OUT을 대조(근로소득세액공제 8700 = 산출세액서 자체계산, YTS RT_WIA와 self 대조)",
}
function RelationBadge({ rel }: { rel: RelationType }) {
  // 복합(1:1·N:1)은 두 성질을 각각 칩으로 — self(1:1) + 멤버(·N:1) 나란히.
  if (rel === "1:1·N:1") {
    return (
      <span className="inline-flex items-center gap-0.5" title={REL_TITLE[rel]}>
        <RelationBadge rel="1:1" /><RelationBadge rel="·N:1" />
      </span>
    )
  }
  // 멤버(·N:1)/집계(N:1·)의 점을 크게(•) 렌더해 N쪽/1쪽 구분을 또렷하게. 내부 문자열값은 그대로(·).
  const body = rel.replace(/·/g, "")
  const dot = <span className="text-[13px] leading-none font-bold">•</span>
  return (
    <span className={`inline-flex items-center gap-px px-1 py-0.5 rounded text-[9px] font-mono ${REL_CLS[rel]}`} title={REL_TITLE[rel]}>
      {rel.startsWith("·") && dot}{body}{rel.endsWith("·") && dot}
    </span>
  )
}

// 검증 커버리지 판정 배지(안전/사각/미검증/해당없음). 검토상태는 별도 열. mapping/2025.ts COVERAGE_2025 근거.
//   verdict 미지정 = send:true 인데 COVERAGE_2025 미등록 → "미분류"(적색, 누락 경고).
const COV_CLS: Record<string, string> = {
  "안전":     "bg-green-100 text-green-700",
  "사각":     "bg-red-100 text-red-700",
  "미검증":   "bg-amber-100 text-amber-700",
  "해당없음": "bg-muted text-muted-foreground",
}
function VerdictBadge({ verdict }: { verdict?: Coverage["verdict"] }) {
  if (!verdict) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-700 font-semibold" title="COVERAGE_2025 미등록 — 커버리지 판정 필요">미분류</span>
  return <span className={`px-1.5 py-0.5 rounded text-[10px] ${COV_CLS[verdict] ?? "bg-muted text-muted-foreground"}`}>{verdict}</span>
}

// 맵현황 뷰 — 탭 인라인이 아니라 전용 팝업 창(/hometax-calc-map)에서 렌더. HometaxCalcPanel 의 "맵현황" 버튼이 window.open 으로 연다.
export function MappingStatusView({ ntsYear }: { ntsYear: string }) {
  const yy = Number(ntsYear)
  // 연도 설정(매핑·커버리지·로스터)은 registry 단일원천에서 라우팅 — 드롭다운 연도(ntsYear)를 그대로 따라간다.
  const { mapping, coverage, procLabelCode } = getYearConfig(ntsYear)
  // 대응관계 유형(1:0·1:1·N:1) 파생기 — 판정 단일원천(makeYearVerdict)에서 SUBTOTAL_OF 기반 분류를 그대로 공유
  const { relationTypeOf } = useMemo(() => makeYearVerdict(mapping), [mapping])
  // 두 영역(매핑 현황 / 계산과정 로스터)을 실행과정 드로어처럼 접기·최대화
  const [collapsed, setCollapsed] = useState({ mapping: false, roster: false })
  // 맵현황 진입 시 매핑현황을 기본 최대화(로스터 접힘)로 — 콘텐츠 영역 꽉 채워 표시. 로스터는 헤더 버튼으로 펼침.
  const [focused, setFocused] = useState<"mapping" | "roster" | null>("mapping")
  // 정합성 검사 결과(파생매핑↔MAPPING 코드셋). 검사한 연도를 함께 기록해, 연도가 바뀌면 렌더에서 자동 무효화.
  const [consistency, setConsistency] = useState<{ year: string; result: ConsistencyResult } | null>(null)
  const consResult = consistency && consistency.year === ntsYear ? consistency.result : null
  const toggleP = (k: "mapping" | "roster") => { setFocused(null); setCollapsed(c => ({ ...c, [k]: !c[k] })) }
  const expandOnlyP = (k: "mapping" | "roster") => setFocused(p => (p === k ? null : k))
  const isCollP = (k: "mapping" | "roster") => (focused ? k !== focused : collapsed[k])
  const groups: { name: string; rows: MappingRow[] }[] = []
  for (const m of mapping) {
    let g = groups.find(x => x.name === m.group)
    if (!g) { g = { name: m.group, rows: [] }; groups.push(g) }
    g.rows.push(m)
  }
  const totCnt  = mapping.length
  const totDone = mapping.filter(m => m.status === "완료").length
  const totSend = mapping.filter(m => m.send).length

  // 검증 커버리지 롤업 — 판정별 개수 + 미분류(send:true 인데 COVERAGE 누락) + 검토중 진행도
  const cov = { 안전: 0, 사각: 0, 미검증: 0, 해당없음: 0, 미분류: 0, 검토중: 0, 총: 0 }
  for (const m of mapping) {
    const c = coverageOf(m.ntsCode, coverage)
    if (!c) { if (m.send) cov.미분류++; continue }
    cov[c.verdict]++
    cov.총++
    if (c.review === "검토중") cov.검토중++
  }

  // 계산과정 순서 로스터 — PROC_LABEL_CODE_2025(계산과정 등장순) × MAPPING 매칭. ③표 정렬의 단일 원천 조회.
  //   판정 3분류로 오탐 차단: 입력(MAPPING ntsCode) / 소계·결과·내부 OUT / 미등록(진짜 신규=세법개정 신호).
  //   흐름코드(8700 등 국세청 자체계산)·의도적 미사용 내부코드(8741=정치 10만이하, 8740만 대조)는 미등록 아님.
  const outCodes = new Set<string>()
  for (const m of mapping) if (m.outCode) outCodes.add(m.outCode)
  const flowCodes = new Set(NTS_FLOW.map(f => f.code))   // 국세청이 산출세액서 자체계산하는 결과·흐름 코드
  const internalUnused = new Set(["8741"])               // NTS 내부 중간값이라 의도적 미사용(8740만 self 대조)
  const rosterRows = Object.entries(procLabelCode).map(([label, code], i) => {
    const hit = mapping.find(m => m.ntsCode === code)
    const kind: "input" | "sub" | "flow" | "internal" | "unknown" =
        hit ? "input" : outCodes.has(code) ? "sub" : flowCodes.has(code) ? "flow"
      : internalUnused.has(code) ? "internal" : "unknown"
    return { i: i + 1, label, code, group: hit?.group, kind }
  })
  const rosterUnknown = rosterRows.filter(r => r.kind === "unknown").length

  return (
    <div className="flex flex-col h-full min-h-0 p-3 gap-3">
      {/* 매핑 현황 — 그룹별 진도판 */}
      <DetailPanel
        title={`매핑 현황 (전체 ${totCnt} · 완료 ${totDone} · 전송 ${totSend}) — 실행과정 ②표 정렬·원천 기준`}
        extra={<span className="text-[10px] font-normal text-muted-foreground">국세청 in-out 정리 진도 · <span className="font-mono">mapping/{ntsYear}.ts › MAPPING_{ntsYear}</span></span>}
        collapsed={isCollP("mapping")} onToggle={() => toggleP("mapping")} onExpandOnly={() => expandOnlyP("mapping")} maximized={focused === "mapping"}
        headerBg="bg-sky-100"
      >
        {/* 검증 커버리지 롤업 범례 — 각 항목이 국세청 대조로 검증되는 깊이(mapping/2025.ts COVERAGE_2025) */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-2 text-[11px]">
          <span className="font-semibold">검증 커버리지:</span>
          <span className="inline-flex items-center gap-1"><span className="px-1.5 py-0.5 rounded text-[10px] bg-green-100 text-green-700">안전</span>{cov.안전}</span>
          <span className="inline-flex items-center gap-1"><span className="px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-700">사각</span>{cov.사각}</span>
          <span className="inline-flex items-center gap-1"><span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-700">미검증</span>{cov.미검증}</span>
          <span className="inline-flex items-center gap-1"><span className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">해당없음</span>{cov.해당없음}</span>
          {cov.미분류 > 0 && <span className="inline-flex items-center gap-1 font-semibold text-red-600"><span className="px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-700">미분류</span>{cov.미분류}</span>}
          <span className="text-muted-foreground">· 검토중 {cov.검토중}/{cov.총} (나머지 확정)</span>
          {/* 내부 정합성 검사 — 파생매핑(gift/card/…)↔MAPPING 코드셋 대조(vitest 와 동일 순수함수 공유) */}
          <button
            type="button"
            onClick={() => setConsistency({ year: ntsYear, result: checkMappingConsistency(mapping) })}
            className="ml-auto px-2 py-0.5 rounded border text-[10px] font-semibold hover:bg-muted"
            title="파생매핑(gift/card/medi/pension/investment/personal)이 참조하는 amtClusCd 와 MAPPING 코드셋이 어긋나는지 대조"
          >정합성 검사</button>
          {consResult && (consResult.ok
            ? <span className="inline-flex items-center gap-1 font-semibold text-green-700"><CheckCircle2 className="w-3.5 h-3.5" />일치</span>
            : <span className="inline-flex items-center gap-1 font-semibold text-red-600"><XCircle className="w-3.5 h-3.5" />불일치 {consResult.issues.length}건</span>)}
        </div>
        {consResult && !consResult.ok && (
          <ul className="px-1 pb-2 -mt-1 text-[10px] text-red-600 space-y-0.5">
            {consResult.issues.map((iss, i) => (
              <li key={i}><span className="font-mono font-semibold">{iss.code}</span> · {iss.direction} · {iss.detail}</li>
            ))}
          </ul>
        )}
        {/* 대응관계 유형 범례 — 실행과정 송신:회신 카디널리티(자동 파생 유형). 1:N(구간분해)만 보류 — 0:1은 8700로 파생 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-2 text-[11px]">
          <span className="font-semibold">유형:</span>
          <span className="inline-flex items-center gap-1"><RelationBadge rel="1:1" />self(송신=대조)</span>
          <span className="inline-flex items-center gap-1"><RelationBadge rel="·N:1" />멤버(전송만)</span>
          <span className="inline-flex items-center gap-1"><RelationBadge rel="N:1·" />집계(대조점)</span>
          <span className="inline-flex items-center gap-1"><RelationBadge rel="1:1·N:1" />복합(self+멤버)</span>
          <span className="inline-flex items-center gap-1"><RelationBadge rel="1:0" />입력만</span>
          <span className="inline-flex items-center gap-1"><RelationBadge rel="0:1" />회신전용</span>
          <span className="text-muted-foreground">· 1:N(구간분해)은 보류</span>
        </div>
        <table className="w-full border-collapse text-xs">
          <colgroup>
            {/* 항목 (고정·truncate) — w-56(14rem)에서 확대(20%→추가 10%) */}
            <col className="w-[18.48rem]" />
            {/* nts코드 */}
            <col className="w-14" />
            {/* 유형 (대응관계) — 복합(1:1·N:1) 두 칩 수용 위해 확대 */}
            <col className="w-20" />
            {/* nts IN */}
            <col className="w-40" />
            {/* nts OUT */}
            <col className="w-16" />
            {/* yts IN (가변 흡수 — 정보 최다: table.field [where] ·agg 담아 남는 폭 독차지 → 제일 넓게). table-fixed 에선 width:100% 로 잔여폭 확실히 흡수(auto <col/> 은 잔여 미흡수·우측 여백 발생) */}
            <col className="w-full" />
            {/* yts OUT (고정 — resultCol 한 컬럼. 최장 calc.OTO_YM_LONG_STOCK_SAVING 수용) */}
            <col className="w-56" />
            {/* 커버리지 (판정) */}
            <col className="w-16" />
            {/* 상태(진행/완료) */}
            <col className="w-12" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-muted">
            <tr className="text-[10px] text-muted-foreground text-left whitespace-nowrap">
              <th className="px-2 py-1.5 border-b border-r font-medium bg-muted">항목</th>
              <th className="px-2 py-1.5 border-b border-r font-medium bg-muted">nts코드</th>
              <th className="px-2 py-1.5 border-b border-r font-medium text-center bg-muted" title="실행과정 대응관계 유형(송신:회신)">유형</th>
              <th className="px-2 py-1.5 border-b border-r font-medium bg-muted">nts IN</th>
              <th className="px-2 py-1.5 border-b border-r font-medium bg-muted">nts OUT</th>
              <th className="px-2 py-1.5 border-b border-r font-medium bg-muted">yts IN</th>
              <th className="px-2 py-1.5 border-b border-r font-medium bg-muted">yts OUT</th>
              <th className="px-2 py-1.5 border-b border-r font-medium text-center bg-muted">커버리지</th>
              <th className="px-2 py-1.5 border-b font-medium text-center bg-muted">상태</th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap(g => {
              return [
                <tr key={`h-${g.name}`} className="bg-muted/70 border-y">
                  <td colSpan={10} className="px-2 py-1">
                    <span className="text-sm font-semibold whitespace-nowrap">{g.name}</span>
                  </td>
                </tr>,
                ...statusRowsOf(g.rows, yy, relationTypeOf).map(r => (
                  <tr key={r.key} className={`border-t ${r.status === "완료" ? "bg-orange-100" : r.isSubtotal ? "bg-muted/40" : ""}`}>
                    <td className={`px-2 py-1 truncate ${r.isSubtotal ? "pl-4 text-muted-foreground" : ""}`} title={r.label}>
                      {r.label}
                      {r.depNote && (
                        <span title={r.depNote}
                          className="ml-1 inline-flex items-center rounded bg-sky-100 px-1 text-[9px] font-medium text-sky-700 cursor-help align-middle">depNote</span>
                      )}
                    </td>
                    <td className="px-2 py-1 border-l font-mono text-[11px] font-semibold">{r.code}</td>
                    <td className="px-2 py-1 border-l text-center whitespace-nowrap"><RelationBadge rel={r.relation} /></td>
                    <td className={`px-2 py-1 border-l font-mono text-[10px] truncate ${r.ntsIn === "—" ? "text-muted-foreground/40" : "text-foreground"}`}>{r.ntsIn}</td>
                    <td className={`px-2 py-1 border-l font-mono text-[10px] ${r.ntsOut === "—" ? "text-muted-foreground/40" : "font-semibold"}`}>{r.ntsOut}</td>
                    <td className={`px-2 py-1 border-l font-mono text-[10px] truncate ${r.ytsIn === "—" ? "text-muted-foreground/40" : "text-foreground"}`} title={r.ytsIn}><SrcCell text={r.ytsIn} /></td>
                    <td className={`px-2 py-1 border-l font-mono text-[10px] truncate ${r.ytsOut === "—" ? "text-muted-foreground/40" : "text-foreground"}`} title={r.ytsOut}><SrcCell text={r.ytsOut} /></td>
                    {(() => {
                      const c = coverageOf(r.code.split(" ")[0], coverage)
                      // 소계 합성행(자기 send 경로 없음)은 커버리지 대상 아님 → —. 미등록(send:true 누락)은 "미분류"(적색).
                      const noCov = !c && r.isSubtotal
                      return (
                        <td className="px-2 py-1 border-l text-center whitespace-nowrap">
                          {noCov ? <span className="text-muted-foreground/40">—</span> : <VerdictBadge verdict={c?.verdict} />}
                        </td>
                      )
                    })()}
                    <td className="px-2 py-1 border-l text-center whitespace-nowrap"><StatusBadge status={r.status} /></td>
                  </tr>
                )),
              ]
            })}
          </tbody>
        </table>
      </DetailPanel>

      {/* 계산과정 순서 로스터 — 실행과정 ③표 정렬 기준 */}
      <DetailPanel
        title={`계산과정 순서 로스터 (${rosterRows.length}) — 실행과정 ③표 정렬 기준`}
        extra={<span className="text-[10px] font-normal text-muted-foreground"><span className="font-mono">mapping/{ntsYear}.ts › PROC_LABEL_CODE_{ntsYear}</span>{rosterUnknown > 0 && <span className="text-red-600 font-semibold"> · 미등록 {rosterUnknown}</span>}</span>}
        collapsed={isCollP("roster")} onToggle={() => toggleP("roster")} onExpandOnly={() => expandOnlyP("roster")} maximized={focused === "roster"}
        headerBg="bg-amber-100"
      >
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr className="text-[10px] text-muted-foreground text-left">
              <th className="px-2 py-1 border-b border-r font-medium w-8 text-right bg-muted">#</th>
              <th className="px-2 py-1 border-b border-r font-medium bg-muted">계산과정 라벨</th>
              <th className="px-2 py-1 border-b border-r font-medium w-14 bg-muted">코드</th>
              <th className="px-2 py-1 border-b font-medium bg-muted">매핑 위치</th>
            </tr>
          </thead>
          <tbody>
            {rosterRows.map(r => (
              <tr key={r.i} className={`border-t ${r.kind === "unknown" ? "bg-red-50/60" : ""}`}>
                <td className="px-2 py-0.5 border-r text-right tabular-nums text-muted-foreground/60">{r.i}</td>
                <td className="px-2 py-0.5 border-r">{r.label}</td>
                <td className="px-2 py-0.5 border-r font-mono text-[11px] font-semibold">{r.code}</td>
                <td className={`px-2 py-0.5 ${r.kind === "unknown" ? "text-red-600 font-semibold" : r.kind === "input" ? "" : "text-muted-foreground"}`}>
                  {r.kind === "input" ? r.group
                    : r.kind === "sub" ? "소계 OUT (개별행 outCode)"
                    : r.kind === "flow" ? "결과·흐름 (국세청 자체계산)"
                    : r.kind === "internal" ? "NTS 내부코드 (의도적 미사용)"
                    : "미등록 — 신규항목 확인"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DetailPanel>
    </div>
  )
}
