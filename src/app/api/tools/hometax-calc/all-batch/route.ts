import { NextRequest } from "next/server"
import fs from "node:fs"
import path from "node:path"
import * as XLSX from "xlsx"
import { auth } from "@/auth"
import { getAllItems, type AllListItem } from "@/features/hometax-calc/lib/allList"
import { streamCompareBatch, type BatchRow } from "@/features/hometax-calc/lib/streamCompareBatch"
import { upsertBatchResults, batchRowToStored, loadBatchResults } from "@/features/hometax-calc/lib/batchResultStore"

export const dynamic = "force-dynamic"
export const maxDuration = 800

const ATTR_YR = "2025"

// 전체 비교(종합) — 전 직원 산출세액·결정세액 YTS↔NTS 대조 요약.
function buildWorkbook(rows: BatchRow<AllListItem>[]) {
  const summary = rows.map(({ item, result, error }) => {
    const ntsProd  = result?.nts.prodTax ?? null
    const ntsDcd   = result?.nts.decidedTax ?? null
    const prodDiff = ntsProd != null ? ntsProd - item.prodTaxAmt : null
    const dcdDiff  = ntsDcd  != null ? ntsDcd  - item.resIncmTax : null
    return {
      CALC_NO:      item.calcNo,
      이름:          item.nm,
      총급여:        item.totPayAmt,
      YTS_산출세액: item.prodTaxAmt,
      NTS_산출세액: ntsProd,
      산출차이:      prodDiff,
      YTS_결정세액: item.resIncmTax,
      NTS_결정세액: ntsDcd,
      결정차이:      dcdDiff,
      일치:          prodDiff === 0 && dcdDiff === 0,
      오류:          error ?? "",
    }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "전체비교")
  return wb
}

function saveWorkbook(rows: BatchRow<AllListItem>[], year: string, ntsYear: string): string {
  const dir = path.join(process.cwd(), "data", "hometax-all-batch")
  fs.mkdirSync(dir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const filePath = path.join(dir, `all-batch-${year}-nts${ntsYear}-${ts}.xlsx`)
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
    () => getAllItems(year),
    ntsYear,
    rows => {
      const filePath = saveWorkbook(rows, year, ntsYear)
      upsertBatchResults(year, ntsYear, rows.map(batchRowToStored), filePath)
      return filePath
    },
    loadBatchResults(year, ntsYear)?.rows,   // 지문 같은 사람은 국세청 호출 스킵 (전직원이라 캐시 스킵이 핵심)
  )

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  })
}
