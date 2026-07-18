import { NextRequest } from "next/server"
import fs from "node:fs"
import path from "node:path"
import * as XLSX from "xlsx"
import { auth } from "@/auth"
import { getHousingItems, type HousingListItem } from "@/features/hometax-calc/lib/housingList"
import { streamCompareBatch, type BatchRow } from "@/features/hometax-calc/lib/streamCompareBatch"
import { upsertBatchResults, batchRowToStored, loadBatchResults } from "@/features/hometax-calc/lib/batchResultStore"

export const dynamic = "force-dynamic"
export const maxDuration = 800

const ATTR_YR = "2025"

// 주택자금(특별소득공제) 요약(항목수·불일치)+세부(항목별 대조) 두 시트. 한도 있어 NTS OUT ↔ YTS 공제액(SP_*_AMT) 대조.
function buildWorkbook(rows: BatchRow<HousingListItem>[]) {
  const summary = rows.map(({ item, result, error }) => {
    const mismatch = result ? item.lines.filter(l => (result.ntsMap[l.code] ?? 0) !== l.ytsDdc).length : null
    return {
      CALC_NO:  item.calcNo,
      이름:      item.nm,
      총급여:    item.totPayAmt,
      항목수:    item.lines.length,
      불일치:    mismatch,
      소진:      item.exhaustLabel ?? "",
      오류:      error ?? "",
    }
  })

  const detail = rows.flatMap(({ item, result }) =>
    item.lines.map(line => {
      const ntsVal = result ? (result.ntsMap[line.code] ?? 0) : null
      return {
        CALC_NO: item.calcNo,
        이름:     item.nm,
        항목:     line.label,
        코드:     line.code,
        YTS공제:  line.ytsDdc,
        NTS공제:  ntsVal,
        차이:     ntsVal != null ? ntsVal - line.ytsDdc : null,
      }
    })
  )

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "요약")
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "세부")
  return wb
}

function saveWorkbook(rows: BatchRow<HousingListItem>[], year: string, ntsYear: string): string {
  const dir = path.join(process.cwd(), "data", "hometax-housing-batch")
  fs.mkdirSync(dir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const filePath = path.join(dir, `housing-batch-${year}-nts${ntsYear}-${ts}.xlsx`)
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
    () => getHousingItems(year),
    ntsYear,
    rows => {
      const filePath = saveWorkbook(rows, year, ntsYear)
      upsertBatchResults(year, ntsYear, rows.map(batchRowToStored), filePath)   // 복원용 JSON 캐시(엑셀 경로 포함)
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
