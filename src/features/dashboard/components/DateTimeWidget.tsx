"use client"

import { useEffect, useState } from "react"

const DAYS = ["일", "월", "화", "수", "목", "금", "토"]

export function DateTimeWidget() {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!now) return null

  const year  = now.getFullYear()
  const month = now.getMonth() + 1
  const date  = now.getDate()
  const day   = DAYS[now.getDay()]
  const hh    = String(now.getHours()).padStart(2, "0")
  const mm    = String(now.getMinutes()).padStart(2, "0")

  return (
    <span className="text-sm text-muted-foreground tabular-nums">
      {year}년 {month}월 {date}일 ({day}) {hh}:{mm}
    </span>
  )
}
