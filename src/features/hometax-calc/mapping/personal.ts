// 인적공제 그룹 비교 카탈로그 — 기타 탭의 "인적공제" 항목이 한 표에 묶어 대조하는 행들.
//
// 본인(8001)은 전원 동일이라 제외. 배우자부터 시작해 인적공제 전체 + 가족세액공제까지.
// 각 행 = NTS 회신코드(OUT ddcAmt) ↔ YTS 결과컬럼(공제액) 직접 대조.
//   - 소득공제(배우자·부양가족·추가공제): NTS OUT = 소득공제액, YTS = BASC_SUB_/ADD_SUB_ 계열 _AMT
//   - 세액공제(혼인·자녀·출산): NTS OUT = 세액공제액, YTS = RT_ 계열
// 부양가족은 YTS 가 유형별 금액을 저장 안 해(총액만) → 국세청 8003 소계(=Σ8004~09) ↔ BASC_SUB_FAMILY_AMT 로 대조.
// (전송값 IN 은 이미 MAPPING_2025 에서 send:true — 여기선 결과 대조 정의만. NTS OUT 은 실행 결과 ntsMap 에서 읽음.)
// 코드·단가 실측확정: docs/nts-contract-capture-method.md, reference_nts_family_type_8004 (2026-07-18)

export type PersonalKind = "소득공제" | "세액공제"

export interface PersonalRow {
  code:   string        // NTS 회신 amtClusCd (OUT)
  label:  string
  ytsCol: string        // YTS39 PAY_WRK_CALC 결과컬럼 (공제액, 대조 기준)
  kind:   PersonalKind
}

export const PERSONAL_ROWS: PersonalRow[] = [
  { code: "8002", label: "배우자",        ytsCol: "BASC_SUB_MATE_AMT",     kind: "소득공제" },
  { code: "8003", label: "부양가족(기본)", ytsCol: "BASC_SUB_FAMILY_AMT",   kind: "소득공제" },
  { code: "8101", label: "경로우대",      ytsCol: "ADD_SUB_OAT_AMT",       kind: "소득공제" },
  { code: "8102", label: "장애인",        ytsCol: "ADD_SUB_HDC_PERS_AMT",  kind: "소득공제" },
  { code: "8103", label: "부녀자",        ytsCol: "ADD_SUB_LADY_AMT",      kind: "소득공제" },
  { code: "8104", label: "한부모",        ytsCol: "ADD_SUB_SNGL_PRNT_AMT", kind: "소득공제" },
  { code: "8790", label: "혼인세액공제",   ytsCol: "RT_MRRG",              kind: "세액공제" },
  { code: "8763", label: "자녀세액공제",   ytsCol: "RT_HWC_AMT",           kind: "세액공제" },
  { code: "8761", label: "출산입양",      ytsCol: "RT_PER_CHI_AMT",        kind: "세액공제" },
]
