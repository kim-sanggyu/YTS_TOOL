import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { parseHwpBuffer } from "@/features/media-layout/lib/hwp-parser"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  try {
    const form    = await req.formData()
    const hwpFile = form.get("hwp") as File | null
    if (!hwpFile) return NextResponse.json({ message: "HWP 파일이 없습니다." }, { status: 400 })

    const buffer = Buffer.from(await hwpFile.arrayBuffer())
    const { fields, detectedSections } = parseHwpBuffer(buffer)

    // 레코드별 그룹핑
    const byRecord: Record<string, typeof fields> = {}
    for (const f of fields) {
      if (!byRecord[f.record]) byRecord[f.record] = []
      byRecord[f.record].push(f)
    }

    return NextResponse.json({
      total:    fields.length,
      records:  Object.keys(byRecord).sort(),
      byRecord,
      detectedSections,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "파싱 오류"
    return NextResponse.json({ message }, { status: 500 })
  }
}
