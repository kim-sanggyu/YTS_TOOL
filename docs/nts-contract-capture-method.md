# NTS 계약 분석 방법 (국세청 모의계산 request/response 실측)

> 국세청 모의계산에서 **무슨 값을 어느 필드/코드에 넣고(IN) 어느 코드로 회신받나(OUT)** 를 확정하는
> **표준·재사용 방법.** 매 세션 새 방법을 만들지 말고 이 문서 하나를 따른다.
> 도구: `docs/hometax-capture-io.mjs`

## 왜 이 방법인가

국세청 계약(IN 필드·코드 / OUT 코드 / payload 구조)은 **추측하면 틀린다**(과거 8916 오매핑·8327/8328 라벨중복·조특법30조 4분할 근거약함이 전부 추측 탓). 실제 UI가 만든 payload를 그대로 캡처하면 **추측 0**으로 확정된다. 합성 프로브(우리가 body를 조립해 발사)보다 국세청 쪽 확인은 이게 더 확실하다.

## 두 반쪽 — 이 방법이 푸는 것과 아닌 것

| | 질문 | 방법 |
|---|---|---|
| **(A) NTS 계약** | 무슨 값 → 어느 필드/코드(IN), 어느 코드로 회신(OUT), 구조 | **이 캡처 방법 (여기서 확정)** |
| **(B) YTS 원천** | 그 IN에 넣을 YTS39 컬럼 / OUT과 대조할 정답 컬럼 / 전원 원단위 일치 | **상규님이 직접 알려줌** + 프로브/배치로 값검증 |

→ 이 문서는 (A) 전용. (A)를 캡처로 굳힌 뒤, (B)는 상규님 지정 원천으로 매핑하고 실납세자 배치로 값일치를 확인한다.

## 절차

### 1. 캡처 켜기
```
node docs/hometax-capture-io.mjs
```
- headed 브라우저가 '연말정산 자동계산' 화면까지 자동 진입.
- **세션 노이즈(permission/token/포털)는 자동 제외**, 진입 완료(ready) 후의 계산만 `#1, #2, …` 로 번호매김.
  → "적용하기 = #N" 이 그대로 맞는다.

### 2. 증분(diff) 방식으로 입력 — 권장
**항목을 하나씩** 넣고 `[적용하기]→[계산]`, 또 하나 넣고 계산. 연속된 두 계산의 **차이**가 그 항목의 IN/OUT을 핀포인트한다. (한꺼번에 다 넣으면 소진·상호작용에 가려질 수 있음 — 아래 함정 참고)

### 3. 분석
```
node docs/hometax-capture-io.mjs --parse
```
- 계산별 `code │ IN(값 있는 입력필드) │ OUT ddcAmt` 표
- **`Δ 직전 계산 대비`** = 방금 넣은 항목이 **어느 코드로 IN 되고 어느 코드 OUT 을 움직였는지** 자동 표시
- 원본 페어는 `data/capture/io.jsonl` (Claude가 직접 읽어 분석 가능)

### 4. 매핑 반영
확정된 IN 필드(`valueKey`)·OUT 코드(`outCode`)를 `mapping/2025.ts` 에 반영, `status: 추정→확정`, note에 **실측근거(캡처 일자·계산 #번호)** 를 남긴다.

## 읽는 법 (payload 구조)

- 계산 요청 actionId = `ATEYSEAA001L03`. body = `yrsTaxClcDetailDVOList: [{amtClusCd, useAmt, incDdcNfpCnt, ddcTrgtAmt, ddcLmtAmt, ddcAmt}, …]`.
- **IN 필드 의미**: `incDdcNfpCnt`=인원 / `useAmt`=금액(납입·지출·대상) / `ddcTrgtAmt`=공제대상(교육비류) / `ddcAmt`=공제액 직접(혼인 8790 등 특수).
- **OUT** = 응답 같은 리스트의 각 코드 `ddcAmt`. self형은 보낸 코드에 그대로, 소계형은 별도 소계코드에.
- UI는 한 항목에 `incDdcNfpCnt + useAmt + ddcTrgtAmt + ddcLmtAmt + ddcAmt` 를 다 채우기도 하지만, 보통 **실입력(인원/금액/대상)만으로도 산출**된다. `ddcLmtAmt` 단독은 UI 기본 한도 에코(무시).

## 함정 (실측 교훈)

- **소진 가림**: 공제를 과다입력(예 부양가족 형제자매 40명)하면 근로소득금액을 다 써버려 그 뒤 항목 OUT이 0으로 뜬다 — 계약이 없는 게 아니라 소진. **정상값**으로 과세표준(8903)을 살려서 관찰.
- **배타 항목**: 부녀자(8103)↔한부모(8104)는 동시 불가(부녀자 우선, 한부모 OUT=0). 격리하려면 조건을 분리(배우자없음+직계비속0+부녀자 등).
- **소계형**: 개별코드는 useAmt만, 결과는 별도 소계코드(카드 8430·의료 8726·연금 8706·출산 8761)로 회신 — 개별 OUT ddcAmt가 0이어도 정상.

## 관련
- 도구: `docs/hometax-capture-io.mjs`
- 값검증(B) 프로브: `docs/hometax-*-probe.mjs` (실납세자 원단위 대조)
- 매핑 단일원천: `src/features/hometax-calc/mapping/2025.ts`
- 전체 설계: `docs/hometax-full-compare-design.md`
