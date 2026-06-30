import type { CardData } from "../types"

export function parseCardData(json: string | null | undefined): CardData | null {
  if (!json || json === "null") return null
  try { return JSON.parse(json) as CardData } catch { return null }
}
