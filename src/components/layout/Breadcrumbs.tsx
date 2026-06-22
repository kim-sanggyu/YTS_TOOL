"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight, Home } from "lucide-react"

const PATH_LABELS: Record<string, string> = {
  "tools":          "전산매체",
  "hwp-layout":     ".hwp파일 업로드",
  "java-layout":    ".java소스 업로드",
  "media-layout":   "전산매체 비교·편집",
  "media-generate": "전산매체 소스 생성",
  "settings":       "설정",
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

  const crumbs = segments.map((seg, i) => ({
    label: PATH_LABELS[seg] ?? seg,
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
