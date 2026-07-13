import { NextRequest } from "next/server"
import fs from "node:fs"
import path from "node:path"
import * as XLSX from "xlsx"
import { auth } from "@/auth"
import { getPensionItems, type PensionListItem } from "@/features/hometax-calc/lib/pensionList"
import { PENSION_SUBTOTAL_CODE } from "@/features/hometax-calc/mapping/pension"
import { streamCompareBatch, type BatchRow } from "@/features/hometax-calc/lib/streamCompareBatch"

export const dynamic = "force-dynamic"
export const maxDuration = 800

const ATTR_YR = "2025"

// 연금계좌 요약(건별 세액공제 소계)+세부(종류별 전송 납입액) 두 시트로 엑셀 워크북 구성.
function buildWorkbook(rows: BatchRow<PensionListItem>[]) {
  const summary = rows.map(({ item, result, error }) => {
    const ntsDdc = result ? (result.ntsMap[PENSION_SUBTOTAL_CODE] ?? 0) : null
    const diff   = ntsDdc != null ? ntsDdc - item.penDdc : null
    return {
      CALC_NO:        item.calcNo,
      이름:            item.nm,
      총급여:          item.totPayAmt,
      YTS_연금계좌공제: item.penDdc,
      NTS_연금계좌공제: ntsDdc,
      차이:            diff,
      일치:            diff === 0,
      소진:            item.exhaustLabel ?? "",
      오류:            error ?? "",
    }
  })

  const detail = rows.flatMap(({ item }) =>
    item.lines.map(line => ({
      CALC_NO:   item.calcNo,
      이름:       item.nm,
      항목:       line.label,
      전송납입액: line.useAmt,
    }))
  )

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "요약")
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "세부")
  return wb
}

function saveWorkbook(rows: BatchRow<PensionListItem>[], year: string, ntsYear: string): string {
  const dir = path.join(process.cwd(), "data", "hometax-pension-batch")
  fs.mkdirSync(dir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const filePath = path.join(dir, `pension-batch-${year}-nts${ntsYear}-${ts}.xlsx`)
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
    () => getPensionItems(year),
    ntsYear,
    rows => saveWorkbook(rows, year, ntsYear),
  )

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection:      "keep-alive",
    },
  })
}
