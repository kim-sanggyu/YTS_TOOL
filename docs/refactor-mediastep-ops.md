# MediaStep 자료구조 리팩터링 계획

> 작성일: 2026-06-23  
> 대상 파일: `src/features/media-layout/components/MediaStep.tsx`  
> 커밋 베이스: `e5be04c` (feat: 비교편집 UI 개선)

---

## 1. 왜 바꾸는가

### 현재 구조의 근본 문제

```
현재:  display = state   (표시 배열 자체가 상태)
목표:  display = f(base, ops)  (불변 기저 + 연산 목록 → 파생 뷰)
```

`taxItems: (TaxLayoutRow|null)[]` + `javaSlots: JavaSlot[]` 두 개의 분리 배열을 상태로 씁니다.
D 클릭이 `taxItems`에 null을 삽입하면서 원래 페어링 정보가 사라집니다.
취소할 때 "원래 무엇이었는지"를 역산해야 하므로 취소 순서에 따라 오류가 납니다.

| 시나리오 | 현재 동작 |
|---|---|
| fromDB D 역순 취소 | phantom row 발생 (길이 불일치) |
| fromDB D 순방향 취소 | Tax 행 정렬 깨짐 |
| I 취소 후 I 재클릭 | overflow dummy 잔존 |
| I 취소 시 인접 D 해제 | 독립 D 오취소 |

---

## 2. 목표 아키텍처

### 핵심 원칙

- **`baseTax`, `baseJava`**: 로드 후 절대 변경하지 않는 불변 기저
- **`ops`**: D/I 연산 목록 (추가/제거만, 수정 없음)
- **`displayRows`**: `useMemo`로 파생 — 절대 직접 세트하지 않음
- **M 편집**, **Tax 편집**: 별도 Map으로 관리 (기존과 동일 구조)

### 상태 목록 (변경 후)

```typescript
// ── 불변 기저 (레코드별 캐시에서 복원) ─────────────────────
const [baseTax,  setBaseTax]  = useState<TaxLayoutRow[]>([])
const [baseJava, setBaseJava] = useState<JavaField[]>([])

// ── 편집 연산 목록 ───────────────────────────────────────────
type EditOp =
  | { id: string; type: 'D'; javaSeq: number; fromDB: boolean }
  | { id: string; type: 'I'; afterJavaSeq: number | null; editedRaw: string; fromDB: boolean }

const [ops,      setOps]      = useState<EditOp[]>([])

// ── M 편집 (기존과 동일) ─────────────────────────────────────
// javaSeq → editedRaw  (loadedRaw는 로드 시점에 별도 보관)
const [mEdits,   setMEdits]   = useState<Map<number, string>>(new Map())
const [mLoaded,  setMLoaded]  = useState<Map<number, string>>(new Map())

// ── Tax 편집 (기존 dirtyTax와 동일) ─────────────────────────
const [dirtyTax, setDirtyTax] = useState<Map<string, { orgItem: string; item: string }>>(new Map())

// ── 섹션 설정, 연도, 파일 메타 등 (기존과 동일) ─────────────
const [sectConfig, setSectConfig] = useState<TaxSectConfigRow | null>(null)
// year, hwpFile, javaFile, activeRec, comparing, saving ... 동일
```

**제거되는 상태**: `taxItems`, `javaSlots`, `hasCancelledFromDB`

---

## 3. 새 타입: `DisplayRow`

```typescript
// MediaStep.tsx 상단에 추가
interface DisplayRow {
  // 식별자
  key:       string              // 렌더링용 고유키 (opId | `t${taxSeq}-j${javaSeq}`)
  opId:      string | null       // D/I op의 id (취소 시 사용)

  // 표시 데이터
  tax:       TaxLayoutRow | null // null = D행 또는 Tax 없음(overflow)
  java:      JavaField | null    // null = I행(새 삽입) 또는 Java 없음
  cmd:       'D' | 'I' | null
  editedRaw: string              // M편집 반영값 or I입력값 or java.raw
  loadedRaw: string              // 로드 시점 원본 (M 복원 감지용)
  fromDB:    boolean

  // 파생 플래그 (렌더에서 재계산 불필요하도록)
  isOverflow: boolean            // tax.seq === 0 (I삽입으로 밀린 행)
}
```

---

## 4. `computeDisplay` 함수

