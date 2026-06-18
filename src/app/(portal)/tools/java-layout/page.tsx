import { JavaStep } from "@/features/media-layout/components/JavaStep"

export default function JavaLayoutPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Java소스 업로드</h1>
        <p className="text-muted-foreground mt-1">
          전산매체 생성 Java 소스를 파싱하고 Oracle DB에 저장합니다.
        </p>
      </div>
      <JavaStep />
    </div>
  )
}
