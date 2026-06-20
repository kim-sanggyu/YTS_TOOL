"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import {
  LayoutDashboard, FileText, FileCode, Database, Calculator,
  GitCompare, FileOutput, Settings, LogOut, ChevronsUpDown, ChevronDown, FileSearch, Code2,
  ClipboardList, Package, ClipboardCheck, FolderOpen,
} from "lucide-react"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarTrigger,
} from "@/components/ui/sidebar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

interface NavChild {
  title: string
  href: string
  icon: React.ElementType
  disabled?: boolean
}
interface NavGroup {
  label: string
  children: NavChild[]
}

const navMain = [
  { title: "대시보드", href: "/", icon: LayoutDashboard },
]

const navGroups: NavGroup[] = [
  {
    label: "전산매체",
    children: [
      { title: ".hwp파일 업로드",    href: "/tools/hwp-layout",    icon: FileSearch },
      { title: ".java소스 업로드",   href: "/tools/java-layout",   icon: FileCode },
      { title: "전산매체 비교·검증", href: "/tools/media-layout",  icon: GitCompare },
      { title: "전산매체 소스 생성", href: "/tools/media-generate", icon: Code2 },
      { title: "전산매체 파일 검증", href: "/tools/data-verify",   icon: Database,  disabled: true },
    ],
  },
  {
    label: "세액계산",
    children: [
      { title: "세액계산 로직 검증", href: "/tools/tax-calc", icon: Calculator, disabled: true },
      { title: "차년도 데이터 생성", href: "/tools/diff-checker", icon: GitCompare, disabled: true },
      { title: "세액계산 내용 조회", href: "/tools/report-gen",  icon: FileOutput, disabled: true },
    ],
  },
  {
    label: "운영지원",
    children: [
      { title: "PDF 수정내역",        href: "/tools/pdf-history",    icon: FileText,      disabled: true },
      { title: "보험료 검증자료 산출", href: "/tools/insurance-calc", icon: ClipboardList, disabled: true },
    ],
  },
  {
    label: "파일배포",
    children: [
      { title: "배포파일 생성", href: "/tools/deploy-gen", icon: Package, disabled: true },
    ],
  },
  {
    label: "과제관리",
    children: [
      { title: "과제현황", href: "/tools/task-status",  icon: ClipboardCheck, disabled: true },
      { title: "자료실",   href: "/tools/task-archive", icon: FolderOpen,     disabled: true },
    ],
  },
]

interface AppSidebarProps {
  user?: { name?: string | null; email?: string | null }
}

export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname()

  const defaultGroups: Record<string, boolean> = {
    "전산매체": true, "세액계산": true, "운영지원": true, "파일배포": true, "과제관리": true,
  }
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(defaultGroups)

  useEffect(() => {
    try {
      const saved = localStorage.getItem("yts:sidebar-groups")
      if (saved) setOpenGroups({ ...defaultGroups, ...JSON.parse(saved) })
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleGroup(label: string) {
    setOpenGroups(prev => {
      const next = { ...prev, [label]: !prev[label] }
      try { localStorage.setItem("yts:sidebar-groups", JSON.stringify(next)) } catch {}
      return next
    })
  }

  const initials = (user?.name ?? "U")
    .split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)

  return (
    <Sidebar collapsible="icon">
      {/* 헤더: YTS Tool 텍스트(접으면 숨김) + 접기 버튼(항상 우측) */}
      <SidebarHeader className="flex h-10 shrink-0 flex-row items-center border-b border-sidebar-border px-3">
        <span className="flex-1 text-[15px] font-semibold text-sidebar-foreground group-data-[collapsible=icon]:hidden">
          YTS Tool
        </span>
        <SidebarTrigger className="h-7 w-7 shrink-0 rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
      </SidebarHeader>

      {/* 네비게이션 */}
      <SidebarContent className="px-0 py-2">

        {/* 메인 메뉴 */}
        <SidebarMenu className="px-2 mb-2">
          {navMain.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                render={<Link href={item.href} />}
                isActive={pathname === item.href}
                tooltip={item.title}
                className={cn(
                  "h-8 gap-2 px-2 text-[13px] rounded-md",
                  pathname === item.href
                    ? "!bg-gray-300 !text-gray-900 font-semibold"
                    : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                )}
              >
                <item.icon className="h-3.5 w-3.5 shrink-0" />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>

        {/* 카테고리 그룹 */}
        {navGroups.map((group) => {
          const isOpen = openGroups[group.label] ?? true
          const allDisabled = group.children.every(c => c.disabled)

          return (
            <div key={group.label} className="mb-1">
              {/* 접혔을 때 대메뉴 구분선 (펼쳤을 때는 그룹 라벨이 구분함) */}
              <hr className="hidden group-data-[collapsible=icon]:block border-t border-sidebar-border mx-2 my-1" />
              {/* 그룹 라벨 — 접으면 숨김 */}
              <button
                onClick={() => toggleGroup(group.label)}
                className="flex w-full items-center gap-2 px-4 py-1 text-[11px] font-semibold uppercase tracking-widest text-sidebar-foreground/70 transition-colors hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden"
              >
                <span className="flex-1 text-left">{group.label}</span>
                {!isOpen && allDisabled && (
                  <span className="rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-normal normal-case tracking-normal text-sidebar-foreground/50 opacity-50">
                    준비중
                  </span>
                )}
                <ChevronDown className={cn("h-3 w-3 transition-transform", isOpen && "rotate-180")} />
              </button>

              {/* 서브 메뉴 — 접혔을 때도 아이콘은 표시 */}
              {isOpen && (
                <SidebarMenu className="px-2">
                  {group.children.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        render={<Link href={item.href} />}
                        isActive={!item.disabled && pathname === item.href}
                        tooltip={item.title}
                        className={cn(
                          "h-8 gap-2 px-2 text-[13px] rounded-md",
                          !item.disabled && pathname === item.href
                            ? "!bg-gray-300 !text-gray-900 font-semibold"
                            : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                          item.disabled && "pointer-events-none opacity-50"
                        )}
                      >
                        <item.icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="flex-1">{item.title}</span>
                        {item.disabled && (
                          <span className="rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
                            준비중
                          </span>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              )}
            </div>
          )
        })}
      </SidebarContent>

      {/* 유저 푸터 */}
      <SidebarFooter className="border-t border-sidebar-border px-2 py-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
                <Avatar size="sm">
                  <AvatarFallback className="bg-primary text-[11px] font-bold text-primary-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-1 flex-col text-left leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="text-[12px] font-semibold text-sidebar-foreground">{user?.name ?? "사용자"}</span>
                  <span className="text-[11px] text-sidebar-foreground/50">{user?.email ?? ""}</span>
                </div>
                <ChevronsUpDown className="h-3.5 w-3.5 opacity-40 group-data-[collapsible=icon]:hidden" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" className="w-52">
                <DropdownMenuItem render={<Link href="/settings" />} className="gap-2 text-sm">
                  <Settings className="h-4 w-4" />설정
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2 text-sm text-destructive"
                  onClick={() => signOut({ callbackUrl: "/login" })}
                >
                  <LogOut className="h-4 w-4" />로그아웃
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