```typescript
function computeDisplay(
  baseTax:  TaxLayoutRow[],
  baseJava: JavaField[],
  ops:      EditOp[],
  mEdits:   Map<number, string>,
  mLoaded:  Map<number, string>,
  cfg:      TaxSectConfigRow | null,
): DisplayRow[] {

  // 1. D로 삭제된 javaSeq 집합
  const deletedSeqs = new Set(
    ops.filter(o => o.type === 'D').map(o => o.javaSeq)
  )

  // 2. 삽입 위치별 I ops 인덱싱
  //    afterJavaSeq=null → 맨 앞, 그 외 → 해당 Java 뒤
  const insertMap = new Map<number | null, EditOp[]>()
  for (const op of ops.filter(o => o.type === 'I')) {
    const key = op.afterJavaSeq
    if (!insertMap.has(key)) insertMap.set(key, [])
    insertMap.get(key)!.push(op)
  }

  // 3. Java 시퀀스 빌드 (D 마킹 + I 삽입 포함)
  type JEntry =
    | { kind: 'existing'; java: JavaField }
    | { kind: 'deleted';  java: JavaField; opId: string; fromDB: boolean }
    | { kind: 'inserted'; opId: string; editedRaw: string; fromDB: boolean }

  const jSeq: JEntry[] = []

  // null(맨 앞) 삽입
  for (const op of (insertMap.get(null) ?? [])) {
    jSeq.push({ kind: 'inserted', opId: op.id, editedRaw: op.editedRaw, fromDB: op.fromDB })
  }

  for (const j of baseJava) {
    if (deletedSeqs.has(j.seq)) {
      const dOp = ops.find(o => o.type === 'D' && o.javaSeq === j.seq)!
      jSeq.push({ kind: 'deleted', java: j, opId: dOp.id, fromDB: dOp.fromDB })
    } else {
      jSeq.push({ kind: 'existing', java: j })
    }
    for (const op of (insertMap.get(j.seq) ?? [])) {
      jSeq.push({ kind: 'inserted', opId: op.id, editedRaw: op.editedRaw, fromDB: op.fromDB })
    }
  }

  // 4. Tax와 페어링
  //    - D 행: Tax 없음(null), Java는 삭제된 행
  //    - I 행: Tax 소비, Java는 새 삽입 (null field)
  //    - 일반: Tax 소비, Java 매핑
  //    - Tax가 남으면 java=null 행으로 표시
  const rawTaxItems: (TaxLayoutRow | null)[] = []
  const rows: Omit<DisplayRow, 'tax'>[] = []

  let taxIdx = 0

  for (const entry of jSeq) {
    if (entry.kind === 'deleted') {
      rawTaxItems.push(null)
      rows.push({
        key:       entry.opId,
        opId:      entry.opId,
        java:      entry.java,
        cmd:       'D',
        editedRaw: entry.java.raw,
        loadedRaw: entry.java.raw,
        fromDB:    entry.fromDB,
        isOverflow: false,
      })
    } else if (entry.kind === 'inserted') {
      const tax = baseTax[taxIdx] ?? null
      rawTaxItems.push(tax)
      taxIdx++
      const raw = entry.editedRaw
      rows.push({
        key:       entry.opId,
        opId:      entry.opId,
        java:      null,
        cmd:       'I',
        editedRaw: raw,
        loadedRaw: raw,
        fromDB:    entry.fromDB,
        isOverflow: false,
      })
    } else {
      const tax = baseTax[taxIdx] ?? null
      rawTaxItems.push(tax)
      taxIdx++
      const raw     = mEdits.get(entry.java.seq) ?? entry.java.raw
      const loaded  = mLoaded.get(entry.java.seq) ?? entry.java.raw
      rows.push({
        key:       `t${tax?.seq ?? 'x'}-j${entry.java.seq}`,
        opId:      null,
        java:      entry.java,
        cmd:       null,
        editedRaw: raw,
        loadedRaw: loaded,
        fromDB:    false,
        isOverflow: false,
      })
    }
  }

  // Tax가 남아있으면 java=null 행
  while (taxIdx < baseTax.length) {
    const tax = baseTax[taxIdx]!
    rawTaxItems.push(tax)
    taxIdx++
    rows.push({
      key:       `t${tax.seq}-jnull`,
      opId:      null,
      java:      null,
      cmd:       null,
      editedRaw: '',
      loadedRaw: '',
      fromDB:    false,
      isOverflow: false,
    })
  }

  // 5. sectConfig 적용 (null 위치 보존하며 sect 부여)
  const taxWithSect = applySectConfig(rawTaxItems, cfg)

  // 6. overflow 감지 (I삽입으로 Tax가 부족해 seq=0 dummy가 된 행)
  //    새 아키텍처에서는 overflow 자체가 발생하지 않음 —
  //    I가 Tax를 소비하므로 baseTax보다 I가 많으면 tax=null이 됨

  return taxWithSect.map((tax, i) => ({
    ...rows[i],
    tax,
    isOverflow: tax?.seq === 0,
  }))
}
```

