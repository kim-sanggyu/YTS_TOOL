"use client"

import { useState, useEffect } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { Vocab } from "../lib/vocabulary"

export function VocabWidget() {
  const [words, setWords] = useState<Vocab[]>([])
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    fetch("/api/vocab")
      .then((r) => r.json())
      .then((data: Vocab[]) => setWords(data))
  }, [])

  if (words.length === 0) {
    return (
      <div className="flex flex-col gap-3 w-full">
        <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-widest text-center">
          VOC 22000
        </p>
        <div className="h-[90px] w-full animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }

  const word = words[index]
  const total = words.length

  return (
    <div className="flex flex-col gap-3 w-full">
      <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-widest text-center">
        VOC 22000
      </p>

      <div className="flex items-center gap-2 w-full">
        <button
          onClick={() => { setIndex((i) => (i - 1 + total) % total); setRevealed(false) }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/50 hover:bg-accent hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <button
          onClick={() => setRevealed((r) => !r)}
          className="flex-1 min-h-[90px] cursor-pointer rounded-xl border border-border bg-card px-4 py-3 text-center transition-colors hover:bg-accent"
        >
          {!revealed ? (
            <div>
              <p className="text-2xl font-bold text-foreground tracking-wide">{word.word}</p>
              <p className="mt-1 text-[10px] text-muted-foreground/40">클릭하면 뜻이 나타납니다</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              <p className="text-base font-semibold text-foreground">
                {word.word}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground/60">{word.pos}</span>
              </p>
              <p className="text-sm text-muted-foreground">{word.meaning}</p>
            </div>
          )}
        </button>

        <button
          onClick={() => { setIndex((i) => (i + 1) % total); setRevealed(false) }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/50 hover:bg-accent hover:text-foreground transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <p className="text-[10px] text-muted-foreground/30 text-center">
        오늘의 단어 {index + 1} / {total}
      </p>
    </div>
  )
}
