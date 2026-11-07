import { SUBMIT_ANSWERS, type SubmitAnswer } from "@/lib/amenities/contract"

/**
 * One unsent finding per person and check, kept in localStorage so a failed
 * upload, a dropped connection or a reload never loses it. The idempotency key
 * lives with the draft: "Try again" resends the same draft with the same key,
 * so a finding whose response was lost is replayed, never recorded twice.
 * Editing after an attempt starts a new key (a new intent). An unsent draft
 * for a check that changed since it was written starts a new key too; an
 * attempted one keeps its key (see `reconcileDraft`).
 * Sign-out removes every draft on the device (`clearAllDrafts`).
 */

/** Every draft key, of any version, starts with this. */
const NAMESPACE = "nabalens.amenity-draft."
const PREFIX = `${NAMESPACE}v2:`

/** Whose draft, for which check. */
export type DraftOwner = { userId: string; checkId: string }

const storageKey = ({ userId, checkId }: DraftOwner) =>
  `${PREFIX}${userId}:${checkId}`

export type CaptureDraft = {
  idempotencyKey: string
  /** True once a submit was sent with this key and its outcome is unknown or failed. */
  attempted: boolean
  /** The check revision this draft (and its key) belongs to; null if unknown. */
  revision: number | null
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
  /**
   * The evidence the redaction tick was given for. The tick only counts while
   * the chosen evidence is exactly this set (see `redactionHolds`).
   */
  redactionAssetIds: string[]
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
  newKey: () => string = newIdempotencyKey,
  revision: number | null = null
): CaptureDraft {
  return {
    idempotencyKey: newKey(),
    attempted: false,
    revision,
    answer: null,
    finding: "",
    limitations: "",
    reason: "",
    assetIds: [],
    wifi: { testSpot: "", testedOn: "", downloadMbps: "", uploadMbps: "" },
    redactionConfirmed: false,
    redactionAssetIds: [],
  }
}

/** True when the redaction tick was given for exactly these assets. */
export function redactionHolds(draft: CaptureDraft, assetIds: string[]) {
  if (!draft.redactionConfirmed) return false
  const ticked = new Set(draft.redactionAssetIds)
  return (
    ticked.size === assetIds.length && assetIds.every((id) => ticked.has(id))
  )
}

/**
 * A draft written for another revision of the check keeps its words and
 * evidence; the redaction tick is asked for again.
 *
 * An attempted draft keeps its key: its send may have been recorded (and
 * moved the revision) with the answer lost, so the next send must replay it,
 * never record it twice. The form tells a stale replay apart (the check
 * changed since) by the revision the replay returns.
 *
 * A draft never sent is a new intent with a new key.
 */
export function reconcileDraft(
  draft: CaptureDraft,
  revision: number,
  newKey: () => string = newIdempotencyKey
): CaptureDraft {
  if (draft.revision === revision) return draft
  return {
    ...draft,
    revision,
    idempotencyKey: draft.attempted ? draft.idempotencyKey : newKey(),
    redactionConfirmed: false,
    redactionAssetIds: [],
  }
}

const str = (value: unknown) => (typeof value === "string" ? value : "")

/** The stored draft, or null when there is none or it is unreadable. */
export function loadDraft(owner: DraftOwner): CaptureDraft | null {
  try {
    const raw = window.localStorage.getItem(storageKey(owner))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    const d = parsed as Record<string, unknown>
    if (typeof d.idempotencyKey !== "string" || !d.idempotencyKey) return null
    const strings = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((id): id is string => typeof id === "string")
        : []
    const wifi =
      d.wifi && typeof d.wifi === "object"
        ? (d.wifi as Record<string, unknown>)
        : {}
    return {
      idempotencyKey: d.idempotencyKey,
      attempted: d.attempted === true,
      revision:
        typeof d.revision === "number" && Number.isInteger(d.revision)
          ? d.revision
          : null,
      answer: SUBMIT_ANSWERS.includes(d.answer as SubmitAnswer)
        ? (d.answer as SubmitAnswer)
        : null,
      finding: str(d.finding),
      limitations: str(d.limitations),
      reason: str(d.reason),
      assetIds: strings(d.assetIds),
      wifi: {
        testSpot: str(wifi.testSpot),
        testedOn: str(wifi.testedOn),
        downloadMbps: str(wifi.downloadMbps),
        uploadMbps: str(wifi.uploadMbps),
      },
      redactionConfirmed: d.redactionConfirmed === true,
      redactionAssetIds: strings(d.redactionAssetIds),
    }
  } catch {
    return null
  }
}

export function saveDraft(owner: DraftOwner, draft: CaptureDraft) {
  try {
    window.localStorage.setItem(storageKey(owner), JSON.stringify(draft))
  } catch {
    // Storage unavailable (private mode, quota): the draft stays in memory.
  }
}

export function clearDraft(owner: DraftOwner) {
  try {
    window.localStorage.removeItem(storageKey(owner))
  } catch {
    // Nothing stored.
  }
}

/** Removes every amenity draft on this device, any person, any version. */
export function clearAllDrafts() {
  try {
    const storage = window.localStorage
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(NAMESPACE)) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
  } catch {
    // Storage unavailable: nothing stored.
  }
}