---

## 5. 핸들러 변환표

### D 핸들러

```typescript
// 현재
function handleD(idx: number) { /* taxItems/javaSlots 배열 조작 */ }

// 변경 후
function handleD(javaSeq: number) {
  setOps(prev => [...prev, {
    id: crypto.randomUUID(), type: 'D', javaSeq, fromDB: false
  }])
}

function handleCancelD(opId: string) {
  setOps(prev => prev.filter(o => o.id !== opId))
}
```

### I 핸들러

```typescript
// 현재: idx 기반
function handleI(idx: number) { /* ... */ }

// 변경 후: afterJavaSeq 기반
//   - 클릭한 행의 java.seq(기존 Java 행 뒤에 삽입) 또는 null(맨 앞)
function handleI(afterJavaSeq: number | null) {
  setOps(prev => [...prev, {
    id: crypto.randomUUID(), type: 'I', afterJavaSeq, editedRaw: '', fromDB: false
  }])
}

function handleCancelI(opId: string) {
  setOps(prev => prev.filter(o => o.id !== opId))
}

function handleEditI(opId: string, raw: string) {
  setOps(prev => prev.map(o => o.id === opId && o.type === 'I' ? { ...o, editedRaw: raw } : o))
}
```

### M 핸들러

```typescript
// 변경 거의 없음 — javaSeq 기반 Map 조작
function handleEditM(javaSeq: number, raw: string) {
  setMEdits(prev => new Map(prev).set(javaSeq, raw))
}
function handleResetM(javaSeq: number) {
  setMEdits(prev => { const m = new Map(prev); m.delete(javaSeq); return m })
}
```

---

## 6. `processCompareRows` → `loadOpsFromRows`

API 응답(`CompareRow[]`)을 ops로 변환하는 함수:

```typescript
function loadOpsFromRows(
  rows: CompareRow[],
  cfg:  TaxSectConfigRow | null,
): {
  baseTax:  TaxLayoutRow[]
  baseJava: JavaField[]
  ops:      EditOp[]
  mEdits:   Map<number, string>
  mLoaded:  Map<number, string>
  sectConfig: TaxSectConfigRow | null
} {
  const baseTax:  TaxLayoutRow[] = []
  const baseJava: JavaField[]    = []
  const ops:      EditOp[]       = []
  const mEdits  = new Map<number, string>()
  const mLoaded = new Map<number, string>()

  // MAP 순서대로 순회
  for (const row of rows) {
    if (row.tax && row.tax.seq !== 0) baseTax.push(row.tax)

    if (row.cmd === 'D' && row.java) {
      // D 행: baseJava에 추가 + D op
      baseJava.push(row.java)
      ops.push({ id: crypto.randomUUID(), type: 'D', javaSeq: row.java.seq, fromDB: true })
    } else if (row.cmd === 'I') {
      // I 행: afterJavaSeq는 직전 baseJava의 마지막 seq
      const afterJavaSeq = baseJava.at(-1)?.seq ?? null
      ops.push({ id: crypto.randomUUID(), type: 'I', afterJavaSeq, editedRaw: row.editedRaw ?? '', fromDB: true })
    } else if (row.java) {
      // 일반 행 또는 overflow(무시)
      if (row.java.lineNo !== 0) {
        baseJava.push(row.java)
      }
      // M 편집 감지: editedRaw ≠ java.raw
      if (row.editedRaw && row.java && canonicalize(row.editedRaw) !== canonicalize(row.java.raw)) {
        mEdits.set(row.java.seq, row.editedRaw)
        mLoaded.set(row.java.seq, row.editedRaw)
      }
    }
  }

  // baseTax에 sectConfig 적용
  // (computeDisplay 내부에서 처리하므로 여기서는 raw 순서만)

  return { baseTax, baseJava, ops, mEdits, mLoaded, sectConfig: cfg }
}
```

