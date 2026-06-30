import type { MediData } from "../types"

export function parseMediData(json: string | null | undefined): MediData | null {
  if (!json || json === "null") return null
  try { return JSON.parse(json) as MediData } catch { return null }
}
