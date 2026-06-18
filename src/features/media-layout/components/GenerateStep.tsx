"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Download, Play } from "lucide-react"

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false })

const RECORD_TYPES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "K"]

export function GenerateStep() {
  const [recordType, setRecordType] = useState("C")
  const [code, setCode] = useState("")
  const [stats, setStats] = useState<{ lines: number; bytes: number } | null>(null)
  const [loading, setLoading] = useState(false)

  async function generate() {
    setLoading(true)
    try {
      const res = await fetch("/api/tools/media-layout/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record: recordType }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setCode(data.code)
      setStats({ lines: data.lines, bytes: data.bytes })
    } catch (err) {
      alert(`오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`)
    } finally {
      setLoading(false)
    }
  }

  function download() {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${recordType}_record_generated.java`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Java 소스 생성</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Select value={recordType} onValueChange={(v) => { if (v !== null) setRecordType(v) }}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RECORD_TYPES.map((r) => (
                <SelectItem key={r} value={r}>{r}-레코드</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={generate} disabled={loading}>
            <Play className="h-4 w-4 mr-1" />
            {loading ? "생성 중..." : "소스 생성"}
          </Button>
          {code && (
            <Button variant="outline" onClick={download}>
              <Download className="h-4 w-4 mr-1" />
              다운로드
            </Button>
          )}
          {stats && (
            <div className="flex gap-2 ml-2">
              <Badge variant="secondary">{stats.lines}줄</Badge>
              <Badge variant="secondary">{stats.bytes.toLocaleString()} byte</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="rounded-md border overflow-hidden" style={{ height: "60vh" }}>
        <MonacoEditor
          language="java"
          value={code || "// ① 파일 업로드 → ② 비교·검증 후 여기서 Java 소스를 생성하세요."}
          theme="vs"
          options={{
            readOnly: false,
            minimap: { enabled: false },
            fontSize: 12,
            fontFamily: "D2Coding, Consolas, monospace",
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
          }}
          onChange={(v) => setCode(v ?? "")}
        />
      </div>
    </div>
  )
}
