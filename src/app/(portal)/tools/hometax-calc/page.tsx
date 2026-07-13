import { HometaxCalcPanel } from "@/features/hometax-calc/components/HometaxCalcPanel"

export default function HometaxCalcPage() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 mb-4">
        <h1 className="text-2xl font-bold tracking-tight">국세청 모의계산 비교</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          홈택스 연말정산 자동계산을 실행해 결정세액을 확인합니다.
        </p>
      </div>
      <div className="flex-1 min-h-0 rounded-lg border overflow-hidden">
        <HometaxCalcPanel />
      </div>
    </div>
  )
}
