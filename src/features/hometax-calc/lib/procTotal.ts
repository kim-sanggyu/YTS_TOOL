import { ytsDb } from "@/lib/db/oracle"

// 계산과정(CALC_PROC_TOTAL, CLOB ~9KB/명) 단건 조회.
// 목록 쿼리에선 이 CLOB을 빼고(392명분 ~3.4MB 전송 회피) 존재여부(hasProc)만 실어보낸 뒤,
// 계산과정 팝업/드로어를 실제로 열 때 그 한 명치만 여기서 lazy 로드한다.
export async function getProcTotal(calcNo: string): Promise<string | null> {
  const rows = await ytsDb.query<{ CALC_PROC_TOTAL: string | null }>(
    `SELECT CALC_PROC_TOTAL FROM YTS39.PAY_WRK_CALC WHERE CALC_NO = :1`,
    [calcNo],
  )
  return rows[0]?.CALC_PROC_TOTAL ?? null
}
