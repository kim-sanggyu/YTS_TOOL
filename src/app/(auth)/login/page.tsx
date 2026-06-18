"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError("")
    setLoading(true)
    const form = new FormData(e.currentTarget)
    const result = await signIn("credentials", {
      username: form.get("username"),
      password: form.get("password"),
      redirect: false,
    })
    setLoading(false)
    if (result?.error) {
      setError("아이디 또는 비밀번호가 올바르지 않습니다.")
    } else {
      router.push("/")
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8">
      {/* 브랜딩 */}
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">YTS Tool</h1>
        <p className="mt-1 text-sm text-muted-foreground">연말정산 운영 포털</p>
      </div>

      {/* 로그인 카드 */}
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm space-y-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">로그인</h2>
          <p className="text-sm text-muted-foreground">계정 정보를 입력하세요</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="username">아이디</Label>
            <Input
              id="username"
              name="username"
              type="text"
              placeholder="아이디를 입력하세요"
              required
              autoFocus
              className="h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">비밀번호</Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="비밀번호를 입력하세요"
              required
              className="h-10"
            />
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full h-10" disabled={loading}>
            {loading ? "로그인 중..." : "로그인"}
          </Button>
        </form>
      </div>

      <p className="mt-8 text-xs text-muted-foreground/50">© 2025 연말정산 시스템 운영팀</p>
    </div>
  )
}
