@AGENTS.md

# 사용자

- 사용자를 **상규님**으로 호칭한다.

# 작업 원칙

- 요청 범위 밖의 코드는 건드리지 않는다. 리팩터링·정리·개선은 명시적으로 요청받은 경우에만 한다.
- 맥락이 애매하거나 선택지가 있으면 바로 실행하지 말고 먼저 질문한다.
- 작업 전 변경할 파일과 내용을 간략히 말하고, 동의를 받은 후 진행한다.

# 코드·SQL 규칙

- SQL은 반드시 **Oracle 11g 호환 문법**으로 생성한다. 아래 12c+ 전용 문법은 금지:
  - `FETCH FIRST n ROWS ONLY` / `OFFSET … ROWS` (행 제한) → `ROWNUM` 또는 인라인뷰 사용
  - `GENERATED … AS IDENTITY` (IDENTITY 컬럼) → 시퀀스 + 트리거
  - `DEFAULT ON NULL`, invisible(숨김) 컬럼
  - `WITH function …` (쿼리 안 인라인 PL/SQL)
  - `LISTAGG(…) ON OVERFLOW …` (LISTAGG 자체는 11gR2부터 OK, `ON OVERFLOW` 절만 금지)
  - JSON SQL 함수 (`JSON_VALUE` / `JSON_TABLE` / `JSON_QUERY` / `IS JSON`)
  - 확장 VARCHAR2(4000 초과)
  - ※ DB/SQL 규칙이 늘어나면 이 섹션은 `docs/rules/db.md`로 분리하고 여기엔 포인터만 남긴다.
