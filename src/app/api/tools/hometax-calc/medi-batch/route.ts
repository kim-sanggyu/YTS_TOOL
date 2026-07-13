import { NextRequest } from "next/server"
import fs from "node:fs"
import path from "node:path"
import * as XLSX from "xlsx"
import { auth } from "@/auth"
import { getMediItems, type MediListItem } from "@/features/hometax-calc/lib/mediList"
import { MEDI_SUBTOTAL_CODE } from "@/features/hometax-calc/mapping/medi"
import { streamCompareBatch, type BatchRow } from "@/features/hometax-calc/lib/streamCompareBatch"
import { upsertBatchResults, batchRowToStored } from "@/features/hometax-calc/lib/batchResultStore"

export const dynamic = "force-dynamic"
export const maxDuration = 800

const ATTR_YR = "2025"

// 의료비 요약(건별 세액공제 소계)+세부(대상자별 전송 지출금액) 두 시트로 엑셀 워크북 구성.
function buildWorkbook(rows: BatchRow<MediListItem>[]) {
  const summary = rows.map(({ item, result, error }) => {
    const ntsDdc = result ? (result.ntsMap[MEDI_SUBTOTAL_CODE] ?? 0) : null
    const diff   = ntsDdc != null ? ntsDdc - item.mediDdc : null
    return {
      CALC_NO:      item.calcNo,
      이름:          item.nm,
      총급여:        item.totPayAmt,
      YTS_의료비공제: item.mediDdc,
      NTS_의료비공제: ntsDdc,
      차이:          diff,
      일치:          diff === 0,
      소진:          item.exhaustLabel ?? "",
      오류:          error ?? "",
    }
  })

  const detail = rows.flatMap(({ item }) =>
    item.lines.map(line => ({
      CALC_NO:     item.calcNo,
      이름:         item.nm,
      항목:         line.label,
      전송지출금액: line.useAmt,
    }))
  )

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "요약")
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "세부")
  return wb
}

function saveWorkbook(rows: BatchRow<MediListItem>[], year: string, ntsYear: string): string {
  const dir = path.join(process.cwd(), "data", "hometax-medi-batch")
  fs.mkdirSync(dir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const filePath = path.join(dir, `medi-batch-${year}-nts${ntsYear}-${ts}.xlsx`)
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
    () => getMediItems(year),
    ntsYear,
    rows => {
      const filePath = saveWorkbook(rows, year, ntsYear)
      upsertBatchResults(year, ntsYear, rows.map(batchRowToStored))   // 복원용 JSON 캐시
      return filePath
    },
  )

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection:      "keep-alive",
    },
  })
}
