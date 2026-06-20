# 국세청 서식항목 수정 기능 구현 계획

## 개요

전산매체 비교·검증 화면에서 HWP(국세청) 서식항목명을 수정하고,
수정된 항목에 `[M]` 표시를 유지하는 기능.

---

## 현재 상태

- 비교 화면 좌측(HWP) 서식항목은 `<input>`으로 이미 편집 가능
- 수정 시 `dirtyTax` Map에 임시 보관 → 저장 시 `MLAY_TAX.ITEM` 직접 덮어씀
- **문제**: 저장 후 재로딩하면 수정 여부 식별 불가 (원본 소멸)

---

## 설계: MLAY_TAX_EDIT 테이블 신설

`MLAY_JAVA / MLAY_JAVA_EDIT` 패턴과 동일한 구조.

```sql
CREATE TABLE MLAY_TAX_EDIT (
  YEAR     NUMBER(4)    NOT NULL,
  USER_ID  NUMBER       NOT NULL,
  CODE     VARCHAR2(20) NOT NULL,   -- 항목코드 (E7, A1 등)
  ITEM     VARCHAR2(500),           -- 수정된 서식항목명
  PRIMARY KEY (YEAR, USER_ID, CODE)
);
```

| 테이블 | 역할 |
|--------|------|
| `MLAY_TAX` | 원본 HWP 파싱값 보존 (ITEM 불변) |
| `MLAY_TAX_EDIT` | 사용자 수정값 저장 |

유효 항목명 = `MLAY_TAX_EDIT.ITEM` (존재 시) 또는 `MLAY_TAX.ITEM` (원본)

---

## 구현 범위

### 1. DB (Oracle DDL)
- `MLAY_TAX_EDIT` 테이블 생성

### 2. `src/lib/tax-oracle.ts`

| 함수 | 내용 |
|------|------|
| `getTaxItemEdits(year, userId, record?)` | MLAY_TAX_EDIT 조회 → `Map<code, item>` 반환 |
| `upsertTaxItemEdits(year, userId, updates)` | MERGE INTO MLAY_TAX_EDIT |
| `deleteTaxItemEdits(year, userId, codes)` | 특정 코드 수정 취소 |
| `resetTaxItemEdits(year, userId, record)` | 레코드 전체 초기화 |

기존 `updateTaxItemsByCode` → **MLAY_TAX_EDIT upsert로 교체**  
(MLAY_TAX.ITEM은 더 이상 수정하지 않음)

### 3. `compare/route.ts` — GET

```typescript
// 기존
const [taxRows, javaRows, edits, sectConfig] = await Promise.all([...])

// 변경
const [taxRows, javaRows, edits, taxEdits, sectConfig] = await Promise.all([
  getTaxRows(...),
  getJavaRows(...),
  getJavaEdits(...),
  getTaxItemEdits(...),   // 추가
  getTaxSectConfig(...),
])

// CompareRow 빌드 전 taxRows에 수정값 반영
const effectiveTaxRows = taxRows.map(r => {
  const edited = taxEdits.get(r.코드)
  return edited ? { ...r, 항목: edited, itemModified: true } : r
})
```

### 4. `compare/route.ts` — PATCH

```typescript
// 기존: updateTaxItemsByCode (MLAY_TAX 직접 수정)
// 변경: upsertTaxItemEdits (MLAY_TAX_EDIT에 저장)
```

### 5. `types.ts` — TaxLayoutRow

```typescript
export interface TaxLayoutRow {
  ...
  itemModified?: boolean   // MLAY_TAX_EDIT에 수정값 존재 여부
}
```

### 6. `MediaStep.tsx` — UI

**[M] 뱃지 표시**
```tsx
<td className="...">
  {tax ? (
    <div className="flex items-center gap-1">
      {tax.itemModified && (
        <span className="text-[9px] font-bold text-blue-600 bg-blue-50 
                         border border-blue-300 rounded px-1 shrink-0">
          M
        </span>
      )}
      <input value={tax.항목 ?? ""} onChange={...} ... />
    </div>
  ) : ""}
</td>
```

**수정 취소 (개별)** — [M] 뱃지 클릭 시 해당 항목 원본 복원  
**초기화 버튼** — 기존 편집초기화 버튼에 MLAY_TAX_EDIT 삭제 포함

---

## 데이터 흐름

```
[HWP 업로드]
  └─ MLAY_TAX.ITEM = 원본값  (이후 불변)

[비교 화면 편집]
  └─ 서식항목 입력 → dirtyTax (임시)

[저장]
  └─ MLAY_TAX_EDIT.ITEM = 수정값 (UPSERT)

[재로딩]
  └─ getTaxRows + getTaxItemEdits
  └─ 수정값 있으면 항목명 교체 + itemModified = true
  └─ 화면: [M] 뱃지 표시

[수정 취소]
  └─ MLAY_TAX_EDIT에서 해당 CODE 삭제
  └─ MLAY_TAX.ITEM 원본 복원
```

---

## 작업 순서

1. Oracle DDL 실행 — `MLAY_TAX_EDIT` 테이블 생성
2. `tax-oracle.ts` — `getTaxItemEdits`, `upsertTaxItemEdits`, `deleteTaxItemEdits`, `resetTaxItemEdits` 구현
3. `types.ts` — `TaxLayoutRow.itemModified` 추가
4. `compare/route.ts` GET — taxEdits 조회 및 반영
5. `compare/route.ts` PATCH — `upsertTaxItemEdits`로 교체
6. `MediaStep.tsx` — [M] 뱃지, 개별 취소, 초기화 반영
7. 테스트

---

*작성일: 2026-06-18*
