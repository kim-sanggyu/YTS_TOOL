import { auth } from "@/auth"
import Link from "next/link"
import { FileText, FileSearch, FileCode, Database, Calculator, GitCompare, FileOutput, Code2 } from "lucide-react"
import { QuoteWidget } from "@/features/dashboard/components/QuoteWidget"
import { DateTimeWidget } from "@/features/dashboard/components/DateTimeWidget"

const tools = [
  { id: "hwp-layout",   name: ".hwp파일 업로드",      href: "/tools/hwp-layout",    icon: FileSearch, status: "active" as const },
  { id: "java-layout",  name: ".java소스 업로드",     href: "/tools/java-layout",   icon: FileCode,   status: "active" as const },
  { id: "media-layout",   name: "전산매체 비교·검증",  href: "/tools/media-layout",   icon: GitCompare, status: "active" as const },
  { id: "media-generate", name: "전산매체 소스 생성",  href: "/tools/media-generate", icon: Code2,      status: "active" as const },
  { id: "data-verify",  name: "데이터 검증",          href: "/tools/data-verify",   icon: Database,   status: "coming" as const },
  { id: "tax-calc",     name: "공제 계산기",          href: "/tools/tax-calc",      icon: Calculator, status: "coming" as const },
  { id: "diff-checker", name: "전년도 비교",          href: "/tools/diff-checker",  icon: GitCompare, status: "coming" as const },
  { id: "report-gen",   name: "리포트 생성",          href: "/tools/report-gen",    icon: FileOutput, status: "coming" as const },
]

// WMO 날씨 코드 → 아이콘 + 설명
function parseWeatherCode(code: number): { icon: string; label: string } {
  if (code === 0)            return { icon: "☀️",  label: "맑음" }
  if (code <= 2)             return { icon: "🌤️", label: "구름 조금" }
  if (code <= 3)             return { icon: "☁️",  label: "흐림" }
  if (code <= 48)            return { icon: "🌫️", label: "안개" }
  if (code <= 55)            return { icon: "🌦️", label: "이슬비" }
  if (code <= 65)            return { icon: "🌧️", label: "비" }
  if (code <= 77)            return { icon: "🌨️", label: "눈" }
  if (code <= 82)            return { icon: "🌦️", label: "소나기" }
  return                            { icon: "⛈️",  label: "뇌우" }
}


async function fetchWeather(): Promise<{ temp: number; icon: string; label: string } | null> {
  try {
    const res = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=temperature_2m,weather_code&timezone=Asia%2FSeoul",
      { next: { revalidate: 1800 } }
    )
    if (!res.ok) throw new Error("failed")
    const data = await res.json()
    const temp = Math.round(data.current.temperature_2m)
    const { icon, label } = parseWeatherCode(data.current.weather_code)
    return { temp, icon, label }
  } catch {
    return null
  }
}

export default async function DashboardPage() {
  const [session, weather] = await Promise.all([auth(), fetchWeather()])
  const name = session?.user?.name ?? "사용자"

  return (
    <div className="flex min-h-[calc(100vh-2.5rem)] -m-5 flex-col items-center justify-center gap-8">
      <div className="flex flex-col items-center gap-4">
        {/* 인사 */}
        <h1 className="text-[1.75rem] font-bold tracking-tight text-foreground">
          {name}님, 안녕하세요
        </h1>

        {/* 날짜·시간 + 날씨 */}
        <div className="flex flex-col items-center gap-1">
          <DateTimeWidget />
          {weather && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span>{weather.icon}</span>
              <span className="font-medium text-foreground">{weather.temp}°C</span>
              <span>·</span>
              <span>{weather.label}</span>
              <span>·</span>
              <span>서울</span>
            </div>
          )}
        </div>

        <QuoteWidget />
      </div>

      {/* 도구 칩 */}
      <div className="flex flex-wrap justify-center gap-2 px-4 max-w-xl">
        {tools.map((tool) => {
          const Icon = tool.icon
          const isActive = tool.status === "active"

          const chip = (
            <div
              className={[
                "flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors",
                isActive
                  ? "border-border bg-card text-foreground hover:bg-accent cursor-pointer"
                  : "border-border/50 bg-muted/40 text-muted-foreground cursor-not-allowed",
              ].join(" ")}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {tool.name}
            </div>
          )

          return isActive
            ? <Link key={tool.id} href={tool.href}>{chip}</Link>
            : <span key={tool.id}>{chip}</span>
        })}
      </div>
    </div>
  )
}
