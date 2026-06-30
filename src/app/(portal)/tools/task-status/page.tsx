import { auth } from "@/auth"
import { TaskStatusPanel } from "@/features/task-status/components/TaskStatusPanel"

export default async function TaskStatusPage() {
  const session = await auth()
  const userName = session?.user?.name ?? session?.user?.email ?? null

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 mb-4">
        <h1 className="text-2xl font-bold tracking-tight">과제현황</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          과제구분별로 과제를 관리하고 진척현황을 기록합니다.
        </p>
      </div>
      <div className="flex-1 min-h-0 rounded-lg border overflow-hidden">
        <TaskStatusPanel userName={userName} />
      </div>
    </div>
  )
}