---

## 7. `handleSave` 변환

```typescript
async function handleSave() {
  const badI = ops.filter(o => o.type === 'I' && (!o.editedRaw.trim() || !parseMakeStr(o.editedRaw)))
  if (badI.length > 0) { toast.error(...); return }

  // M 업데이트 (변경된 것만)
  const javaCodeUpdates = [...mEdits.entries()]
    .filter(([seq, raw]) => canonicalize(raw) !== canonicalize(mLoaded.get(seq) ?? ''))
    .map(([seq, raw]) => ({ seq, javaCode: canonicalize(raw) }))

  // M 리셋 (loadedRaw가 있었는데 mEdits에서 삭제된 것)
  const javaCodeResets = [...mLoaded.keys()]
    .filter(seq => !mEdits.has(seq))
    .map(seq => ({ seq }))

  // Tax 편집
  const taxItemUpdates = [...dirtyTax.entries()]
    .map(([, { orgItem, item }]) => ({ recordType: activeRec, orgItem, item }))

  // MAP rows: displayRows에서 직접 빌드
  const hasChanges = ops.length > 0 || javaCodeUpdates.length > 0 || javaCodeResets.length > 0
  const mapRows = hasChanges
    ? displayRows.map((r, i) => ({
        sortOrder:  i + 1,
        recordType: activeRec,
        taxSeq:     r.isOverflow ? null : (r.tax?.seq ?? null),
        javaSeq:    r.cmd === 'I' ? null : (r.java?.seq ?? null),
        editedRaw:  r.cmd === 'I' ? (r.editedRaw || null) : null,
        rowType:    r.cmd === 'D' ? 'D' : r.isOverflow ? 'O' : null,
      })).filter(r => r.taxSeq !== null || r.javaSeq !== null)
    : undefined

  // ... fetch PATCH 동일
}
```

---

## 8. `handleCopyBody1ToAll` 변환

현재는 `taxItems`/`javaSlots` 배열을 직접 조작.
변환 후에는 `displayRows`에서 body_1 구간을 읽고 ops를 재구성:

1. `displayRows`에서 body_1 구간 추출
2. body_2..N 구간에서 Tax/Java seq 매핑 계산
3. 기존 D/I ops 중 해당 body 구간 seq를 매핑된 seq로 교체
4. `setOps`, `setMEdits` 업데이트

---

## 9. 렌더링 변경

### 기존 → 신규 매핑

| 기존 | 신규 |
|---|---|
| `taxItems[i]` | `displayRows[i].tax` |
| `javaSlots[i].field` | `displayRows[i].java` |
| `javaSlots[i].cmd` | `displayRows[i].cmd` |
| `javaSlots[i].editedRaw` | `displayRows[i].editedRaw` |
| `javaSlots[i].fromDB` | `displayRows[i].fromDB` |
| `isOverflow = tax?.seq===0` | `displayRows[i].isOverflow` |
| `idx`(배열 인덱스) 기반 핸들러 | `opId` 또는 `javaSeq` 기반 핸들러 |
| D 버튼: `handleD(i)` | D 버튼: `row.java ? handleD(row.java.seq) : null` |
| I 버튼: `handleI(i)` | I 버튼: `handleI(row.java?.seq ?? null)` |
| D 취소: `handleD(i)` (토글) | D 취소: `handleCancelD(row.opId!)` |
| I 취소: `handleI(i)` (토글) | I 취소: `handleCancelI(row.opId!)` |
| `handleEdit(i, raw)` | `row.cmd==='I' ? handleEditI(row.opId!, raw) : handleEditM(row.java!.seq, raw)` |

### `TaxSectInfo` 컴포넌트

현재 `items: (TaxLayoutRow|null)[]`, `slots: JavaSlot[]` 인자 수신.
변환 후: `rows: DisplayRow[]` 하나만 받도록 시그니처 변경.

### `cumData`

```typescript
const cumData = useMemo(() => {
  let tc = 0, jc = 0
  return displayRows.map(r => {
    tc += (!r.isOverflow && r.tax?.길이) ? r.tax.길이 : 0
    if (r.cmd !== 'D' && (r.java || r.cmd === 'I')) {
      jc += parseMakeStr(r.editedRaw)?.len ?? r.java?.len ?? 0
    }
    return { tc, jc }
  })
}, [displayRows])
```

