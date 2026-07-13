import { runCompareForCalcNo, type CompareRunResult } from "@/features/hometax-calc/lib/runCompareForCalcNo"

export interface BatchRow<T> { item: T; result: CompareRunResult | null; error: string | null; ranAt: string; duration: number }

// 인원별 호출 사이 랜덤 딜레이 — 기계적인 간격으로 국세청 L03을 연타하면 접속 차단(이상 트래픽 감지)될 수 있어
// 사람처럼 보이도록 요청 간격에 지터를 준다.
const DELAY_MIN_MS = 800
const DELAY_MAX_MS = 1200
// 연속 실패(파싱 오류 등)가 이 횟수 이상 반복되면 접속 차단으로 간주하고 남은 인원은 요청 없이 건너뛴다.
const CONSECUTIVE_FAIL_LIMIT = 3

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const randomDelay = () => DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS)

// 취소 가능한 대기 — 중단 요청이 들어오면 남은 딜레이를 기다리지 않고 바로 깨어난다.
async function interruptibleSleep(ms: number, isCancelled: () => boolean) {
  const step = 100
  for (let waited = 0; waited < ms; waited += step) {
    if (isCancelled()) return
    await sleep(Math.min(step, ms - waited))
  }
}

// 리스트 조회 → calcNo 별 순차 비교실행(runCompareForCalcNo, 세션 재사용) → SSE로 진행상황 전송 →
// 전량 완료 후 saveResults(엑셀 저장 등)를 호출해 결과 저장경로를 done 이벤트로 전달.
// 4개 비교탭(기부금/신용카드/의료비/연금계좌)의 "전체 실행" 배치 라우트가 공통으로 사용.
// 클라이언트가 연결을 끊으면(중단 버튼 → EventSource.close()) 플랫폼이 stream의 cancel()을 호출 —
// 이를 신호로 남은 인원은 요청을 보내지 않고 즉시 중단한다.
export function streamCompareBatch<T extends { calcNo: string }>(
  getItems: () => Promise<T[]>,
  ntsYear: string,
  saveResults: (rows: BatchRow<T>[]) => string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let cancelled = false

  return new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          /* 클라이언트가 이미 연결을 끊은 경우 enqueue 실패 — 무시 */
        }
      }

      try {
        const items = await getItems()
        send("start", { total: items.length })

        const rows: BatchRow<T>[] = []
        let consecutiveFailures = 0
        let blocked = false

        for (let i = 0; i < items.length && !cancelled; i++) {
          const item = items[i]

          if (blocked) {
            const msg = "국세청 접속 차단 의심으로 건너뜀"
            rows.push({ item, result: null, error: msg, ranAt: new Date().toISOString(), duration: 0 })
            send("row", { calcNo: item.calcNo, ok: false, error: msg, duration: 0 })
            continue
          }

          const startedAt = Date.now()
          try {
            const result = await runCompareForCalcNo(item.calcNo, ntsYear)
            const duration = Date.now() - startedAt
            rows.push({ item, result, error: null, ranAt: new Date().toISOString(), duration })
            send("row", { calcNo: item.calcNo, ok: true, result, duration })
            consecutiveFailures = 0
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            const duration = Date.now() - startedAt
            rows.push({ item, result: null, error: msg, ranAt: new Date().toISOString(), duration })
            send("row", { calcNo: item.calcNo, ok: false, error: msg, duration })
            consecutiveFailures++
            if (consecutiveFailures >= CONSECUTIVE_FAIL_LIMIT) {
              blocked = true
              send("blocked", {
                message: `연속 ${CONSECUTIVE_FAIL_LIMIT}건 실패 — 국세청 접속 차단 의심. 남은 ${items.length - i - 1}명은 요청 없이 건너뜁니다.`,
              })
            }
          }

          if (!blocked && i < items.length - 1) await interruptibleSleep(randomDelay(), () => cancelled)
        }

        const filePath = saveResults(rows)
        send("done", { filePath, count: rows.length, cancelled })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        send("error", { message: msg })
      } finally {
        try { controller.close() } catch { /* 이미 취소되어 닫힌 경우 무시 */ }
      }
    },
    cancel() {
      cancelled = true
    },
  })
}
