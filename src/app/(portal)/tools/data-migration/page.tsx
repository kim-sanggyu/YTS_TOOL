import { MigrationPanel } from "@/features/tax-calculate/data-migration/components/MigrationPanel"

export default function DataMigrationPage() {
  const fromYear = new Date().getFullYear() - 1
  const toYear   = new Date().getFullYear()

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 mb-4">
        <h1 className="text-2xl font-bold tracking-tight">차년도 데이터 생성</h1>
        <p className="text-muted-foreground mt-1">
          Y{fromYear} PAY_WRK 계열 데이터를 X{toYear}으로 복제·변환하여 삽입합니다.{" "}
          {toYear}년 개정세법 관련 테스트 데이터는 별도로 생성하세요.
        </p>
      </div>
      <MigrationPanel />
    </div>
  )
}
