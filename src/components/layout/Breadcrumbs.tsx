"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight, Home } from "lucide-react"

// 툴 경로 → { 그룹명, 페이지명 }
const TOOL_META: Record<string, { group: string; label: string }> = {
  // 전산매체
  "hwp-layout":     { group: "전산매체", label: ".hwp파일 업로드" },
  "java-layout":    { group: "전산매체", label: ".java소스 업로드" },
  "media-layout":   { group: "전산매체", label: "전산매체 비교·편집" },
  "media-generate": { group: "전산매체", label: "전산매체 소스 생성" },
  "data-verify":    { group: "전산매체", label: "전산매체 파일 검증" },
  // 세액계산
  "tax-dashboard":  { group: "세액계산", label: "연말정산 대시보드" },
  "tax-insight":    { group: "세액계산", label: "세액계산 종합진단" },
  "fmly-age-check": { group: "세액계산", label: "공제요건 경계나이 관리" },
  "data-migration": { group: "세액계산", label: "차년도 데이터 생성" },
  "tax-calc":       { group: "세액계산", label: "세액계산 로직 검증" },
  // 운영지원
  "pdf-history":    { group: "운영지원", label: "PDF 수정내역" },
  "insurance-calc": { group: "운영지원", label: "보험료 검증자료 산출" },
  // 파일배포
  "deploy-gen":     { group: "파일배포", label: "배포파일 생성" },
  // 과제관리
  "task-status":    { group: "과제관리", label: "과제현황" },
  "task-archive":   { group: "과제관리", label: "자료실" },
}

export function Breadcrumbs() {
  const pathname = usePathname()
  const segments = pathname.split("/").filter(Boolean)

  if (segments.length === 0) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Home className="h-3.5 w-3.5" />
        <span>대시보드</span>
      </span>
    )
  }

  // /tools/[slug] 형태면 그룹명 + 페이지명으로 변환
  const toolSlug = segments[1]
  const meta = toolSlug ? TOOL_META[toolSlug] : undefined

  const crumbs = meta
    ? [
        { label: meta.group, href: "/", isLast: false },
        { label: meta.label, href: pathname,  isLast: true  },
      ]
    : segments.map((seg, i) => ({
        label: seg,
        href: "/" + segments.slice(0, i + 1).join("/"),
        isLast: i === segments.length - 1,
      }))

  return (
    <nav className="flex items-center gap-1 text-xs text-muted-foreground">
      <Link href="/" className="flex items-center hover:text-foreground transition-colors">
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3" />
          {crumb.isLast ? (
            <span className="font-medium text-foreground">{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="hover:text-foreground transition-colors">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}
