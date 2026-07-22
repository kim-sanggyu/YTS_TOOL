import { chromium, type Page, type Browser } from "playwright"
import { MAPPING_2025, computeInputs, mappingSentValue, type NtsInputRow } from "@/features/hometax-calc/mapping/2025"

const START_URL = "https://hometax.go.kr/websquare/websquare.html?w2xPath=/ui/pp/index_pp.xml&menuCd=index3"
const L03_URL   = "https://teys.hometax.go.kr/wqAction.do?actionId=ATEYSEAA001L03&screenId=UTEYSEJF01&popupYn=false&realScreenId="
const ATTR_YR   = "2025"
const SESSION_TTL_MS = 25 * 60 * 1000 // 25분 (NTS 세션 만료 전 갱신)

// ── 세션 싱글톤 (Next.js 프로세스 내 재사용) ─────────────────────────────────
declare global {
  var __ntsSession: { browser: Browser; page: Page; at: number } | undefined
}

async function getOrCreateSession(): Promise<Page> {
  const s = globalThis.__ntsSession

  if (s) {
    const age = Date.now() - s.at
    if (age < SESSION_TTL_MS) {
      try {
        await s.page.title()
        return s.page
      } catch {
        await s.browser.close().catch(() => {})
        globalThis.__ntsSession = undefined
      }
    } else {
      await s.browser.close().catch(() => {})
      globalThis.__ntsSession = undefined
    }
  }

  const browser = await chromium.launch({ headless: false, args: ["--window-position=-10000,0"] })
  const page    = await establishSession(browser)
  globalThis.__ntsSession = { browser, page, at: Date.now() }
  return page
}

// ── 세션 관리 공개 API ───────────────────────────────────────────────────────
export async function startNtsSession(): Promise<void> {
  await getOrCreateSession()
}

export function stopNtsSession(): void {
  globalThis.__ntsSession?.browser.close().catch(() => {})
  globalThis.__ntsSession = undefined
}

export function getNtsSessionInfo(): { active: boolean; ageMinutes: number | null } {
  const s = globalThis.__ntsSession
  if (!s) return { active: false, ageMinutes: null }
  const age = Date.now() - s.at
  if (age >= SESSION_TTL_MS) {
    s.browser.close().catch(() => {})
    globalThis.__ntsSession = undefined
    return { active: false, ageMinutes: null }
  }
  return { active: true, ageMinutes: Math.floor(age / 60000) }
}

// ── NTS 세션 수립 공통 함수 ─────────────────────────────────────────────────
async function establishSession(browser: Browser): Promise<Page> {
  const ctx  = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await ctx.newPage()
  page.on("dialog", d => d.accept().catch(() => {}))

  await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(7000)

  // 오른쪽 '모의계산' 클릭
  await clickByExactText(page, "모의계산", { preferRight: true })
  await page.waitForTimeout(6000)

  // '연말정산 자동계산하기' → 드롭다운 → 2025년
  try { await page.getByText("연말정산 자동계산하기", { exact: true }).first().click({ timeout: 8000 }) } catch {}
  await page.waitForTimeout(2000)
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[id="a_1905120000"]')) as HTMLElement[]
    const vis = els.filter(e => e.offsetParent !== null)
    ;(vis[0] || els[0])?.click()
  })
  await page.waitForTimeout(9000)

  return page
}

// ── L03 직접 POST ────────────────────────────────────────────────────────────
async function postL03(page: Page, body: object): Promise<string> {
  return page.evaluate(async ({ url, bodyStr }) => {
    const res = await fetch(url, {
      method:      "POST",
      headers:     { "Content-Type": "application/json;charset=UTF-8" },
      body:        bodyStr,
      credentials: "include",
    })
    return res.text()
  }, { url: L03_URL, bodyStr: JSON.stringify(body) })
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

function buildCompareBody(vals: Record<string, number>, attrYr: string): { body: object; coveredCodes: string[] } {
  // 요청 코드셋 = 검증된 ALL_CODES ∪ 전송대상(send) 매핑코드 (미래에 send flip 해도 항상 포함)
  const codes = Array.from(new Set([...ALL_CODES, ...MAPPING_2025.filter(m => m.send).map(m => m.ntsCode)]))
  const detail = codes.map(code => ({
    amtClusCd: code, useAmt: "0", ddcLmtAmt: "0", incDdcNfpCnt: "0", ddcTrgtAmt: "0", ddcAmt: "0",
  }))

  const setAmt = (code: string, field: string, val: number) => {
    if (!val) return
    const item = detail.find(it => it.amtClusCd === code)
    if (item) (item as Record<string, string>)[field] = String(val)
  }

  // 매핑표에서 send:true 인 행만 값 주입(incDdcNfpCnt/useAmt 등).
  //   자녀공제(8763): 부양가족 8004~8009(유형별) + 8763 총인원 둘 다 필요(유형별만으론 미산출).
  //   출산입양(8761): 순번별 8764~8766 이 산출(총인원 전송은 잉여). (2026-07-17 실측 정정)
  for (const m of MAPPING_2025) {
    if (!m.send) continue
    if (m.ntsCode === "8790") continue          // 혼인공제만 아래 특수전송
    // sendCode: 표시코드(ntsCode)와 실제 국세청 입력코드가 다를 때 전송코드로 사용(현재 지정 행 없음 — 인프라 유지)
    setAmt(m.sendCode ?? m.ntsCode, m.valueKey, mappingSentValue(m, vals))
  }

  // 혼인세액공제(8790) 특수: 국세청이 검산하지 않고 입력 ddcAmt 를 그대로 인정 → incDdcNfpCnt=1 + ddcAmt=RT_MRRG.
  const mrrg = Number(vals.RT_MRRG ?? 0)
  if (mrrg > 0) { setAmt("8790", "incDdcNfpCnt", 1); setAmt("8790", "ddcAmt", mrrg) }

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

export async function runHometaxCompare(vals: Record<string, number>, attrYr: string = ATTR_YR): Promise<HometaxCompareResult> {
  const inputs  = computeInputs(vals)
  // 값은 있으나 아직 미전송(send:false)인 항목 = 결과차이 원인 후보 (자동 적출)
  const missing = inputs
    .filter(i => !i.send && i.hasValue)
    .map(i => ({
      code:   i.code,
      label:  i.label,
      ytsCol: i.ytsCol,
      amount: i.ytsCol ? Number(vals[i.ytsCol] ?? 0) : 0,
      status: i.status,
    }))

  const { body, coveredCodes } = buildCompareBody(vals, attrYr)

  // 세션 재사용 — 없으면 생성 (첫 실행 ~30초, 이후 재사용)
  const page = await getOrCreateSession()
  // 세션 생성 후 info 갱신을 위해 at 업데이트
  if (globalThis.__ntsSession) globalThis.__ntsSession.at = Date.now()

  try {
    const raw    = await postL03(page, body)
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
    // 예외 시 세션 초기화
    await globalThis.__ntsSession?.browser.close().catch(() => {})
    globalThis.__ntsSession = undefined
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
