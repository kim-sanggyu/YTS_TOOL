# HWP 파싱 보정 사전 (Parse Correction Dictionary) 설계

> 작성일: 2026-06-17

## 배경

HWP 파서(`hwp-parser.ts`)는 OLE 바이너리에서 텍스트를 추출하는 방식이라 완벽하지 않다.
대표적 문제: HWP 각주·참조 마커가 특수문자 탈락 후 필드명에 섞여 들어옴.

예시:
- 원문 HWP: `※-23H15-사립유치원수석교사･교사의 인건비`
- `cleanText` 후: `-23H15-사립유치원수석교사･교사의 인건비`  ← DB에 저장됨
- 원하는 값: `-23H15 사립유치원수석교사･교사의 인건비`

정규식 자동 보정은 예기치 못한 부작용 위험이 있으므로,
**사용자가 명시적으로 정의한 보정 사전**을 활용하는 방식으로 결정.

---

## 핵심 개념

파싱 결과에서 잘못 나온 값(ORIGINAL)과 올바른 값(CORRECTED)을 DB에 저장해두고,
업로드 시 파싱 후 후처리 단계에서 치환 적용.

---

## DB 테이블 설계

```sql
CREATE TABLE MLAY_PARSE_CORRECTION (
  SEQ         NUMBER        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  FIELD_TYPE  VARCHAR2(20)  NOT NULL,   -- 'ITEM' | 'CODE'
  ORIGINAL    VARCHAR2(500) NOT NULL,   -- 파싱된 원본값 (완전일치)
  CORRECTED   VARCHAR2(500) NOT NULL,   -- 보정할 값
  NOTE        VARCHAR2(200),            -- 메모 (선택)
  CREATED_AT  DATE DEFAULT SYSDATE
);
```

### FIELD_TYPE 값
| 값     | 대상 컬럼       | 설명           |
|--------|----------------|----------------|
| `ITEM` | MLAY_TAX.ITEM  | 서식항목(필드명) |
| `CODE` | MLAY_TAX.CODE  | 번호(항목코드)  |

---

## 매칭 방식

**완전일치(Exact Match)** 를 기본으로 한다.

- 부분일치(contains)는 의도치 않은 치환 위험이 있음
- 보정이 필요한 값은 대부분 특정 문자열이 통째로 잘못 나오는 경우임

```
파싱값 === ORIGINAL  →  CORRECTED 로 치환
파싱값 !== ORIGINAL  →  그대로 유지
```

---

## 구현 계획

### 1. tax-oracle.ts
```ts
// 보정 사전 전체 로드 (업로드 시 1회)
export async function getParseCorrections(): Promise<Map<string, Map<string, string>>>
// 반환: Map<fieldType, Map<original, corrected>>
```

### 2. upload/route.ts (POST)
```
HWP 파싱 완료 (fields: HwpField[])
  ↓
getParseCorrections() 로 사전 로드
  ↓
fields.map(f => {
  name: corrections.ITEM.get(f.name) ?? f.name,
  no:   corrections.CODE.get(f.no)   ?? f.no,
  ...
})
  ↓
saveHwpFile() 로 저장
```

### 3. API - CRUD
```
GET    /api/tools/media-layout/parse-correction        전체 조회
POST   /api/tools/media-layout/parse-correction        등록
DELETE /api/tools/media-layout/parse-correction/:seq   삭제
```

### 4. UI - HWP 업로드 화면 내 탭 또는 별도 섹션
- 보정 사전 목록 표시 (FIELD_TYPE / ORIGINAL / CORRECTED / NOTE)
- 행 추가 / 삭제
- 저장된 값은 다음 업로드부터 자동 적용

---

## 워크플로우

```
1. HWP 업로드 → 파싱 결과 확인
2. 잘못 나온 값 발견 (예: -23H15 사립유치원수석교사의 인건비)
3. 보정 사전에 등록:
     FIELD_TYPE = ITEM
     ORIGINAL   = -23H15 사립유치원수석교사의 인건비
     CORRECTED  = 사립유치원수석교사의 인건비
4. 다음 HWP 업로드 시 자동 치환
```

---

## 주의사항

- ORIGINAL은 파싱 직후 raw 값 기준 (cleanText 적용 후)
- 보정 사전은 업로드 시에만 적용 (이미 저장된 MLAY_TAX 데이터는 소급 적용 안 함)
- 소급 적용이 필요하면 재업로드로 처리
- 보정 규칙이 많아질수록 성능 영향 미미 (Map 조회 O(1))
