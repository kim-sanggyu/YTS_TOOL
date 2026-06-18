import { Construction } from "lucide-react"

const TOOL_NAMES: Record<string, string> = {
  "data-verify":  "신고 데이터 검증",
  "tax-calc":     "공제 금액 계산기",
  "diff-checker": "전년도 비교",
  "report-gen":   "리포트 생성",
}

export default async function ToolComingSoonPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const title = TOOL_NAMES[slug] ?? slug

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      <div className="flex flex-col items-center justify-center gap-4 py-40 text-muted-foreground">
        <Construction className="h-12 w-12 opacity-40" />
        <p className="text-lg font-medium">개발 중입니다</p>
        <p className="text-sm">빠른 시일 내에 제공될 예정입니다.</p>
      </div>
    </div>
  )
}
