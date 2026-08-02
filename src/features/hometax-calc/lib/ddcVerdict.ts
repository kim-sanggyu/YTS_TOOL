/**
 * 코드별 대조 판정 단일원천 — 드로어 ③표·리스트 배지("차이 N건")·차이만보기가 전부 이 모듈을 쓴다.
 * 과거엔 리스트는 합/소계/`?? 0`, 드로어는 코드별 giftCmp 로 갈려 같은 사람이 화면마다 다르게 판정됐다.
 * 순수 함수만 두어 유닛테스트 가능(HometaxCalcPanel.tsx 에서 추출, 2026-07-28).
 *
 * ▶ 연도 구동화(2026-07-29): 매핑 의존분(MAP_ORDER·SUBTOTAL_OF·DDC_DOMAIN 및 이를 참조하는
 *   ddcVerdict/diffCodesOf/hiddenDiffCodes)은 makeYearVerdict(mapping) 팩토리로 생성한다.
 *   컴포넌트는 getYearConfig(ntsYear).mapping 으로 인스턴스를 만들어 드롭다운 연도를 따라간다.
 *   연도 무관분(OUT_GROUPS·outCodeOf·SUBTOTAL_CODES·FLOW_CODES)은 모듈 상수로 남긴다.
 */
import type { MappingRow } from "@/features/hometax-calc/mapping/types"
import { CARD_SUBTOTAL_CODE } from "@/features/hometax-calc/mapping/card"
import { MEDI_SUBTOTAL_CODE } from "@/features/hometax-calc/mapping/medi"
import { GIFT_CODES } from "@/features/hometax-calc/mapping/gift"

// self OUT(각 코드가 자기 ddcAmt 회신) 그룹. 연금보험료·특별소득공제(건강고용·주택자금)는 소득공제지만
//   라이브 캡처로 코드별 self ddcAmt 회신 실측확정(2026-07-18). ※카드(소계 8430)는 그밖의소득공제라 아래서 CARD_ 우선처리로 제외.
//   ★기타세액공제(8751 외국납부·8752 주택차입이자·8753 납세조합)도 self(resultCol RT_FCG/RT_HBA/RT_PTU) — 이 그룹이 빠져
//     outCodeOf가 "—"로 떨어져 맵현황 nts OUT을 잘못 비웠던 것 교정(2026-08-02, 데이터 정비 A1). 단 8754(국외총급여)는 group "세액공제"+outCode "—"라 그대로 1:0 유지.
export const OUT_GROUPS = new Set(["세액공제", "세액감면", "연금계좌", "기부금", "연금보험료", "특별소득공제", "기타세액공제"])

// 국세청 결과(OUT) 코드: 명시 outCode 우선 → 소계형(가상컬럼 prefix) → self → 없음(—)
export function outCodeOf(m: MappingRow): string {
  if (m.outCode) return m.outCode
  if (m.ytsCol?.startsWith("CARD_")) return CARD_SUBTOTAL_CODE
  if (m.ytsCol?.startsWith("MEDI_")) return MEDI_SUBTOTAL_CODE
  if (m.ytsCol?.startsWith("OTHER_")) return m.ntsCode      // 그밖의소득공제 self(개인연금저축8401·노란우산8402, 실측)
  // 연금(PEN_)은 실측확정 항목별 self OUT을 매핑 outCode 로 명시 → helper 폴백은 self
  if (OUT_GROUPS.has(m.group)) return m.ntsCode
  return "—"
}

// 소계형: 개별 입력행들이 하나의 소계 코드로 결과(ddcAmt)를 받는 그룹. 여기 매핑되면 self OUT 아님.
//   코드=화면 동기: outCode/CARD_·MEDI_ prefix(=payload 실측근거)에서만 파생, 그룹명 하드코딩 금지.
//   ytsOut = 실제 비교탭이 대조 기준으로 읽는 YTS 물리 공제컬럼(카드=OTO_CARD_ETC, 의료=RT_MEDI_AMT).
export const SUBTOTAL_CODES = new Map<string, { label: string; ytsOut: string }>([
  [CARD_SUBTOTAL_CODE, { label: "카드소득공제 소계", ytsOut: "OTO_CARD_ETC" }],
  [MEDI_SUBTOTAL_CODE, { label: "의료비 세액공제 소계", ytsOut: "RT_MEDI_AMT" }],
  ["8761",             { label: "출산·입양 세액공제 소계", ytsOut: "RT_PER_CHI_AMT" }],   // 순번별 8764~8766(outCode 8761)의 소계 OUT. 8761엔 값 미전송(잉여, 2026-07-17 실측)
  ["8735",             { label: "교육비 세액공제 소계", ytsOut: "RT_EDU_AMT" }],           // 8730(outCode 8735)에 공제대상 총액 전송, 8735=결과전용 소계(2026-07-17 실측)
  ["8410",             { label: "투자조합출자 소계", ytsOut: "OTO_IU_ETC" }],               // self-subtotal(매핑행 8410 자체가 소계). 개별 8415~8423은 self OUT도 반환(하이브리드) → 멤버 아닌 결과전용행으로 렌더(2026-07-21 프로브)
  ["8705",             { label: "ISA 연금계좌 추가납입 소계", ytsOut: "RT_ISA_PEN_AMT" }],   // 8707/8708(outCode 8705)의 소계 OUT. YTS는 RT_ISA_PEN_AMT 합산단일컬럼뿐이라 per-code 불가 → 소계 대조(2026-07-26 실측)
])

