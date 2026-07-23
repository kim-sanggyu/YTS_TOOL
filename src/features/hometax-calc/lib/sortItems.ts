// 목록 정렬 comparator — 클라(useSortedList)·서버(streamCompareBatch) 공유 단일 원천.
// 전체실행 처리 순서를 화면에 보이는 정렬 순서와 일치시키기 위해, 화면 정렬과 배치 정렬이 같은 로직을 써야 한다.
// 숫자·문자 자동 판별, null 은 뒤로. (useSortedList 와 동일 로직 — 여기가 원천)
export type SortDir = "asc" | "desc"
export interface SortState { key: string; dir: SortDir }

export function sortItems<T>(items: T[], sort: SortState | null | undefined): T[] {
  if (!sort) return items
  return [...items].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sort.key] as string | number | null | undefined
    const bv = (b as Record<string, unknown>)[sort.key] as string | number | null | undefined
    const mul = sort.dir === "asc" ? 1 : -1
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return (typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv))) * mul
  })
}
