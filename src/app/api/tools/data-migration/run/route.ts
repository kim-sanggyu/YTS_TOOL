import { NextRequest } from "next/server"
import { auth } from "@/auth"
import oracledb from "oracledb"
import { withConnection, query } from "@/lib/db/oracle"
import { createScripts, ScriptConfig, DefectMap } from "@/features/tax-calculate/data-migration/lib/scripts"

type Row = Record<string, unknown>

async function runMigration(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conn: any,
  config: ScriptConfig,
  fromYear: string,
  toYear: string,
  log: (msg: string) => void
): Promise<{ deleted: number; inserted: number }> {
  log(`   1/4. 대상 데이터 조회 중...`)
  const result = await conn.execute(
    `SELECT * FROM ${config.table} WHERE CALC_NO LIKE '%Y${fromYear}%'`,
    [],
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  )

  if (!result.rows || result.rows.length === 0) {
    log(`변환 대상 데이터(Y${fromYear}%)가 존재하지 않습니다.`)
    return { deleted: 0, inserted: 0 }
  }

  log(`   2/4. 데이터 검증 및 변환 중... (${result.rows.length}건)`)
  const rowsToInsert: Row[] = result.rows
    .map((row: Row, index: number) => config.transformRow(row, index))
    .filter((row: Row | null): row is Row => row !== null)
  const skipped = result.rows.length - rowsToInsert.length
  if (skipped > 0) log(`   >> ${skipped}건 제외 (당해잔여 drop)`)

  log(`   3/4. 기존 데이터 삭제 중...`)
  const delResult = await conn.execute(
    `DELETE FROM ${config.table} WHERE CALC_NO LIKE :prefix`,
    [`X${toYear}%`]
  )
  const totalDeleted = delResult.rowsAffected ?? 0

  log(`   4/4. 신규 데이터 삽입 중...`)
  const columns: string[] = result.metaData.map((m: { name: string }) => m.name)
  const colList = columns.join(", ")
  const bindList = columns
    .map((c: string) => ["INS_DT", "UPT_DT"].includes(c) ? "SYSDATE" : `:${c}`)
    .join(", ")
  const insertSql = `INSERT INTO ${config.table} (${colList}) VALUES (${bindList})`

  const insertResult = await conn.executeMany(insertSql, rowsToInsert)
  return { deleted: totalDeleted, inserted: insertResult.rowsAffected ?? 0 }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) {
    return new Response(`data: ${JSON.stringify({ type: "error", msg: "인증 필요" })}\n\n`, {
      status: 401,
      headers: { "Content-Type": "text/event-stream" },
    })
  }

  const { scripts: scriptIds, fromYear, toYear }:
    { scripts: string[]; fromYear: string; toYear: string } = await req.json()

  // C03(PAY_WRK_FMLY) 포함 시 경계나이 보정 맵 사전 로드 (yttsDb)
  let defectMap: DefectMap | undefined
  if (scriptIds.includes("c03")) {
    const defectRows = await query<{ CALC_NO: string; FMLY_SEQ: number; CHG_RES_NO: string; CHG_FMLY_NM: string }>(
      "ytts",
      `SELECT CALC_NO, FMLY_SEQ, CHG_RES_NO, CHG_FMLY_NM
       FROM CALC_FMLY_AGE_DEFECT
       WHERE YY = :1
         AND CHG_RES_NO IS NOT NULL
         AND CHG_FMLY_NM IS NOT NULL`,
      [fromYear]
    )
    defectMap = new Map(defectRows.map(r => [`${r.CALC_NO}_${r.FMLY_SEQ}`, r]))
  }

  const allScripts = createScripts(fromYear, toYear, defectMap)
  const selectedScripts = scriptIds
    .map(id => allScripts.find(s => s.id === id))
    .filter(Boolean) as ScriptConfig[]

  const encoder = new TextEncoder()
  let cancelled = false

  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, payload: Record<string, unknown>) => {
        if (cancelled) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`))
        } catch {
          cancelled = true
        }
      }

      const startTime = Date.now()
      const startLabel = new Date(startTime).toLocaleString("ko-KR", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      })
      send("log", { msg: "====================================================" })
      send("log", { msg: ` [START] Y${fromYear} → X${toYear} 마이그레이션 실행` })
      send("log", { msg: ` 실행 시각: ${startLabel}` })
      send("log", { msg: "====================================================" })

      let allSuccess = true

      for (const config of selectedScripts) {
        if (cancelled) {
          send("log", { msg: `` })
          send("log", { msg: ` [CANCELLED] 취소 요청으로 중단합니다.` })
          send("log", { msg: "====================================================" })
          send("done", { success: false, cancelled: true })
          return
        }

        send("status", { scriptId: config.id, state: "running" })
        send("log", { msg: `` })
        send("log", { msg: `[RUNNING] ${config.table} 실행 중...` })

        try {
          const result = await withConnection("yts", async (conn) => {
            return runMigration(conn, config, fromYear, toYear, (msg) => send("log", { msg }))
          })
          send("log", { msg: `>> ${config.table}: 삭제 ${result.deleted}건 / 삽입 ${result.inserted}건 완료` })
          const substituted = config.getSubstituted?.() ?? 0
          if (substituted > 0) {
            send("log", { msg: `   >> 대체주민번호 적용: ${substituted}건` })
          }
          send("status", { scriptId: config.id, state: "done", substituted: substituted || undefined })
          send("log", { msg: `[SUCCESS] ${config.table} 완료` })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          send("log", { msg: `[FAILURE] ${config.table}: ${msg}` })
          send("status", { scriptId: config.id, state: "error" })
          allSuccess = false
          send("log", { msg: `\n오류 발생으로 이후 작업을 중단합니다.` })
          break
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2)
      const endLabel = new Date().toLocaleString("ko-KR", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      })
      send("log", { msg: `` })
      send("log", { msg: "====================================================" })
      if (allSuccess) {
        send("log", { msg: ` [COMPLETE] 모든 작업이 완료되었습니다. (${duration}초)` })
      } else {
        send("log", { msg: ` [FAILED] 작업이 실패하였습니다. (${duration}초)` })
      }
      send("log", { msg: ` 완료 시각: ${endLabel}` })
      send("log", { msg: "====================================================" })
      send("done", { success: allSuccess })

      controller.close()
    },
    cancel() {
      cancelled = true
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    }
  })
}
