import { HwpStep } from "@/features/media-layout/components/HwpStep"

export default function HwpLayoutPage() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 mb-4">
        <h1 className="text-2xl font-bold tracking-tight">HWP 업로드</h1>
        <p className="text-muted-foreground mt-1">
          국세청 전산매체제출요령 HWP를 파싱하고 Oracle DB에 저장합니다.
        </p>
      </div>
      <HwpStep />
    </div>
  )
}
