# 국세청 모의계산 — 새 귀속연도 갱신 런북

> **목적**: 매년 국세청이 새 귀속연도 모의계산을 열면, 지난해 환경을 복사·실측해 새 연도를 지원하는 **최소 절차**.
> **원칙**: 뼈대만 남긴다. 구체 실측값(actionId·코드 등)은 코드/매핑에 있으니 여기 안 박는다 — 1년 뒤엔 세부가 바뀌어 문서가 썩기 때문. 절차·방법·도구 위치만 안정적으로 유지.
> 최초 작성: 2026-07-29(2026 귀속연도 지원을 실연하며 도출).

## 핵심 원리 (실측으로 확인)

2025→2026 실측 결과: **계산 로직·코드체계(amtClusCd)·payload 구조는 대체로 그대로**, 바뀌는 건 **전송 래퍼**(엔드포인트·세션 진입·detail 행별필드)뿐. 그래서 아키텍처 = **C 방식**: 엔진 단일 + 연도별 데이터/프로파일만 분리(폴더 통째 복제 A는 최소 diff에 최대 중복이라 지금까진 배제).

## 절차 (6단계)

1. **캡처** — 새 연도 UI가 실제로 만드는 payload를 잡아 계약을 실측한다.
   - 도구: `docs/hometax-capture-io.mjs` (`--manual-year` 로 새 연도 드롭다운 element id 실측)
   - 방법: `docs/nts-contract-capture-method.md` (추측 금지, 라이브 캡처가 단일 진실)
2. **계약 diff 판정** — 지난해 대비 *무엇이 바뀌고 무엇이 그대로인가*.
   - 바뀔 후보: 엔드포인트(actionId·screenId·L03 URL), 연도 드롭다운 id, detail 행별 신규필드, body 최상위 신규필드, 신규/폐지 amtClusCd
   - 그대로 후보: 코드체계·payload 구조 → 그러면 C 방식 유지
3. **프로파일 배선** — `mapping/ntsProfile.ts` 에 `PROFILE_20NN`(actionId·screenId·dropdownId·l03Url·detailRowExtra) 신설, `mapping/registry.ts` CONFIGS 에 등록.
4. **매핑 복사** — `mapping/20NN.ts` = 직전연도 파일 **물리 복사**(연도 격리; 지난해 수정이 새 연도를 조용히 안 바꿈). 신규 입력코드는 원천 미확정이면 **주석 백로그 + send 보류**, 프로브 후 배선.
5. **필드 프로브** — 신규 래퍼필드가 계산에 실제 영향 있나 **with/without 라이브 대조**.
   - 도구: `docs/hometax-2026-fields-probe.mjs` (ground truth 캡처 고정 + 래퍼필드만 변형 + 신선한 세션 발사. 연도만 바꿔 재사용)
   - 무관하면 엔진 무수정. load-bearing 이면 프로파일/엔진에 반영.
6. **잠금** — `mapping/__tests__/registry.test.ts` 에 새 연도 등록·엔드포인트값·near-copy 트립와이어(코드셋·send 집합 ≡ 직전연도) 추가. `npm run typecheck` + `npx vitest run` green.

## 견적 체크리스트 (새 연도에서 조사할 것)

- [ ] 엔드포인트 3종 (actionId · screenId · L03 URL)
- [ ] 연도 드롭다운 element id
- [ ] detail 행별 신규/변경 필드
- [ ] body 최상위 신규 필드
- [ ] 신규 · 폐지 amtClusCd (= 신규/폐지 공제항목)
- [ ] **UI 연도구동화 필요여부** (아래)

## UI(화면)는?

현재 화면은 **연도 드롭다운**으로 전환(메뉴 분리 안 함 — 매년 메뉴 누적 오염 + 화면 복제 유발이라 배제). 단, 화면 항목 렌더가 아직 `MAPPING_2025` 하드코딩이라, **신규 공제항목을 화면에 자동 반영하려면 "화면 연도구동화"(`getYearConfig(ntsYear)` 구동)가 선행 필수.** 신규 항목이 없고 값만 갱신이면 드롭다운만으로 충분.

## 이번 사례 (2026) — 요약만

- 바뀐 것: actionId/screenId/드롭다운 id/L03 URL · detail 행별필드(ereClCd 등) · 최상위 ieNm·v_calChk. **구체 값은 `PROFILE_2026`(ntsProfile.ts)·`mapping/2026.ts` 참조.**
- 그대로: amtClusCd 코드체계 · payload 구조.
- 프로브 결과: **신규 래퍼필드는 국세청이 전부 무시(계산 무관) → 엔진 무수정.** (`docs/hometax-2026-fields-probe.mjs`, V0~V3 diff 0)
- 소요: 프로파일+매핑복사+엔진 1줄(detailRowExtra 병합)+테스트. UI 연도구동화는 신규항목 착수 시 선행.

## 관련

- 캡처 방법: `docs/nts-contract-capture-method.md`
- 필드 프로브: `docs/hometax-2026-fields-probe.mjs`
- 매핑 단일원천: `mapping/20NN.ts` · `registry.ts` · `ntsProfile.ts`
- 국소 갱신 철학(매년 10% 노력): 메모리 `project_hometax_calc`
