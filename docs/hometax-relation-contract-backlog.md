# 홈택스 대응관계 유형 계약 — 백로그 & 착수 가이드

> 이 문서는 "맵현황 대응관계 유형" 작업의 **잔여 과제·목표·맥락**을 한 곳에 모은 착수 가이드다.
> 나중에 이 일을 다시 시작할 때 이 문서만 읽으면 어디까지 됐고 무엇을 해야 하는지 바로 잡히도록 쓴다.
> 관련 상태 메모리: `project_hometax_relation_type` · `project_nts_verification_coverage_model`

---

## 1. 북극성 (목표)

**유형 = 생성기(generator).** 이게 다 정리되면 **유형을 보면 두 가지가 자동으로 결정된다:**

1. **비교가 어떻게 진행되는가** (무엇을 무엇과, 어디서 대조하는가)
2. **어떤 속성이 있어야/없어야 하는가** (배선 규칙)

양방향으로 흐른다:

- **유형 → 비교** : 비교 절차를 유형에서 **생성** → *"이것만 있으면 다른 곳에서 이 시스템을 다시 짤 수 있다"* (재생성 가능 명세)
- **유형 → 속성** : 있어야 할 속성이 정해지니 배선이 어긋나면 **경고** (정합 감시)

궁극 산출물 = **완전한·검증된·반증가능한 NTS 모의계산 명세.** 코드는 그 명세의 렌더러일 뿐.

## 2. 왜 이게 핵심인가 (맥락)

- **검증도구 자기무결성** — 도구가 자신만만하게 *틀린* 판정을 내는 게 최악(값 하나 틀린 것보다 위험). 계약이 "검증기를 검증"한다.
- **방어→공격** — 같은 지도의 양방향 읽기: 안쪽=우리 배선 드리프트 감지, 바깥쪽=NTS 개정 감지.
- **블랙박스** — 유형은 NTS를 수차례 probe해 관찰분류한 **증류물**. 파생 먼저는 정찰단계였고 지금이 lock 시점(probe→confirm→**lock**).
- **역공학 명세** — 문서가 아니라 관찰로 세운 것이라, 조항마다 **증거**(캡처·날짜·표본·확신도) 부착 필요 = 반증가능. 매핑의 `note`/`status`가 이미 잠재적 증거층.

---

## 3. 지금까지 한 것 (2026-08-02, 전부 push: dc4b5e1 / c6130fd / a847368)

- `relationTypeOf` 파생 + 맵현황 **"유형" 열/배지** + 회귀테스트 (`ddcVerdict.ts`, `HometaxCalcPanel.tsx`)
- **A1** — 기타세액공제 8751~53 self OUT 표시 교정
- **B4** — `outCodeOf` self 판정을 `group`(OUT_GROUPS) → **`resultCol` per-code**로 교체, `OUT_GROUPS` 폐기.
  → **A4**(인적공제 self 8001·8002·8101~04·8003 통합) nts OUT 표시 자동 교정.
- **A5** — `send:false`(8003 통합 = altSent) 행의 nts IN·yts IN을 "—"로 교정. 8003은 자기전송 안 하고(실제 전송은 8004~09 유형별) OUT만 받는데, `statusRowsOf`가 `send`를 안 봐서 IN을 전송하는 것처럼 표시하던 것 제거.
- **A6** — N:1 배지를 **멤버(`·N:1`) / 집계(`N:1·`)** 두 종류로 분리(점 위치 = 코드가 N쪽이냐 1쪽이냐). N:1은 정반대 서명: 멤버=IN만·집계=OUT만. `relationTypeOf`가 이미 `SUBTOTAL_OF`(멤버)/`AGGREGATE_CODES`(집계)로 갈래 판정하던 것을 라벨로 노출.
- **결과: 맵현황의 IN/OUT 거짓 표시 전부 제거.** self 판정이 group 휴리스틱이 아닌 per-code 신호로 감.

> **▶ 다음 즉시 과제(A6 후속): 유형 → IN/OUT 존재여부 검증.** 멤버(`·N:1`)면 nts/yts IN 있고 OUT 없어야 · 집계(`N:1·`)면 OUT 있고 IN 없어야 · self(1:1)면 IN·OUT 둘 다 · 입력전용(1:0)이면 IN만. 어기면 `checkMappingConsistency`에 경고 → **"유형이 속성 존재여부를 결정·검증"의 첫 실물**(§5 facet 계약의 축소판). A5의 8003이 딱 이 위반이었음.

