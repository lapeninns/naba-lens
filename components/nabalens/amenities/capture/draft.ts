import { SUBMIT_ANSWERS, type SubmitAnswer } from "@/lib/amenities/contract"

/**
 * One unsent finding per check, kept in localStorage so a failed upload, a
 * dropped connection or a reload never loses it. The idempotency key lives
 * with the draft: "Try again" resends the same draft with the same key, so a
 * finding whose response was lost is replayed, never recorded twice. Editing
 * after an attempt starts a new key (a new intent).
 */

const PREFIX = "nabalens.amenity-draft.v1:"

export type CaptureDraft = {
  idempotencyKey: string
  /** True once a submit was sent with this key and its outcome is unknown or failed. */
  attempted: boolean
  answer: SubmitAnswer | null
  finding: string
  limitations: string
  reason: string
  assetIds: string[]
  wifi: {
    testSpot: string
    testedOn: string
    downloadMbps: string
    uploadMbps: string
  }
  redactionConfirmed: boolean
}

/** A v4 UUID; falls back to getRandomValues where randomUUID is missing (http on a LAN). */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === "function") return c.randomUUID()
  const bytes = new Uint8Array(16)
  c.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`
}

export function emptyDraft(
  newKey: () => string = newIdempotencyKey
): CaptureDraft {
  return {
    idempotencyKey: newKey(),
    attempted: false,
    answer: null,
    finding: "",
    limitations: "",
    reason: "",
    assetIds: [],
    wifi: { testSpot: "", testedOn: "", downloadMbps: "", uploadMbps: "" },
    redactionConfirmed: false,
  }
}

const str = (value: unknown) => (typeof value === "string" ? value : "")

/** The stored draft, or null when there is none or it is unreadable. */
export function loadDraft(checkId: string): CaptureDraft | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + checkId)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    const d = parsed as Record<string, unknown>
    if (typeof d.idempotencyKey !== "string" || !d.idempotencyKey) return null
    const wifi =
      d.wifi && typeof d.wifi === "object"
        ? (d.wifi as Record<string, unknown>)
        : {}
    return {
      idempotencyKey: d.idempotencyKey,
      attempted: d.attempted === true,
      answer: SUBMIT_ANSWERS.includes(d.answer as SubmitAnswer)
        ? (d.answer as SubmitAnswer)
        : null,
      finding: str(d.finding),
      limitations: str(d.limitations),
      reason: str(d.reason),
      assetIds: Array.isArray(d.assetIds)
        ? d.assetIds.filter((id): id is string => typeof id === "string")
        : [],
      wifi: {
        testSpot: str(wifi.testSpot),
        testedOn: str(wifi.testedOn),
        downloadMbps: str(wifi.downloadMbps),
        uploadMbps: str(wifi.uploadMbps),
      },
      redactionConfirmed: d.redactionConfirmed === true,
    }
  } catch {
    return null
  }
}

export function saveDraft(checkId: string, draft: CaptureDraft) {
  try {
    window.localStorage.setItem(PREFIX + checkId, JSON.stringify(draft))
  } catch {
    // Storage unavailable (private mode, quota): the draft stays in memory.
  }
}

export function clearDraft(checkId: string) {
  try {
    window.localStorage.removeItem(PREFIX + checkId)
  } catch {
    // Nothing stored.
  }
}
