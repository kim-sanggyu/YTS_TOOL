# HWP 파싱 누적값(HWP_CUM) 저장 설계

> 작성일: 2026-06-17

## 배경

HWP 파서는 파싱 과정에서 두 종류의 길이 값을 읽는다.

| 구분 | 예시 | 설명 |
|------|------|------|
| A: 개별 길이 | `X(10)`, `9(5)` | 각 항목의 바이트 길이 |
| B: 누적 길이 | `10`, `15`, `35` | HWP 문서상 해당 항목까지의 누적 바이트 |

현재 파서는 두 값을 모두 읽지만 **A값(len)만 MLAY_TAX.FIELD_LEN에 저장**하고,
B값(cum)은 파싱 유효성 검증에만 쓰고 버린다.

```ts
// hwp-parser.ts
const dlen        = dtypeLen(texts[dtypeIdx])     // A: 개별 길이
const proposedCum = parseInt(texts[dtypeIdx + 1]) // B: 문서상 누적값

// A누적 ≠ B이면 필드로 인식 안 함 (오파싱 방지 핵심 로직)
if (accumulated + dlen !== proposedCum) { i++; continue }

rows.push({ ..., len: dlen, cum: proposedCum, ... })
//                   ↑ 저장됨    ↑ 버려짐
```

---

## 필요성

B값을 저장하면 행별로 **계산 누적값 vs 문서 누적값**을 비교할 수 있다.

```
행  | CODE | FIELD_LEN | 계산누적(sum) | HWP_CUM(문서)
----|------|-----------|--------------|----------
  1 | A1   |        10 |           10 |        10  ← 일치
  2 | A2   |         5 |           15 |        15  ← 일치
  3 | A3   |        20 |           35 |        60  ← 불일치! → A2와 A3 사이에 누락된 필드 존재
```

계산누적과 HWP_CUM이 벌어지기 시작하는 지점 = **파싱이 누락된 위치**

---

## DB 변경

```sql
-- Oracle에서 직접 실행
ALTER TABLE MLAY_TAX ADD HWP_CUM NUMBER;
```

---

## 코드 변경 계획

### 1. TaxRow 인터페이스 (`tax-oracle.ts`)
```ts
export interface TaxRow {
  ...
  fieldLen?:  number
  hwpCum?:    number   // 추가: HWP 문서상 누적값
  sect:       string
}
```

### 2. saveHwpFile INSERT (`tax-oracle.ts`)
```ts
// 기존
INSERT INTO MLAY_TAX
  (YEAR, USER_ID, SEQ, RECORD_TYPE, GUBUN, CODE, ITEM, VAL, FIELD_TYPE, FIELD_LEN, SECT)
VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11)

// 변경
INSERT INTO MLAY_TAX
  (YEAR, USER_ID, SEQ, RECORD_TYPE, GUBUN, CODE, ITEM, VAL, FIELD_TYPE, FIELD_LEN, HWP_CUM, SECT)
VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11, :12)

// 바인딩에 f.cum 추가
fields.map((f, i) => [..., f.len ?? null, f.cum ?? null, "body_1"])
```

### 3. getAllTaxRows SELECT (`tax-oracle.ts`)
```ts
SELECT SEQ, RECORD_TYPE, CODE, ITEM, VAL, FIELD_TYPE, FIELD_LEN, HWP_CUM, SECT
FROM MLAY_TAX WHERE ...

// 매핑 추가
hwpCum: (r.HWP_CUM as number) || undefined,
```

### 4. UI - HwpStep 리스트 (`HwpStep.tsx`)
- 누적 컬럼에 계산누적(cumBytes)과 HWP_CUM을 함께 표시
- 두 값이 다르면 빨간색으로 강조

```tsx
// renderTable 내
const isMismatch = r.hwpCum !== undefined && r.hwpCum !== cumBytes
<td className={`text-right font-mono text-xs ${isMismatch ? "text-red-500 font-bold" : ""}`}>
  {cumBytes}
  {isMismatch && <span className="text-xs ml-1">≠{r.hwpCum}</span>}
</td>
```

---

## 기대 효과

- 업로드 후 누적값 불일치 행을 즉시 시각적으로 확인
- 파싱 누락이 시작된 정확한 위치 파악 가능
- 바이트 검증 배지가 빨간색일 때 원인 추적 용이
