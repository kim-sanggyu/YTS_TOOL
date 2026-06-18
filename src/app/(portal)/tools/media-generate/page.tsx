import { GenerateStep } from "@/features/media-layout/components/GenerateStep"

export default function MediaGeneratePage() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 mb-4">
        <h1 className="text-2xl font-bold tracking-tight">전산매체 Java소스 생성</h1>
        <p className="text-muted-foreground mt-1">
          비교·검증된 레이아웃 기준으로 Java 소스를 생성합니다.
        </p>
      </div>
      <GenerateStep />
    </div>
  )
}
