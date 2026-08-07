import { ytsDb } from "@/lib/db/oracle"

/**
 * 의료비 L03 독립 재집계 — 검증도구가 원천(FMLY_DTL)에서 4항목을 직접 집계.
 *
 * ▶ 목적: NTS로 보내는 CALC_PROC_MEDI(YTS 엔진 산출)를 그대로 대조하면 순환(YTS집계 vs YTS결과)이라
 *   집계·실손차감 로직이 검증 사각. 검증도구가 원천에서 독립 집계해 CALC_PROC_MEDI와 로컬 대조(a)하면
 *   집계오류를 잡음. (NTS 전송은 기존 그대로, 자체집계는 보내지 않음.)
 *
 * ▶ 유형분류는 원천 컬럼이 이미 결정(나이/장애 재분류 없음):
 *   MEDI_AMT(일반)→그밖의8721 / MEDI_HDC_MC_AMT(6세↓·65세↑·장애·특례)→본인등8720 /
 *   MEDI_CA_AMT→미숙아8729 / MEDI_ISA_AMT→난임8725.
 *
 * ▶ 실손차감: 부양가족 행별 독립(사람 간 이월 없음). 공제율 낮은 순으로 실손 순차 소진
 *   = 일반 → 본인등 → 미숙아 → 난임. 본인(550-010)의 일반 잔여는 본인등으로 이동.
 *
 * ★ YTS Java(getFmlyDtlForMedi) 독립 구현 — 알고리즘만 재현(min-차감), 코드 공유 안 함.
 */

/** 부양가족별 원천 지출(실손차감 전) */
export interface MediFmlyRaw {
  fmlySeq:  number
  fmlyReln: string
  amt:  number   // MEDI_AMT        일반
  hdc:  number   // MEDI_HDC_MC_AMT 6세↓·65세↑·장애·특례 (본인등)
  ca:   number   // MEDI_CA_AMT     미숙아·선천성이상아
  isa:  number   // MEDI_ISA_AMT    난임시술
  loss: number   // MEDI_LOSS_INSU  실손보험 수령액
}

/** 부양가족별 실손차감 후 4항목 배분 */
export interface MediFmlyAgg extends MediFmlyRaw {
  boninAmt: number   // 8720
  otherAmt: number   // 8721
  misukAmt: number   // 8729
  nanimAmt: number   // 8725
}

/** 자체집계 결과 — 4항목 총합 + 부양가족별 상세 */
export interface MediSelfAgg {
  bonin: number   // 8720 본인·65세·장애인
  other: number   // 8721 그 밖의 공제대상자
  misuk: number   // 8729 미숙아·선천성이상아
  nanim: number   // 8725 난임시술비
  byFmly: MediFmlyAgg[]
}

const SELF_CODE = "550-010"   // 소득자 본인

/**
 * 순수 집계 — 원천 행 배열 → 실손차감 후 4항목.
 * 실손을 공제율 낮은 순(일반→본인등→미숙아→난임)으로 순차 소진(행별 독립).
 */
export function aggregateMedi(rows: MediFmlyRaw[]): MediSelfAgg {
  let bonin = 0, other = 0, misuk = 0, nanim = 0
  const byFmly = rows.map(r => {
    let rem = r.loss
    const deduct = (bucket: number) => {
      const d = Math.min(rem, bucket)
      rem -= d
      return bucket - d
    }
    let otherAmt = deduct(r.amt)   // 일반(가장 낮은 공제율)부터
    let boninAmt = deduct(r.hdc)
    const misukAmt = deduct(r.ca)
    const nanimAmt = deduct(r.isa)
    // 본인 의료비가 일반으로 집계된 경우, 잔여를 본인등으로 이동
    if (r.fmlyReln === SELF_CODE) { boninAmt += otherAmt; otherAmt = 0 }

    bonin += boninAmt; other += otherAmt; misuk += misukAmt; nanim += nanimAmt
    return { ...r, boninAmt, otherAmt, misukAmt, nanimAmt }
  })
  return { bonin, other, misuk, nanim, byFmly }
}