현재 self OUT 판정(`outCodeOf`): 명시 outCode → CARD_/MEDI_ prefix(소계) → OTHER_/GIFT_ prefix(self) → **resultCol 보유 & 비소계(self)** → 없음("—").

---

## 4. 맵현황 잔여 과제

### A3 — 투자조합 개별 8415~8423 = 복합유형 (유형 배지 `1:1` 오표시)
- **사실**: `ytsDdcMap`은 resultCol 행만 채운다(`runCompareForCalcNo.ts:367`). 개별은 resultCol이 없어 **self 대조 안 됨**, 소계 **8410(OTO_IU_ETC)에서만** 대조 = 사실상 **N:1**. 그런데 NTS는 per-code ddcAmt도 회신(하이브리드).
- **정체 = 복합**: `{ self(에코, 대조가능), memberOf 8410 }`. self 대조가 *가능*한 이유 = `investmentList.ytsDdc(ΣPEN_SAVE_SUB_AMT)` per-code가 **이미 계산돼 있음**(단 ytsDdcMap에 미배선).
- **현 렌더는 의도적**(2026-07-21): 개별을 8410 밑으로 접지 않고 per-code NTS ddcAmt를 보여주려고 "결과전용행"으로 렌더.
- **해결 경로**: facet-set 모델이 서면 자연 해결(`{self, memberOf}` 둘 다 기록 → per-code NTS 가시 + 소계 대조). **보너스**: `investmentList.ytsDdc`를 `ytsDdcMap`에 배선하면 per-code 대조까지 얻어 검증 커버리지↑.
- **주의**: ISA 8707/8708도 같은 `{self, memberOf 8705}` 복합이나, YTS가 `RT_ISA_PEN_AMT` 단일컬럼이라 **self 대조 불가**(에코돼도). → "self 에코됨 ≠ self 대조가능"을 계약이 구분해야 함.

### A2 — 8754 그룹 위치 (cosmetic, skip 결정됨)
- 8754(국외총급여) group이 `"세액공제"`인데 형제 8751(외국납부)은 `"기타세액공제"` → 맵현황서 갈라져 보임.
- **단순 이동 불가**: `group`이 ETC_CREDIT selector로도 쓰임(`HometaxCalcPanel.tsx:108` `m.group === "기타세액공제"`, 정확히 3개 전제). 8754를 넣으면 ETC_CREDIT에 오염.
- → 아래 "group 잔여 과적재" 해소 후 처리.

---

## 5. 큰 과제 — facet-set 계약

### 5.1 모델
`relation`은 scalar enum이 아니라 **facet-set(성질 집합)**. 한 코드가 여러 성질을 동시에 가짐.

원자 성질:
- **self** — NTS가 이 코드에 per-code 결과 회신(에코). *+ 대조가능 여부* 플래그(YTS per-code 원천 유무).
- **memberOf X** — 이 코드가 집계 X로 굴러가고 대조는 X에서.
- **split→[코드]** — NTS가 이 코드에서 새 코드 생성(8740→8741, 고향 8783/84→8780~86).
- **echo-flow** — ①결과비교에서 useAmt echo로 대조(총급여 8900).
- **입력전용** — OUT 없음(8754).

기존 5유형 = 원자 조합:
- 국민연금 8201 = `{self}`
- 카드 8431 = `{memberOf 8430}`
- **투자조합 8416 / ISA 8707·8708 = `{self, memberOf}`** (ISA는 self 대조불가 플래그)
- 정치 8740 / 고향 8783·84 = `{self, split}`
- 8754 = `{입력전용}`

### 5.2 산출물 — 유형 → 비교 + 속성 표

