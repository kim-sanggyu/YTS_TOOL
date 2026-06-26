import { MigrationPanel } from "@/features/tax-calculate/data-migration/components/MigrationPanel"

export default function DataMigrationPage() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 mb-4">
        <h1 className="text-2xl font-bold tracking-tight">차년도 데이터 생성</h1>
        <p className="text-muted-foreground mt-1">
          Y2025 PAY_WRK 계열 데이터를 X2026으로 복제·변환하여 삽입합니다.
        </p>
      </div>
      <MigrationPanel />
    </div>
  )
}
