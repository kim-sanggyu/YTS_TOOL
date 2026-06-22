import { MediaStep } from "@/features/media-layout/components/MediaStep"

export default function MediaLayoutPage() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 mb-4">
        <h1 className="text-2xl font-bold tracking-tight">전산매체 비교·편집</h1>
        <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span>HWP 레이아웃과 Java 소스를 비교·편집합니다.</span>
          <span className="flex items-center gap-1.5 text-xs ml-1">
            <span className="text-muted-foreground/50">※ 비교:</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-orange-200 border border-orange-400" />서식항목 불일치</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-gray-300 border border-gray-400" />데이터타입·누적 불일치</span>
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground/50">편집:</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-red-200 border border-red-400" />D 행삭제</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-yellow-200 border border-yellow-400" />I 행추가</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-blue-200 border border-blue-400" />M 자동표시(셀 직접수정)</span>
          </span>
        </p>
      </div>
      <MediaStep />
    </div>
  )
}