// 계산흐름 7행(①결과비교)에 나오는 코드 — ③ 항목대조에서 제외(중복). compareRows 코드셋과 동일.
export const FLOW_CODES = new Set(["8900", "8901", "8902", "8903", "8990", "8700", "8999"])

export type Verdict = "match" | "diff" | null

/** 실행과정 대응관계 유형 = 송신 코드 개수 : 대조 회신 개수.
 *  1:0=입력만(대조 회신 없음) · 1:1=self 대조 · N:1=여러 코드→집계코드 대조.
 *  ※ 자동 파생은 이 3유형만. 1:N(국세청 구간분해)·0:1(결과계 코드)은 보류
 *    — 1:N은 현재 1:1로 잡히고, 0:1 결과계 코드는 매핑 배열 밖이라 맵현황에 나타나지 않는다. */
export type RelationType = "1:0" | "1:1" | "N:1" | "1:N" | "0:1"

/** 판정 입력 = 코드별 NTS OUT(ntsMap)·YTS 공제(ytsDdcMap) 두 맵. RowResult 가 구조적으로 만족한다. */
export interface DdcCells { ntsMap: Record<string, number>; ytsDdcMap: Record<string, number> }

/** 연도별 판정 인스턴스 — makeYearVerdict(mapping) 이 반환. 매핑 정의순·소계역참조에 의존하는 전부. */
export interface YearVerdict {
  MAP_ORDER: Map<string, number>
  SUBTOTAL_OF: Map<string, string>
  DDC_DOMAIN: string[]
  ddcVerdict: (res: DdcCells, code: string) => Verdict
  diffCodesOf: (res: DdcCells, codes: Iterable<string | null>) => string[]
  hiddenDiffCodes: (res: DdcCells, domain: Iterable<string | null>, lineCodes: Iterable<string>) => string[]
  relationTypeOf: (m: MappingRow) => RelationType
}

/**
 * 연도별 판정 인스턴스 생성. mapping = getYearConfig(year).mapping.
 * MAP_ORDER·SUBTOTAL_OF·DDC_DOMAIN 을 이 매핑으로 계산하고, 판정 3함수는 그것을 클로저로 참조한다.
 */
