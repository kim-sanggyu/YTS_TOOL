import { NextRequest } from "next/server"
import fs from "node:fs"
import path from "node:path"
import * as XLSX from "xlsx"
import { auth } from "@/auth"
import { getEtcItems, type EtcListItem } from "@/features/hometax-calc/lib/etcList"
import { streamCompareBatch, type BatchRow } from "@/features/hometax-calc/lib/streamCompareBatch"
import { upsertBatchResults, batchRowToStored, loadBatchResults } from "@/features/hometax-calc/lib/batchResultStore"

export const dynamic = "force-dynamic"
export const maxDuration = 800

const ATTR_YR = "2025"

// 기타(월세 등) 요약(건별 세액공제 합)+세부(항목별 대조) 두 시트로 엑셀 워크북 구성.
// 이질 항목이라 소계코드가 없어 NTS 공제는 lines 의 각 code 합으로 계산.
function buildWorkbook(rows: BatchRow<EtcListItem>[]) {
  const summary = rows.map(({ item, result, error }) => {
    const ntsDdc = result ? item.lines.reduce((s, l) => s + (result.ntsMap[l.code] ?? 0), 0) : null
    const diff   = ntsDdc != null ? ntsDdc - item.etcDdc : null
    return {
      CALC_NO:      item.calcNo,
      이름:          item.nm,
      총급여:        item.totPayAmt,
      YTS_기타공제:  item.etcDdc,
      NTS_기타공제:  ntsDdc,
      차이:          diff,
      일치:          diff === 0,
      소진:          item.exhaustLabel ?? "",
      오류:          error ?? "",
    }
  })

  const detail = rows.flatMap(({ item, result }) =>
    item.lines.map(line => ({
      CALC_NO:     item.calcNo,
      이름:         item.nm,
      항목:         line.label,
      코드:         line.code,
      전송사용액:  line.ytsInput,
      YTS공제:     line.ytsDdc,
      NTS공제:     result ? (result.ntsMap[line.code] ?? null) : null,
    }))
  )

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "요약")
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "세부")
  return wb
}

function saveWorkbook(rows: BatchRow<EtcListItem>[], year: string, ntsYear: string): string {
  const dir = path.join(process.cwd(), "data", "hometax-etc-batch")
  fs.mkdirSync(dir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const filePath = path.join(dir, `etc-batch-${year}-nts${ntsYear}-${ts}.xlsx`)
  const buf = XLSX.write(buildWorkbook(rows), { type: "buffer", bookType: "xlsx" }) as Buffer
  fs.writeFileSync(filePath, buf)
  return path.relative(process.cwd(), filePath)
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증이 필요합니다." }, { status: 401 })

  const year    = req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear())
  const ntsYear = (req.nextUrl.searchParams.get("ntsYear") ?? ATTR_YR).trim()

  const stream = streamCompareBatch(
    () => getEtcItems(year),
    ntsYear,
    rows => {
      const filePath = saveWorkbook(rows, year, ntsYear)
      upsertBatchResults(year, ntsYear, rows.map(batchRowToStored))   // 복원용 JSON 캐시
      return filePath
    },
    loadBatchResults(year, ntsYear)?.rows,   // 지문 같은 사람은 국세청 호출 스킵
  )

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection:      "keep-alive",
    },
  })
}
