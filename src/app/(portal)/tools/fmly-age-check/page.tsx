import { FmlyAgeCheckPanel } from "@/features/tax-calculate/fmly-age-check/components/FmlyAgeCheckPanel"

export default function FmlyAgeCheckPage() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 mb-4">
        <h1 className="text-2xl font-bold tracking-tight">공제요건 경계나이 관리</h1>
        <p className="text-muted-foreground mt-1">
          마이그레이션 후 나이 경계(7·20·59·69세)로 감지된 부양가족 보정 대상 목록입니다.
        </p>
      </div>
      <FmlyAgeCheckPanel />
    </div>
  )
}
