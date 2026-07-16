import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { spawn } from "node:child_process"
import path from "node:path"
import fs from "node:fs"

// 배치 결과 xlsx 를 탐색기(파일 선택 상태)로 연다. 로컬 운영 포털(서버=클라이언트 PC) 전제.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return Response.json({ error: "인증이 필요합니다." }, { status: 401 })

  const { path: rel } = (await req.json().catch(() => ({}))) as { path?: string }
  if (!rel) return Response.json({ error: "경로가 없습니다." }, { status: 400 })

  const cwd      = process.cwd()
  const full     = path.resolve(cwd, rel)
  const dataRoot = path.join(cwd, "data")

  // 경로 탈출 방지 — data 하위 + .xlsx 만 허용
  if (!full.startsWith(dataRoot + path.sep) || path.extname(full).toLowerCase() !== ".xlsx") {
    return Response.json({ error: "허용되지 않은 경로입니다." }, { status: 400 })
  }
  if (!fs.existsSync(full)) return Response.json({ error: "파일이 없습니다." }, { status: 404 })

  try {
    if (process.platform === "win32") {
      spawn("explorer.exe", [`/select,${full}`], { detached: true }).unref()
    } else if (process.platform === "darwin") {
      spawn("open", ["-R", full], { detached: true }).unref()
    } else {
      spawn("xdg-open", [path.dirname(full)], { detached: true }).unref()
    }
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
