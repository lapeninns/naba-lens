// Input checks for coverage services. They give friendly field errors early;
// the database repeats every rule (and the limits match it exactly).

export const LIMITS = {
  titleMax: 120,
  guidanceMax: 2000,
  factsMax: 2000,
  reasonMax: 500,
  photoTargetMax: 200,
  targetCountMax: 500,
  batchMax: 10,
  assigneesMax: 50,
  factAssetsMax: 20,
  reconcileItemsMax: 200,
  pageSize: 24,
} as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REQUEST_KEY = /^[A-Za-z0-9_-]{8,128}$/

export const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)

export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID.test(v)

export const isRequestKey = (v: unknown): v is string =>
  typeof v === "string" && REQUEST_KEY.test(v)

/** null/undefined/"" → null; a uuid → itself; anything else → undefined (invalid). */
export function optionalUuid(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === "") return null
  return isUuid(v) ? v : undefined
}

export function intInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max
}

/**
 * Trimmed optional text: null when blank or absent, undefined when not a
 * string or longer than `max`.
 */
export function optionalText(
  v: unknown,
  max: number
): string | null | undefined {
  if (v === null || v === undefined) return null
  if (typeof v !== "string") return undefined
  const text = v.trim()
  if (!text) return null
  return text.length > max ? undefined : text
}

/** Distinct UUIDs, `min..max` of them, or null when invalid. */
export function uuidList(
  v: unknown,
  min: number,
  max: number
): string[] | null {
  if (!Array.isArray(v) || v.length < min || v.length > max) return null
  if (!v.every(isUuid)) return null
  const distinct = new Set(v.map((id) => id.toLowerCase()))
  return distinct.size === v.length ? (v as string[]) : null
}
