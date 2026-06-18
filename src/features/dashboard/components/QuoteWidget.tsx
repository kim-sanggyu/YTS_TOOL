"use client"

import { useState, useEffect } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { Saja } from "../lib/sajaseongeo"

type Mode = "quote" | "saja"
interface Quote { q: string; a: string }

const STORAGE_KEY = "dashboard_content_mode"

const TABS: { key: Mode; label: string }[] = [
  { key: "quote", label: "영어 명언" },
  { key: "saja",  label: "사자성어" },
]

export function QuoteWidget() {
  const [mode, setMode]           = useState<Mode>("quote")
  const [quotes, setQuotes]       = useState<Quote[]>([])
  const [sajaItems, setSajaItems] = useState<Saja[]>([])
  const [quoteIdx, setQuoteIdx]   = useState(0)
  const [sajaIdx, setSajaIdx]     = useState(0)
  const [flipped, setFlipped]     = useState(false)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Mode | null
    if (saved && TABS.some(t => t.key === saved)) setMode(saved)
  }, [])

  function switchMode(m: Mode) {
    setMode(m)
    setFlipped(false)
    localStorage.setItem(STORAGE_KEY, m)
  }

  useEffect(() => {
    if (mode !== "quote" || quotes.length > 0) return
    setLoading(true)
    fetch("/api/quotes")
      .then(r => r.json())
      .then((d: Quote[]) => { setQuotes(d); setLoading(false) })
      .catch(() => {
        setQuotes([{ q: "Do what you can, with what you have, where you are.", a: "Theodore Roosevelt" }])
        setLoading(false)
      })
  }, [mode, quotes.length])

  useEffect(() => {
    if (mode !== "saja" || sajaItems.length > 0) return
    setLoading(true)
    fetch("/api/saja")
      .then(r => r.json())
      .then((d: Saja[]) => { setSajaItems(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [mode, sajaItems.length])

  const tabs = (
    <div className="flex items-center gap-1 rounded-full border border-border bg-muted/50 p-0.5 text-xs">
      {TABS.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => switchMode(key)}
          className={[
            "rounded-full px-3 py-1 transition-colors",
            mode === key
              ? "bg-background text-foreground shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          {label}
        </button>
      ))}
    </div>
  )

  const isReady = mode === "quote" ? quotes.length > 0 : sajaItems.length > 0

  if (loading || !isReady) {
    return (
      <div className="flex flex-col items-center gap-3">
        {tabs}
        <div className="h-[90px] w-full max-w-sm animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }

  if (mode === "quote") {
    const total = quotes.length
    const q = quotes[quoteIdx]
    return (
      <div className="flex flex-col items-center gap-3">
        {tabs}
        <div className="flex items-center gap-2 w-full max-w-sm">
          <NavBtn onClick={() => setQuoteIdx(i => (i - 1 + total) % total)} />
          <div className="flex-1 rounded-xl border border-border bg-card px-4 py-3 text-center min-h-[90px] flex flex-col justify-center">
            <p className="text-sm text-muted-foreground italic">"{q.q}"</p>
            <p className="mt-0.5 text-xs text-muted-foreground/60">— {q.a}</p>
          </div>
          <NavBtn right onClick={() => setQuoteIdx(i => (i + 1) % total)} />
        </div>
        <Counter label="명언" idx={quoteIdx} total={total} />
      </div>
    )
  }

  const total = sajaItems.length
  const saja = sajaItems[sajaIdx]
  return (
    <div className="flex flex-col items-center gap-3">
      {tabs}
      <div className="flex items-center gap-2 w-full max-w-sm">
        <NavBtn onClick={() => { setSajaIdx(i => (i - 1 + total) % total); setFlipped(false) }} />
        <button
          onClick={() => setFlipped(f => !f)}
          className="flex-1 min-h-[90px] cursor-pointer rounded-xl border border-border bg-card px-4 py-3 text-center transition-colors hover:bg-accent"
        >
          {!flipped ? (
            <>
              <p className="text-4xl tracking-widest text-foreground"
                 style={{ fontFamily: "'궁서', 'GungsuhChe', 'Gungsuh', serif" }}>
                {saja.hanja}
              </p>
              <p className="mt-1.5 text-[10px] text-muted-foreground/40">클릭하면 풀이가 나타납니다</p>
            </>
          ) : (
            <div className="space-y-0.5">
              <p className="text-base font-semibold text-foreground">
                {saja.sound} <span className="text-sm font-normal text-muted-foreground">({saja.hanja})</span>
              </p>
              <p className="text-sm text-muted-foreground">{saja.meaning}</p>
              <p className="text-xs text-muted-foreground/60">{saja.origin}</p>
            </div>
          )}
        </button>
        <NavBtn right onClick={() => { setSajaIdx(i => (i + 1) % total); setFlipped(false) }} />
      </div>
      <Counter label="사자성어" idx={sajaIdx} total={total} />
    </div>
  )
}

function NavBtn({ onClick, right }: { onClick: () => void; right?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/50 hover:bg-accent hover:text-foreground transition-colors"
    >
      {right
        ? <ChevronRight className="h-4 w-4" />
        : <ChevronLeft  className="h-4 w-4" />}
    </button>
  )
}

function Counter({ label, idx, total }: { label: string; idx: number; total: number }) {
  return (
    <p className="text-[10px] text-muted-foreground/30">
      오늘의 {label} {idx + 1} / {total}
    </p>
  )
}