/** 대상자(calcNo) 원천 조회 → 자체집계. */
export async function getMediSelfAggregate(calcNo: string): Promise<MediSelfAgg> {
  const rows = await ytsDb.query<{
    FMLY_SEQ: number; FMLY_RELN: string
    MEDI_AMT: number; MEDI_HDC_MC_AMT: number; MEDI_CA_AMT: number
    MEDI_ISA_AMT: number; MEDI_LOSS_INSU: number
  }>(`
    SELECT A.FMLY_SEQ, A.FMLY_RELN,
           NVL(SUM(B.MEDI_AMT), 0)        AS MEDI_AMT,
           NVL(SUM(B.MEDI_HDC_MC_AMT), 0) AS MEDI_HDC_MC_AMT,
           NVL(SUM(B.MEDI_CA_AMT), 0)     AS MEDI_CA_AMT,
           NVL(SUM(B.MEDI_ISA_AMT), 0)    AS MEDI_ISA_AMT,
           NVL(SUM(B.MEDI_LOSS_INSU), 0)  AS MEDI_LOSS_INSU
    FROM YTS39.PAY_WRK_FMLY A
         JOIN YTS39.PAY_WRK_FMLY_DTL B ON B.CALC_NO = A.CALC_NO AND B.FMLY_SEQ = A.FMLY_SEQ
    WHERE A.CALC_NO = :1
      AND NVL(B.MEDI_AMT, 0) + NVL(B.MEDI_HDC_MC_AMT, 0) + NVL(B.MEDI_CA_AMT, 0)
        + NVL(B.MEDI_ISA_AMT, 0) + NVL(B.MEDI_LOSS_INSU, 0) > 0
    GROUP BY A.FMLY_SEQ, A.FMLY_RELN
    ORDER BY A.FMLY_SEQ
  `, [calcNo])

  return aggregateMedi(rows.map(r => ({
    fmlySeq:  Number(r.FMLY_SEQ),
    fmlyReln: r.FMLY_RELN,
    amt:  Number(r.MEDI_AMT),
    hdc:  Number(r.MEDI_HDC_MC_AMT),
    ca:   Number(r.MEDI_CA_AMT),
    isa:  Number(r.MEDI_ISA_AMT),
    loss: Number(r.MEDI_LOSS_INSU),
  })))
}

/**
 * 귀속연도(year) 의료비 목록 대상자를 1쿼리로 조회 → calcNo별 자체집계 Map.
 * 목록(getMediItems)이 N+1 쿼리 없이 한 번에 붙이기 위한 배치 경로.
 * ★대상을 목록과 동일 필터(CALC_PROC_MEDI 존재·RT_MEDI_AMT>0)로 좁힘 — year 전체
 *   FMLY_DTL 스캔(1.2s·1074행) 대신 목록 대상만(0.6s·540행). 목록에 없는 사람은 자체집계 불필요.
 */
export async function getMediSelfAggByYear(year: string, calcNo?: string): Promise<Map<string, MediSelfAgg>> {
  const rows = await ytsDb.query<{
    CALC_NO: string; FMLY_SEQ: number; FMLY_RELN: string
    MEDI_AMT: number; MEDI_HDC_MC_AMT: number; MEDI_CA_AMT: number
    MEDI_ISA_AMT: number; MEDI_LOSS_INSU: number
  }>(`
    SELECT A.CALC_NO, A.FMLY_SEQ, A.FMLY_RELN,
           NVL(SUM(B.MEDI_AMT), 0)        AS MEDI_AMT,
           NVL(SUM(B.MEDI_HDC_MC_AMT), 0) AS MEDI_HDC_MC_AMT,
           NVL(SUM(B.MEDI_CA_AMT), 0)     AS MEDI_CA_AMT,
           NVL(SUM(B.MEDI_ISA_AMT), 0)    AS MEDI_ISA_AMT,
           NVL(SUM(B.MEDI_LOSS_INSU), 0)  AS MEDI_LOSS_INSU
    FROM YTS39.PAY_WRK_FMLY A
         JOIN YTS39.PAY_WRK_FMLY_DTL B ON B.CALC_NO = A.CALC_NO AND B.FMLY_SEQ = A.FMLY_SEQ
         JOIN YTS39.PAY_WRK_CALC c ON c.CALC_NO = A.CALC_NO
         JOIN YTS39.PAY_WRK_MAIN M ON M.CALC_NO = A.CALC_NO
    WHERE M.YY = :1
      AND c.CALC_PROC_MEDI IS NOT NULL
      AND NVL(c.RT_MEDI_AMT, 0) > 0
      ${calcNo ? "AND A.CALC_NO = :2" : ""}
      AND NVL(B.MEDI_AMT, 0) + NVL(B.MEDI_HDC_MC_AMT, 0) + NVL(B.MEDI_CA_AMT, 0)
        + NVL(B.MEDI_ISA_AMT, 0) + NVL(B.MEDI_LOSS_INSU, 0) > 0
    GROUP BY A.CALC_NO, A.FMLY_SEQ, A.FMLY_RELN
    ORDER BY A.CALC_NO, A.FMLY_SEQ
  `, calcNo ? [year, calcNo] : [year])

  // calcNo별 원천 행 묶음 → aggregateMedi
  const byCalcNo = new Map<string, MediFmlyRaw[]>()
  for (const r of rows) {
    const list = byCalcNo.get(r.CALC_NO) ?? []
    list.push({
      fmlySeq:  Number(r.FMLY_SEQ),
      fmlyReln: r.FMLY_RELN,
      amt:  Number(r.MEDI_AMT),
      hdc:  Number(r.MEDI_HDC_MC_AMT),
      ca:   Number(r.MEDI_CA_AMT),
      isa:  Number(r.MEDI_ISA_AMT),
      loss: Number(r.MEDI_LOSS_INSU),
    })
    byCalcNo.set(r.CALC_NO, list)
  }

  const result = new Map<string, MediSelfAgg>()
  for (const [calcNo, list] of byCalcNo) result.set(calcNo, aggregateMedi(list))
  return result
}
