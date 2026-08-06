import { chromium, type Page, type Browser } from "playwright"
import { getYearConfig } from "@/features/hometax-calc/mapping/registry"
import { computeInputs, mappingSentValue } from "@/features/hometax-calc/mapping/engine"
import type { NtsProfile } from "@/features/hometax-calc/mapping/ntsProfile"
import type { MappingRow, NtsInputRow } from "@/features/hometax-calc/mapping/types"

const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const ATTR_YR   = "2025"   // 기본 귀속연도(runHometaxCompare 기본 인자). 실제 연도·엔드포인트는 프로파일에서.
const SESSION_TTL_MS = 25 * 60 * 1000 // 25분 (NTS 세션 만료 전 갱신)

// ── 세션 스토어 (Next.js 프로세스 내 재사용, 귀속연도별) ─────────────────────
//   ★연도별로 분리: 2025·2026 계산기는 진입 화면·엔드포인트가 달라 세션을 공유하면 안 된다.
declare global {
  var __ntsSessions: Record<string, { browser: Browser; page: Page; at: number }> | undefined
}
function sessionStore(): Record<string, { browser: Browser; page: Page; at: number }> {
  return (globalThis.__ntsSessions ??= {})
}

async function getOrCreateSession(year: string): Promise<Page> {
  const store = sessionStore()
  const s = store[year]

  if (s) {
    const age = Date.now() - s.at
    if (age < SESSION_TTL_MS) {
      try {
        await s.page.title()
        return s.page
      } catch {
        await s.browser.close().catch(() => {})
        delete store[year]
      }
    } else {
      await s.browser.close().catch(() => {})
      delete store[year]
    }
  }

  // 화면 안(오프스크린 아님)에 생성하되, 아래 minimizeWindow 로 즉시 최소화 → 작업표시줄에만 존재.
  // 보고 싶으면 작업표시줄 아이콘 클릭으로 복원. (--window-position 은 복원 시 뜰 위치)
  const browser = await chromium.launch({ headless: false, args: ["--window-position=120,120"] })
  const page    = await establishSession(browser, getYearConfig(year).profile)
  store[year] = { browser, page, at: Date.now() }
  return page
}

// ── 세션 관리 공개 API (연도 기본값 2025 — 호출측 미지정 시 현행 동작 유지) ────────
export async function startNtsSession(year: string = "2025"): Promise<void> {
  await getOrCreateSession(year)
}

export function stopNtsSession(year?: string): void {
  const store = sessionStore()
  for (const y of year ? [year] : Object.keys(store)) {
    store[y]?.browser.close().catch(() => {})
    delete store[y]
  }
}

export function getNtsSessionInfo(year: string = "2025"): { active: boolean; ageMinutes: number | null } {
  const store = sessionStore()
  const s = store[year]
  if (!s) return { active: false, ageMinutes: null }
  const age = Date.now() - s.at
  if (age >= SESSION_TTL_MS) {
    s.browser.close().catch(() => {})
    delete store[year]
    return { active: false, ageMinutes: null }
  }
  return { active: true, ageMinutes: Math.floor(age / 60000) }
}

// ── NTS 세션 수립 공통 함수 ─────────────────────────────────────────────────
// 세션 창을 즉시 최소화(작업표시줄로) — CDP Browser.setWindowBounds. viewport(논리 뷰포트)는 유지돼
//   최소화 상태에서도 CDP 기반 클릭 네비·fetch 는 정상 동작(오프스크린으로도 수립되던 것과 동형).
async function minimizeWindow(page: Page): Promise<void> {
  try {
    const s = await page.context().newCDPSession(page)
    const { windowId } = await s.send("Browser.getWindowForTarget") as { windowId: number }
    await s.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } })
  } catch { /* 최소화 실패해도 세션 수립엔 지장 없음 */ }
}

async function establishSession(browser: Browser, profile: NtsProfile): Promise<Page> {
  const ctx  = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await ctx.newPage()
  await minimizeWindow(page)   // 생성 즉시 최소화 → 수립 과정도 화면에 안 보임
  page.on("dialog", d => d.accept().catch(() => {}))

  await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(7000)

  // 오른쪽 '모의계산' 클릭
  await clickByExactText(page, "모의계산", { preferRight: true })
  await page.waitForTimeout(6000)

  // '연말정산 자동계산하기' → 드롭다운 → 해당 귀속연도(프로파일의 dropdownId)
  try { await page.getByText("연말정산 자동계산하기", { exact: true }).first().click({ timeout: 8000 }) } catch {}
  await page.waitForTimeout(2000)
  await page.evaluate((dropdownId) => {
    const els = Array.from(document.querySelectorAll(`[id="${dropdownId}"]`)) as HTMLElement[]
    const vis = els.filter(e => e.offsetParent !== null)
    ;(vis[0] || els[0])?.click()
  }, profile.dropdownId)
  await page.waitForTimeout(9000)

  return page
}

