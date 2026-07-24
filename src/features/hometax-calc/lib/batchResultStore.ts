import fs from "node:fs"
import path from "node:path"
import type { CompareRunResult } from "@/features/hometax-calc/lib/runCompareForCalcNo"
import type { BatchRow } from "@/features/hometax-calc/lib/streamCompareBatch"

// 전체실행/개별실행 비교결과를 (우리자료연도 + NTS귀속연도) 단위로 calcNo 맵에 캐시한다.
// 다른 메뉴로 나갔다 돌아왔을 때 재실행 없이 마지막 결과를 복원하기 위한 용도.
// 배치는 완료 시 인원 전체를, 개별실행은 그 한 건을 upsert → 항상 "calcNo별 마지막 실행"이 남는다.
// RowResult는 탭 무관하게 calcNo 단위로 동일하므로 탭은 키에 넣지 않는다.
export interface StoredRow {
  calcNo: string
  ok: boolean
  result: CompareRunResult | null
  error: string | null
  ranAt: string        // ISO (클라이언트에서 표시형식으로 변환)
  duration: number     // ms
  inputHash?: string   // 보낸 값 지문 — 다음 실행 때 같으면 국세청 호출 스킵. 옛 캐시엔 없어 optional(없으면 재실행)
}

interface StoreFile {
  year: string
  ntsYear: string
  savedAt: string      // ISO — 마지막 upsert 시각
  rows: Record<string, StoredRow>
}

const DIR = path.join(process.cwd(), "data", "hometax-batch-results")
const fileFor = (year: string, ntsYear: string) => path.join(DIR, `${year}-nts${ntsYear}.json`)

function read(year: string, ntsYear: string): StoreFile | null {
  try {
    return JSON.parse(fs.readFileSync(fileFor(year, ntsYear), "utf8")) as StoreFile
  } catch {
    return null   // 파일 없음/파싱 실패 → 캐시 없음으로 취급
  }
}

export function loadBatchResults(year: string, ntsYear: string): StoreFile | null {
  return read(year, ntsYear)
}

export function upsertBatchResults(year: string, ntsYear: string, rows: StoredRow[]): void {
  if (rows.length === 0) return
  fs.mkdirSync(DIR, { recursive: true })
  const store = read(year, ntsYear) ?? { year, ntsYear, savedAt: "", rows: {} }
  for (const r of rows) store.rows[r.calcNo] = r
  store.savedAt = new Date().toISOString()
  fs.writeFileSync(fileFor(year, ntsYear), JSON.stringify(store))
}

export function deleteBatchResults(year: string, ntsYear: string): void {
  try {
    fs.rmSync(fileFor(year, ntsYear))
  } catch {
    /* 파일 없음 → 이미 지워진 것으로 취급 */
  }
}

// 배치행(BatchRow) → 저장행(StoredRow) 매핑. result가 있으면 성공으로 본다.
export function batchRowToStored<T extends { calcNo: string }>(r: BatchRow<T>): StoredRow {
  return {
    calcNo:    r.item.calcNo,
    ok:        r.result != null,
    result:    r.result,
    error:     r.error,
    ranAt:     r.ranAt,
    duration:  r.duration,
    inputHash: r.result?.inputHash,
  }
}
