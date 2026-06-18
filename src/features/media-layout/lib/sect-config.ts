export type SectMode = "body" | "hbf"

export interface SectConfig {
  bodyStart: number   // 1-indexed, BODY 첫 행 (1회 단위)
  bodyEnd: number     // 1-indexed, BODY 마지막 행 (1회 단위)
  repeatCount: number // 반복 횟수
}

export const DEFAULT_SECT_CONFIG: SectConfig = { bodyStart: 1, bodyEnd: 1, repeatCount: 1 }

export function loadSectConfig(record: string): { mode: SectMode; config: SectConfig } {
  if (typeof window === "undefined") return { mode: "body", config: DEFAULT_SECT_CONFIG }
  const saved = localStorage.getItem(`yts-sect-${record}`)
  if (saved) {
    try { return JSON.parse(saved) } catch { /* ignore */ }
  }
  return { mode: "body", config: DEFAULT_SECT_CONFIG }
}

export function saveSectConfig(record: string, mode: SectMode, config: SectConfig) {
  localStorage.setItem(`yts-sect-${record}`, JSON.stringify({ mode, config }))
}
