import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CompareStep } from "@/features/media-layout/components/CompareStep"
import { GenerateStep } from "@/features/media-layout/components/GenerateStep"

export default function MediaLayoutPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">전산매체 Java소스 생성</h1>
        <p className="text-muted-foreground mt-1">
          저장된 전산매체 레이아웃과 Java 소스를 비교·검증하고 새 Java 소스를 생성합니다.
        </p>
      </div>

      <Tabs defaultValue="compare" className="space-y-4">
        <TabsList>
          <TabsTrigger value="compare">① 비교·검증</TabsTrigger>
          <TabsTrigger value="generate">② Java 소스 생성</TabsTrigger>
        </TabsList>

        <TabsContent value="compare">
          <CompareStep />
        </TabsContent>
        <TabsContent value="generate">
          <GenerateStep />
        </TabsContent>
      </Tabs>
    </div>
  )
}
