// 포털 도구 메뉴 정의
export interface ToolMenu {
  id: string
  name: string
  description: string
  href: string
  icon: string
  status: "active" | "coming"
  category: string
}