export function makeYearVerdict(mapping: MappingRow[]): YearVerdict {
  // 소계 멤버코드 → 소계코드 역참조. ③표 그룹블록 정렬용: 계산과정엔 소계 한 줄만 나오므로
  //   개별 멤버(8431~/8720~/8730/8764~)를 소계코드(8430/8726/8735/8761) 위치 바로 뒤에 붙인다.
  const SUBTOTAL_OF = new Map<string, string>()
  for (const row of mapping) {
    const oc = outCodeOf(row)
    if (SUBTOTAL_CODES.has(oc) && oc !== row.ntsCode) SUBTOTAL_OF.set(row.ntsCode, oc)
    else if (row.displaySubtotal) SUBTOTAL_OF.set(row.ntsCode, row.displaySubtotal)   // 표시전용 그룹핑(부양가족 8004~09→8003) — outCode 무관, ③표 정렬만
  }

  // ③ 항목대조 순서·필터용 — 매핑 정의순(단일원천). 컴포넌트 mapOrder 도 이걸 참조한다.
  const MAP_ORDER = new Map<string, number>()
  mapping.forEach((row, i) => { if (!MAP_ORDER.has(row.ntsCode)) MAP_ORDER.set(row.ntsCode, i) })

  // ③ 드로어가 대조하는 전 코드 도메인(매핑 순 + 소계). 리스트 배지·경고행이 같은 범위로 대조.
  const DDC_DOMAIN = [...MAP_ORDER.keys(), ...SUBTOTAL_CODES.keys()]

  // 코드 하나의 YTS공제 ↔ NTS OUT(ntsMap[code]=응답 ddcAmt) 대조.
  //   판정대상 아님(null): 계산흐름(①중복)·매핑밖(국세청 내부코드)·소계 멤버(소계행이 담당).
  //   기부 코드는 YTS 공제 없어도 0 으로 대조(국세청 자체생성 고향특별 8784 등), 그 외 YTS 없으면 대조점 아님.
  //   둘 다 0/없음 → 대조 없음(none). 둘 다 값 → 원단위 일치 판정.
  const ddcVerdict = (res: DdcCells, code: string): Verdict => {
    if (FLOW_CODES.has(code)) return null
    if (!MAP_ORDER.has(code) && !SUBTOTAL_CODES.has(code)) return null
    if (SUBTOTAL_OF.has(code)) return null
    const nts = res.ntsMap[code] as number | undefined
    const yts = res.ytsDdcMap[code] ?? (GIFT_CODES.has(code) ? 0 : undefined)
    return (yts != null && nts != null && (yts || nts)) ? (yts === nts ? "match" : "diff") : null
  }

  // 코드 집합 중 diff 인 코드들(중복 제거) — 배지·건수·차이만보기가 공유.
  const diffCodesOf = (res: DdcCells, codes: Iterable<string | null>): string[] => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const c of codes) {
      if (!c || seen.has(c)) continue
      seen.add(c)
      if (ddcVerdict(res, c) === "diff") out.push(c)
    }
    return out
  }

  // 드로어 ③표에서 ✗(diff)인데 리스트 라인에 없는 코드 = "숨은 불일치".
  //   ★불변식(2026-07-28, 상규님): 드로어 ✗ 는 예외 없이 전부 리스트에도 드러나야 한다
  //   (국세청 자체생성 8784 포함 — "모든 오류가 화면에 보여야 사람이 발견한다"는 도구 존재이유).
  //   ▶ domain = "그 탭이 책임지는 코드 집합"(기부탭=GIFT_CODES, 인적공제탭=그 그룹 코드…). 탭 밖 코드는
  //     그 탭 소관이 아니다(8001 인적공제가 기부탭에 새면 안 됨). 각 탭이 자기 domain 을 넘긴다.
  //     전체 안전망(dev 감지기)만 DDC_DOMAIN(전 코드)로 훑어 어느 탭에도 안 걸리는 코드를 잡는다.
  //   소계코드(카드8430·의료8726)는 리스트가 소계행/집계로 이미 대조하므로 제외(중복 아님).
  //   리스트 경고행·본행 배지·dev 감지기가 이 함수 하나를 공유(판정 분기 원천 차단).
  //   ⚠ 알려진 한계: 탭들이 넘기는 domain 은 대개 "그 탭에 실제 표시되는 라인 코드"라, 의도적으로 생략된
  //     코드(인적공제 본인 8001 등)는 여기서 안 잡힌다. 8001은 절사 ±1원 무해라 수용(상규님 2026-07-28).
  //     생략 코드에 큰 오류가 나면 dev 감지기(DDC_DOMAIN 전 코드)가 콘솔로 최후 포착. 재발 시 domain 을
  //     그룹 전체 코드로 넓히거나 절사(±1) match 처리를 검토.
  const hiddenDiffCodes = (res: DdcCells, domain: Iterable<string | null>, lineCodes: Iterable<string>): string[] => {
    const listSet = new Set(lineCodes)
    return diffCodesOf(res, domain).filter(c => !listSet.has(c) && !SUBTOTAL_CODES.has(c))
  }

  // 실행과정 대응관계 유형(자동 3유형: 1:0·1:1·N:1). SUBTOTAL_OF(멤버→집계 역참조)로 집계코드까지 정확히 분류.
  const AGGREGATE_CODES = new Set(SUBTOTAL_OF.values())   // 집계·통합 대조코드(8430·8726·8003·8761·8735·8705…)
  const relationTypeOf = (m: MappingRow): RelationType => {
    if (SUBTOTAL_OF.has(m.ntsCode)) return "N:1"                                       // 소계 멤버(카드·의료·출산·교육·부양가족 8004~09)
    if (AGGREGATE_CODES.has(m.ntsCode) || SUBTOTAL_CODES.has(m.ntsCode)) return "N:1"  // 집계 대조코드(8003)·self-subtotal(8410)
    if (outCodeOf(m) !== "—") return "1:1"                                             // self 대조(OUT_GROUPS·prefix로 self OUT 확정)
    // outCodeOf "—": 대조되는 코드면 1:1, 순수 입력이면 1:0.
    //   ·resultCol 있음 = self 대조(인적공제 8001·8002·8101~04는 group이 OUT_GROUPS 밖이라 oc="—"지만 self)
    //   ·FLOW_CODES = echo 대조(총급여 8900, resultCol 없이 useAmt echo로 대조)
    //   ·둘 다 아님 = 동반입력(8754 국외총급여, 자체 결과 없음)
    if (m.resultCol || FLOW_CODES.has(m.ntsCode)) return "1:1"
    return "1:0"
  }

  return { MAP_ORDER, SUBTOTAL_OF, DDC_DOMAIN, ddcVerdict, diffCodesOf, hiddenDiffCodes, relationTypeOf }
}