// ── L03 직접 POST ────────────────────────────────────────────────────────────
async function postL03(page: Page, body: object, url: string): Promise<string> {
  return page.evaluate(async ({ url, bodyStr }) => {
    const res = await fetch(url, {
      method:      "POST",
      headers:     { "Content-Type": "application/json;charset=UTF-8" },
      body:        bodyStr,
      credentials: "include",
    })
    return res.text()
  }, { url, bodyStr: JSON.stringify(body) })
}

// ── amtClusCd → ddcAmt 파싱 ──────────────────────────────────────────────────
function pickDdcAmt(list: Array<Record<string, unknown>>, code: string): number | null {
  const it = list.find(x => String(x.amtClusCd) === code)
  if (!it) return null
  const v = it.ddcAmt
  return typeof v === "number" ? v : v != null ? Number(v) : null
}

// ─────────────────────────────────────────────────────────────────────────────
// ▶ YTS39 공제 데이터를 NTS L03에 직접 전송해 비교하는 함수
// ─────────────────────────────────────────────────────────────────────────────

export interface NtsCompareResult {
  prodTax:    number | null
  decidedTax: number | null
  workDdc:    number | null
  taxBase:    number | null
  resultCode: string | null
}

// 국세청 L03 detail 한 행의 전 필드(IN=보낸 payload / OUT=회신) — 코드별 전체 표시용
export interface NtsIoRow {
  code:          string
  useAmt:        number
  ddcLmtAmt:     number
  incDdcNfpCnt:  number
  ddcTrgtAmt:    number
  ddcAmt:        number
}

export interface HometaxCompareResult {
  nts:          NtsCompareResult
  coveredCodes: string[]
  /** 전 매핑행 입력상태(0 포함) — 상세뷰·미전송감지용 (mapping/2025.ts) */
  inputs:       NtsInputRow[]
  /** 값은 있으나 아직 미전송(send:false)인 항목 — 결과차이 원인 후보 자동적출 */
  missing:      { code: string; label: string; ytsCol: string | null; amount: number; status: string }[]
  /** NTS 응답 코드별 ddcAmt 전체 맵 (계산흐름·반영액 추적용) */
  ntsMap:       Record<string, number>
  /** 국세청에 보낸 payload 전체(값 있는 코드) — 코드별 IN 전 필드 */
  ntsIn:        NtsIoRow[]
  /** 국세청 회신 전체(값 있는 코드) — 코드별 OUT 전 필드 */
  ntsOut:       NtsIoRow[]
}

const _num = (v: unknown): number => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0 }
function toIoRow(it: Record<string, unknown>): NtsIoRow {
  return {
    code:         String(it.amtClusCd),
    useAmt:       _num(it.useAmt),
    ddcLmtAmt:    _num(it.ddcLmtAmt),
    incDdcNfpCnt: _num(it.incDdcNfpCnt),
    ddcTrgtAmt:   _num(it.ddcTrgtAmt),
    ddcAmt:       _num(it.ddcAmt),
  }
}
// IN 의미필드(한도 에코 ddcLmtAmt 제외) / OUT 은 전 필드 중 하나라도
const _hasIn  = (r: NtsIoRow) => r.useAmt || r.incDdcNfpCnt || r.ddcTrgtAmt || r.ddcAmt
const _hasOut = (r: NtsIoRow) => r.useAmt || r.incDdcNfpCnt || r.ddcTrgtAmt || r.ddcAmt || r.ddcLmtAmt

// 코드 카탈로그·입력요약·결과흐름코드는 mapping/2025.ts 로 이관 (단일 원천).

// 전체 amtClusCd 목록 — 모두 0 초기화 후 우리 값 주입
const ALL_CODES = [
  "8900",
  "8001","8002","8003","8101","8102","8103","8104",
  "8201","8205","8208","8211","8215",
  "8301","8305","8311","8312",
  "8321","8322","8323","8324","8325","8326","8327","8328","8329",
  "8401","8402","8403","8404","8406","8407",
  "8410","8415","8416","8417","8418","8419","8420","8421","8422","8423",
  "8430","8431","8432","8433","8434","8435","8438","8440","8442","8464","8465","8466","8467",
  "8450","8451","8452","8453","8461","8462","8463","8501",
  "8601","8602","8603","8606","8608","8609","8610","8611","8612","8614","8616","8617","8916",
  "8701","8702","8703","8705","8706","8707","8708",
  "8710","8711",
  "8720","8721","8725","8726","8729",
  "8730","8731","8732","8733","8734","8735",
  "8740","8741","8743","8744","8746","8747",
  "8750","8751","8752","8753","8754","8906",
  "8760","8761","8763","8764","8765","8766","8783","8784","8790",
  "8811","8812","8813","8814","8815",
  "8821","8822","8823","8824","8825",
  "8831","8832","8833","8834","8835",
]