| 유형(facet) | ① 비교 진행 | ② 있어야 할 속성 | 없어야 할 것 |
|---|---|---|---|
| self · 대조가능 | `ntsMap[c] ↔ ytsDdcMap[c]` per-code | resultCol(또는 giftDdc 원천)·valueKey·rule | outCode→소계 |
| self · 에코전용(ISA 8707) | per-code 대조 안 함(소계에서만) | NTS per-code 회신 표식 + "YTS per-code 원천 없음" | — |
| memberOf X(카드→8430) | 개별 대조 X → 소계 X서 `ntsMap[X]↔ytsDdcMap[X]` | outCode=X, X는 소계코드+ytsOut | 자기 self 대조 |
| split→[코드](정치 8740→8741) | self 대조 + 국세청 생성코드 0/무시 | split 대상코드 목록 | — |
| echo-flow(총급여 8900) | ①결과비교에서 useAmt echo 대조 | FLOW 등록 | resultCol 불필요 |
| 입력전용(8754) | 비교 없음 | 동반입력 표식 | resultCol 없음 |

### 5.3 구현 단계
1. facet 모델 확정(원자 + 대조가능 플래그) → `relationTypeOf`를 **set 반환**으로. 맵현황 배지 다중 표기.
2. 유형 → 비교 절차를 유형에서 도출(코드 생성 가능하게).
3. 유형 → 필수/금지 속성 계약을 **`checkMappingConsistency`(정합성 검사)에 위반 경고**로 연결.

---

## 6. group 잔여 과적재 (B4 나머지)
`group` 필드가 3중 임무였음: ①맵현황 표시 그룹핑 ②outCodeOf self 판정 ③ETC_CREDIT selector.
- ② outCodeOf self 판정 → **B4에서 resultCol로 분리 완료.**
- ③ ETC_CREDIT selector(`HometaxCalcPanel.tsx:108`) → 여전히 `group="기타세액공제"` 사용. **명시 코드 나열로 분리하면 A2도 같이 풀림.**
- ① 표시 그룹핑 → 정당한 용도, 유지.

## 7. 계약 문법에 담을 관찰 (B1~B3)
- **B1** — "OUT 대조원천"이 불균일: resultCol(대다수) / giftDdc(기부금 이월) / echo useAmt(8900) / 소계 ytsOut(카드·의료·ISA). 성질별로 유형화 필요.
- **B2** — N:1 멤버십 2방식: `outCode→소계`(대조가 소계로 이동) vs `displaySubtotal`(대조는 실아그리게이트 행에 유지, 부양가족 8003). 대조 위치가 다름.
- **B3** — 8900 echo 표식이 행에 없음(FLOW_CODES 외부 + 주석에 의존). 계약엔 명시 표식 필요.

## 8. 이미 보류 (C)
- **C1** — 조특30조제외 8602~8617 8개가 `RT_R_LAW` 공유 → self 오탐. `project_hometax_taxcut_shared_column`. **세액감면 YTS IN 정리 시 재개**(상규님 지정).
- **C2** — status `"추정"`(8900·조특30제외·8601·8606) 증거 미확정 → 계약 증거층에서 별도 표시.

---

## 9. 핵심 파일
- `src/features/hometax-calc/lib/ddcVerdict.ts` — `outCodeOf`·`SUBTOTAL_CODES`·`FLOW_CODES`·`relationTypeOf`·`makeYearVerdict`
- `src/features/hometax-calc/mapping/2025.ts`(·`2026.ts`) — `MAPPING` 단일 원천
- `src/features/hometax-calc/lib/runCompareForCalcNo.ts:367` — `ytsDdcMap` 채움(resultCol 기준). A3 배선 지점.
- `src/features/hometax-calc/components/HometaxCalcPanel.tsx` — 맵현황(`MappingStatusView`·`statusRowsOf`·유형 배지), ETC_CREDIT selector(:108)
- `src/features/hometax-calc/lib/investmentList.ts` — 투자조합 per-code `ytsDdc`(A3 배선 소스)
- `src/features/hometax-calc/lib/__tests__/ddcVerdict.test.ts` — relationTypeOf 회귀

## 10. 권장 착수 순서
1. **facet-set 모델 확정** (원자 + 대조가능 플래그) → `relationTypeOf` set 반환 (A3 자연 해결)
2. **유형→비교+속성 표 코드화** → 정합성 검사 위반 경고
3. **A3 배선** (`investmentList.ytsDdc → ytsDdcMap`) + facet 렌더 → per-code + 소계 대조 둘 다
4. **B4 잔여**(ETC_CREDIT selector 명시화) → A2 해결
5. **B1~B3** 계약 문법 반영