---

## 10. `compareCache` 구조 변경

```typescript
// 현재
type CachedRecord = {
  taxItems:   (TaxLayoutRow | null)[]
  javaSlots:  JavaSlot[]
  sectConfig: TaxSectConfigRow | null
}

// 변경 후
type CachedRecord = {
  baseTax:    TaxLayoutRow[]
  baseJava:   JavaField[]
  ops:        EditOp[]
  mEdits:     Map<number, string>
  mLoaded:    Map<number, string>
  sectConfig: TaxSectConfigRow | null
}
```

`loadAllCompare` / `loadCompare`에서 `processCompareRows` 대신 `loadOpsFromRows` 호출.

캐시 → 표시 상태 동기화:
```typescript
useEffect(() => {
  const cached = compareCache[activeRec]
  if (!cached) { setBaseTax([]); setBaseJava([]); setOps([]); ... ; return }
  setBaseTax(cached.baseTax)
  setBaseJava(cached.baseJava)
  setOps(cached.ops)
  setMEdits(cached.mEdits)
  setMLoaded(cached.mLoaded)
  setSectConfig(cached.sectConfig)
  setDirtyTax(new Map())
}, [compareCache, activeRec])
```

---

## 11. 구현 순서 (단계별)

### Step 1 — 타입·유틸 추가 (렌더 변경 없음)
- `DisplayRow` 인터페이스 추가
- `EditOp` 타입 추가
- `computeDisplay` 함수 추가
- `loadOpsFromRows` 함수 추가

### Step 2 — 상태 추가 (기존 상태는 유지)
- `baseTax`, `baseJava`, `ops`, `mEdits`, `mLoaded` 상태 추가
- `displayRows = useMemo(...)` 추가
- 두 상태 체계가 병존 — 아직 렌더는 기존 사용

### Step 3 — 로드 경로 전환
- `processCompareRows` → `loadOpsFromRows`로 교체
- `CachedRecord` 타입 변경
- 캐시 → 표시 상태 동기화 useEffect 수정

### Step 4 — 핸들러 교체
- `handleD` / `handleI` → ops 기반으로 교체
- `hasCancelledFromDB` 제거
- `handleEdit` → `handleEditI` / `handleEditM` 분리

### Step 5 — `handleSave` 교체
- `mapRows` 빌드 로직을 `displayRows` 기반으로 변경
- `javaCodeUpdates` / `javaCodeResets`를 mEdits/mLoaded 비교로 변경

### Step 6 — 렌더링 전환
- `taxItems[i]` / `javaSlots[i]` → `displayRows[i].*` 로 전환
- D/I 버튼 핸들러 교체
- `TaxSectInfo` 시그니처 변경

### Step 7 — 기존 상태 제거
- `taxItems`, `javaSlots`, `hasCancelledFromDB` 제거
- `handleCopyBody1ToAll` ops 기반으로 변경

### Step 8 — 검증
- D 생성/취소 (순방향·역방향 모두)
- I 생성/취소
- fromDB D/I 취소
- M 편집·복원
- body_1 전체복사
- 저장 → 재로드 일치 확인

---

## 12. 변경 파일 목록

| 파일 | 변경 범위 |
|---|---|
| `src/features/media-layout/components/MediaStep.tsx` | 전면 개편 (유일 대상) |
| `src/lib/tax-oracle.ts` | 변경 없음 |
| `src/app/api/tools/media-layout/compare/route.ts` | 변경 없음 |

API 인터페이스(`CompareRow`, `MapSaveRow`)는 그대로 유지.
렌더링 마크업(JSX)은 속성명·핸들러만 교체, 구조는 유지.

---

## 13. 보존해야 할 현재 동작

- overflow 행 (`seq=0` dummy) — 새 아키텍처에서는 I가 Tax보다 많을 때 `tax=null`로 자연 표현
- sectConfig HBF 적용 (`applySectConfig`) — `computeDisplay` 내 동일 로직 유지
- `alignedRaws` (makeStr 정렬) — `displayRows.map(r => r.editedRaw)`로 동일 계산
- `sectBounds`, `gubunBounds` — `displayRows.map(r => r.tax)`로 동일 계산
- 스크롤 위치 복원, 드래그 리사이즈 모달 — 변경 없음
- 주목 노트 (`ItemNoteSticker`) — `row.tax.코드` 기반이므로 동일