function buildCompareBody(vals: Record<string, number>, attrYr: string, mapping: MappingRow[], marriageCredit: number, omitCodes: string[] = [], detailRowExtra: Record<string, string> = {}): { body: object; coveredCodes: string[] } {
  // 요청 코드셋 = 검증된 ALL_CODES ∪ 전송대상(send) 매핑의 실입력코드(sendCode 지정 시 그것, 없으면 ntsCode)
  //   ★sendCode 필수 포함: 표시코드(ntsCode)와 국세청 실입력코드가 다른 행(예 8603→8607)은
  //     sendCode 로 detail 행이 생겨야 setAmt 가 값을 주입한다. (표시코드는 ALL_CODES 에 있어 OUT 에코 대조 유지)
  // omitCodes: 계약 A/B 프로브용 — 특정 amtClusCd 를 payload 에서 아예 제외(0 전송조차 안 함)
  const codes = Array.from(new Set([...ALL_CODES, ...mapping.filter(m => m.send).map(m => m.sendCode ?? m.ntsCode)]))
    .filter(c => !omitCodes.includes(c))
  // detailRowExtra: 연도 프로파일(PROFILE_2026 등)이 각 detail 행에 병합할 신규필드(ereClCd/yrsSrvcClCd/statusValue/ddcRtnId).
  //   2025는 detailRowExtra 없음(={}) → 스프레드가 no-op이라 동작 불변. 이것이 C 방식의 유일한 엔진 확장.
  const detail = codes.map(code => ({
    amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0",
    ...detailRowExtra,
  }))

  const setAmt = (code: string, field: string, val: number) => {
    if (!val) return
    const item = detail.find(it => it.amtClusCd === code)
    if (item) (item as Record<string, string>)[field] = String(val)
  }

  // 매핑표에서 send:true 인 행만 값 주입(incDdcNfpCnt/useAmt 등).
  //   자녀공제(8763): 부양가족 8004~8009(유형별) + 8763 총인원 둘 다 필요(유형별만으론 미산출).
  //   출산입양(8761): 순번별 8764~8766 이 산출(총인원 전송은 잉여). (2026-07-17 실측 정정)
  for (const m of mapping) {
    if (!m.send) continue
    if (m.ntsCode === "8790") continue          // 혼인공제만 아래 특수전송
    // sendCode: 표시코드(ntsCode)와 실제 국세청 입력코드가 다를 때 전송코드로 사용.
    //   ★조특법30조 70%: 표시 8603 / 실입력 8607(2026-08-07 라이브캡처+프로브 실측). 국세청은 8603 IN 을
    //     받지 않고 8607 useAmt 로만 감면세액을 산출한다. 세액감면은 전부 useAmt 만으로 서버가 재계산
    //     (ddcTrgtAmt·ddcLmtAmt=-1 은 화면 payload 에 없는 값이라 불필요 — 25e0030 추측 롤백).
    const code = m.sendCode ?? m.ntsCode
    const val  = mappingSentValue(m, vals, marriageCredit)
    setAmt(code, m.valueKey, val)
  }

  // 혼인세액공제(8790) 특수: 자격(FAM_MRRG>0=혼인세액공제대상 배우자)이면 원본 500,000 전송 → 국세청이 잔액 소진캡 독립적용.
  //   ★RT_MRRG(소진후값)를 보내면 소진 검증 사각(우리가 캡한 값을 국세청이 에코). 원본을 보내야 국세청이 소진을 독립재현
  //   → YTS RT_MRRG(엔진캡)와 대조로 소진로직 교차검증. 자격은 소진 무관한 원데이터라 완전소진자도 포착. (2026-07-25 실측)
  const mrrgEligible = Number(vals.FAM_MRRG ?? 0) > 0
  if (mrrgEligible) { setAmt("8790", "incDdcNfpCnt", 1); setAmt("8790", "ddcAmt", marriageCredit) }

  const totPay = Number(vals.TOT_PAY_AMT ?? 0)

  const coveredCodes = detail
    .filter(it => Number(it.useAmt) > 0 || Number(it.incDdcNfpCnt) > 0 || Number(it.ddcTrgtAmt) > 0)
    .map(it => it.amtClusCd)

  const body = {
    crdcDdcAmt: "0", smltClcClCd: attrYr, v_saveChk: "Y", v_conbChk: "", yrsSrvcClCd: "",
    pbtAddDdcAmt: "0", pbtDdcAmt: "0", addDdcrtDdcAmt: "0", ddcPsbAmt: "0",
    tdmrAddDdcAmt: "0", lstDdcAmt: "0", tdmrDdcAmt: "0", bppAddDdcAmt: "0",
    gnrlDdcAmt: "0", ddcExclAmt: "0",
    totaSnwAmt: String(totPay), ddcLmtAmt: "0",
    yrsTaxClcBscList: [{
      ppmTxamt: "0", attrYr: attrYr,   // 기납부세액 비교 범위 밖(결정세액까지만 비교) → 항상 0 고정
      ddcRtnId: "", erinAmt: "0", totaSnwAmt: String(totPay), statusValue: "R",
    }],
    yrsTaxClcDetailDVOList: detail,
  }

  return { body, coveredCodes }
}

