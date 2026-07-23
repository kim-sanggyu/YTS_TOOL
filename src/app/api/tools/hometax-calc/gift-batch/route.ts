import { NextRequest } from "next/server"
import fs from "node:fs"
import path from "node:path"
import * as XLSX from "xlsx"
import { auth } from "@/auth"
import { getGiftItems, type GiftListItem } from "@/features/hometax-calc/lib/giftList"
import { streamCompareBatch, type BatchRow } from "@/features/hometax-calc/lib/streamCompareBatch"
import { upsertBatchResults, batchRowToStored, loadBatchResults } from "@/features/hometax-calc/lib/batchResultStore"

export const dynamic = "force-dynamic"
export const maxDuration = 800

const ATTR_YR = "2025"

// 기부금 요약(건별 합계)+세부(유형×연도) 두 시트로 엑셀 워크북 구성.
// DB 저장 테이블이 아직 없어, 나중에 찾아볼 수 있도록 우선 파일로 남긴다.
function buildWorkbook(rows: BatchRow<GiftListItem>[]) {
  const summary = rows.map(({ item, result, error }) => {
    const ntsTotal = result
      ? item.lines.reduce((s, l) => s + (l.code ? (result.ntsMap[l.code] ?? 0) : 0), 0)
      : null
    const diff = ntsTotal != null ? ntsTotal - item.giftTax : null
    return {
      CALC_NO:      item.calcNo,
      이름:          item.nm,
      총급여:        item.totPayAmt,
      YTS_공제합계: item.giftTax,
      NTS_공제합계: ntsTotal,
      차이:          diff,
      일치:          diff === 0,
      소진:          item.exhaustLabel ?? "",
      오류:          error ?? "",
    }
  })

  const detail = rows.flatMap(({ item, result }) =>
    item.lines.map(line => {
      const ntsVal = result && line.code ? (result.ntsMap[line.code] ?? 0) : null
      return {
        CALC_NO: item.calcNo,
        이름:     item.nm,
        유형:     line.label,
        연도:     line.giftYy,
        YTS_공제: line.ytsSub,
        NTS_공제: ntsVal,
        차이:     ntsVal != null ? ntsVal - line.ytsSub : null,
      }
    })
  )

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "요약")
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "세부")
  return wb
}

function saveWorkbook(rows: BatchRow<GiftListItem>[], year: string, ntsYear: string): string {
  const dir = path.join(process.cwd(), "data", "hometax-gift-batch")
  fs.mkdirSync(dir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const filePath = path.join(dir, `gift-batch-${year}-nts${ntsYear}-${ts}.xlsx`)
  // XLSX.writeFile()은 내부적으로 require("fs")에 의존하는데 Next.js(Turbopack) 번들링 환경에서는
  // 이 require가 우회되어 실패한다(SheetJS의 "cannot save file" 폴백 에러). 버퍼로 뽑아 직접 기록한다.
  const buf = XLSX.write(buildWorkbook(rows), { type: "buffer", bookType: "xlsx" }) as Buffer
  fs.writeFileSync(filePath, buf)
  return path.relative(process.cwd(), filePath)
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증이 필요합니다." }, { status: 401 })

  const year    = req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear())
  const ntsYear = (req.nextUrl.searchParams.get("ntsYear") ?? ATTR_YR).trim()
  const sortKey = req.nextUrl.searchParams.get("sortKey")
  const sort = sortKey ? { key: sortKey, dir: (req.nextUrl.searchParams.get("sortDir") === "desc" ? "desc" : "asc") as "asc" | "desc" } : null

  const stream = streamCompareBatch(
    () => getGiftItems(year, ntsYear),
    ntsYear,
    rows => {
      const filePath = saveWorkbook(rows, year, ntsYear)
      upsertBatchResults(year, ntsYear, rows.map(batchRowToStored), filePath)   // 복원용 JSON 캐시(엑셀 경로 포함)
      return filePath
    },
    loadBatchResults(year, ntsYear)?.rows, sort,   // 지문 같은 사람은 국세청 호출 스킵
  )

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection:      "keep-alive",
    },
  })
}
