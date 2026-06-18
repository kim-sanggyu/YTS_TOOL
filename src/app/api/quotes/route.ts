export const revalidate = 86400 // 24시간 캐시

export async function GET() {
  const res = await fetch("https://zenquotes.io/api/quotes", {
    next: { revalidate: 86400 },
  })
  const data = await res.json()
  // 오늘의 10건: 매일 새 배치에서 첫 10개
  return Response.json(data.slice(0, 10))
}
