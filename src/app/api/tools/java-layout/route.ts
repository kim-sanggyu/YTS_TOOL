import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { parseJavaLayout } from "@/features/media-layout/lib/java-layout-parser"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ message: "인증 필요" }, { status: 401 })

  try {
    const form = await req.formData()
    const file = form.get("java") as File | null
    if (!file) return NextResponse.json({ message: "Java 파일이 없습니다." }, { status: 400 })

    const { fields, skipped, detectedSections } = parseJavaLayout(await file.text())

    const byRecord: Record<string, typeof fields> = {}
    for (const f of fields) {
      if (!byRecord[f.record]) byRecord[f.record] = []
      byRecord[f.record].push(f)
    }

    return NextResponse.json({
      total:    fields.length,
      skipped,
      records:  Object.keys(byRecord).sort(),
      byRecord,
      detectedSections,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "파싱 오류"
    return NextResponse.json({ message }, { status: 500 })
  }
}
