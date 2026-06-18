import { MediaStep } from "@/features/media-layout/components/MediaStep"

export default function MediaLayoutPage() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 mb-4">
        <h1 className="text-2xl font-bold tracking-tight">전산매체 비교·검증</h1>
        <p className="text-muted-foreground mt-1">
          HWP 레이아웃과 Java 소스를 비교·검증합니다.
        </p>
      </div>
      <MediaStep />
    </div>
  )
}
