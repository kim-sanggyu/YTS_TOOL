import { NextRequest, NextResponse } from "next/server"
import { getItemNotes, upsertItemNote, deleteItemNote } from "@/lib/tax-oracle"
import { auth } from "@/auth"

function userId(session: { user?: { id?: string } | null } | null) {
  return parseInt(session?.user?.id ?? "0")
}

// GET: 연도별 노트 조회 (record 파라미터 선택)
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const year   = parseInt(req.nextUrl.searchParams.get("year")   ?? "0")
  const record = req.nextUrl.searchParams.get("record") ?? undefined
  if (!year)   return NextResponse.json({ notes: [] })

  const notes = await getItemNotes(year, userId(session), record)
  return NextResponse.json({ notes })
}

// PUT: 노트 생성/수정
export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const { year, recordType, code, memo, isDone, color } = await req.json()
  if (!year || !recordType || !code)
    return NextResponse.json({ message: "필수 값 누락" }, { status: 400 })

  await upsertItemNote(year, userId(session), { recordType, code, memo: memo ?? "", isDone: !!isDone, color: color ?? "yellow" })
  return NextResponse.json({ ok: true })
}

// DELETE: 노트 삭제
export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  const year       = parseInt(req.nextUrl.searchParams.get("year")   ?? "0")
  const recordType = req.nextUrl.searchParams.get("record") ?? ""
  const code       = req.nextUrl.searchParams.get("code")   ?? ""
  if (!year || !recordType || !code)
    return NextResponse.json({ message: "필수 값 누락" }, { status: 400 })

  await deleteItemNote(year, userId(session), recordType, code)
  return NextResponse.json({ ok: true })
}