export async function runHometaxCompare(vals: Record<string, number>, attrYr: string = ATTR_YR, opts: { omitCodes?: string[] } = {}): Promise<HometaxCompareResult> {
  const cfg     = getYearConfig(attrYr)
  const inputs  = computeInputs(vals, cfg.mapping, cfg.marriageCredit)
  // 값은 있으나 아직 미전송(send:false)인 항목 = 결과차이 원인 후보 (자동 적출)
  //   altSent(대체전송, 예 8003 부양가족통합→8004~09 유형별)은 실질 전송돼 차이원인 아님 → 제외(거짓경보 방지)
  const missing = inputs
    .filter(i => !i.send && i.hasValue && !i.altSent)
    .map(i => ({
      code:   i.code,
      label:  i.label,
      ytsCol: i.ytsCol,
      amount: i.ytsCol ? Number(vals[i.ytsCol] ?? 0) : 0,
      status: i.status,
    }))

  const { body, coveredCodes } = buildCompareBody(vals, attrYr, cfg.mapping, cfg.marriageCredit, opts.omitCodes ?? [], cfg.profile.detailRowExtra ?? {})

  // 세션 재사용 — 없으면 생성 (첫 실행 ~30초, 이후 재사용)
  const page = await getOrCreateSession(attrYr)
  // 세션 생성 후 info 갱신을 위해 at 업데이트
  const store = sessionStore()
  if (store[attrYr]) store[attrYr].at = Date.now()

  try {
    const raw    = await postL03(page, body, cfg.profile.l03Url)
    const parsed = JSON.parse(raw) as { yrsTaxClcDetailDVOList?: Array<Record<string, unknown>>; resultMsg?: { result?: string } }
    const list   = parsed.yrsTaxClcDetailDVOList ?? []

    // 응답 코드별 ddcAmt 전체 맵 (계산흐름·반영액 추적용)
    const ntsMap: Record<string, number> = {}
    for (const it of list) {
      const code = String(it.amtClusCd)
      const v = it.ddcAmt
      ntsMap[code] = typeof v === "number" ? v : v != null ? Number(v) : 0
    }

    // 코드별 IN/OUT 전 필드 보존 (상세뷰 전체표시용) — IN=보낸 payload, OUT=회신
    const sentList = (body as { yrsTaxClcDetailDVOList?: Array<Record<string, unknown>> }).yrsTaxClcDetailDVOList ?? []
    const ntsIn  = sentList.map(toIoRow).filter(_hasIn)
    const ntsOut = list.map(toIoRow).filter(_hasOut)

    return {
      nts: {
        prodTax:    pickDdcAmt(list, "8990"),
        decidedTax: pickDdcAmt(list, "8999"),
        workDdc:    pickDdcAmt(list, "8901"),
        taxBase:    pickDdcAmt(list, "8903"),
        resultCode: parsed.resultMsg?.result ?? null,
      },
      coveredCodes,
      inputs,
      missing,
      ntsMap,
      ntsIn,
      ntsOut,
    }
  } catch (e) {
    // 예외 시 해당 연도 세션 초기화
    await store[attrYr]?.browser.close().catch(() => {})
    delete store[attrYr]
    throw e
  }
}

/** 전 프레임에서 정확히 일치하는 텍스트 요소를 클릭 (오른쪽 우선 옵션) */
async function clickByExactText(
  page: Page,
  text: string,
  opts: { preferRight?: boolean } = {}
): Promise<boolean> {
  for (const f of page.frames()) {
    try {
      const ok = await f.evaluate(
        ({ t, preferRight }) => {
          let els = (Array.from(
            document.querySelectorAll("a,button,input,li,span,div")
          ) as HTMLElement[]).filter(
            (e) =>
              (e.offsetWidth || e.offsetHeight) &&
              (e.textContent || (e as HTMLInputElement).value || "").trim() === t
          )
          if (preferRight) {
            els = els.sort(
              (a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left
            )
          }
          if (els[0]) {
            els[0].click()
            return true
          }
          return false
        },
        { t: text, preferRight: !!opts.preferRight }
      )
      if (ok) return true
    } catch {
      /* 무시 */
    }
  }
  return false
}
