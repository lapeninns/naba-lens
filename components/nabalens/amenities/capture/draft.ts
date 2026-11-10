import {
  KNOWLEDGE_ANSWERS,
  UNKNOWN_PRESETS,
  type KnowledgeAnswer,
  type UnknownPreset,
} from "@/lib/knowledge-client/contract"

import {
  accessFromDraft,
  type AccessDraft,
} from "../../knowledge/accessibility-detail"
import type { CheckedOn } from "../../knowledge/checked-on"
import {
  policyFromDraft,
  type PolicyDraft,
} from "../../knowledge/policy-detail"
import {
  emptyFacility,
  type FacilityDraft,
} from "../../knowledge/facility-detail"

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
  /** `unknown` (Couldn't establish) only on a knowledge question. */
  answer: KnowledgeAnswer | null
  finding: string
  limitations: string
  reason: string
  /** Couldn't establish: why, and what was tried. */
  unknownPreset: UnknownPreset | null
  triedText: string
  /** A change report: what changed. */
  changeReason: string
  /** A manager on a confirmation-required question; null until chosen. */
  confirmOwn: boolean | null
  /**
   * The slot revision an attempted knowledge send went with. A retry or a
   * replay from another device resends it, so the request is the same.
   */
  sentSlotRevision: number | null
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
  /**
   * Uploads picked here that weren't ready yet, and the newest upload listed
   * when they were picked: coming back, a newer unticked upload is one that
   * finished after the person left (CA-10). This device only.
   */
  uploadsPending?: { count: number; after: string | null } | null
  /**
   * B03 detail forms only: the facility, accessibility and policy details as
   * typed, and Checked on (the form's date is stamped at the first edit, so a
   * later reopen can tell it from a chosen one). Absent on every other form.
   */
  facility?: FacilityDraft | null
  access?: AccessDraft | null
  policy?: PolicyDraft | null
  checkedOn?: CheckedOn | null
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
    unknownPreset: null,
    triedText: "",
    changeReason: "",
    confirmOwn: null,
    sentSlotRevision: null,
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

function uploadsPending(value: unknown): Pick<CaptureDraft, "uploadsPending"> {
  if (!value || typeof value !== "object") return {}
  const v = value as Record<string, unknown>
  if (typeof v.count !== "number" || !Number.isInteger(v.count) || v.count < 1)
    return {}
  return {
    uploadsPending: {
      count: v.count,
      after: typeof v.after === "string" ? v.after : null,
    },
  }
}

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
      answer: KNOWLEDGE_ANSWERS.includes(d.answer as KnowledgeAnswer)
        ? (d.answer as KnowledgeAnswer)
        : null,
      finding: str(d.finding),
      limitations: str(d.limitations),
      reason: str(d.reason),
      unknownPreset: UNKNOWN_PRESETS.includes(d.unknownPreset as UnknownPreset)
        ? (d.unknownPreset as UnknownPreset)
        : null,
      triedText: str(d.triedText),
      changeReason: str(d.changeReason),
      confirmOwn: typeof d.confirmOwn === "boolean" ? d.confirmOwn : null,
      sentSlotRevision:
        typeof d.sentSlotRevision === "number" &&
        Number.isInteger(d.sentSlotRevision)
          ? d.sentSlotRevision
          : null,
      assetIds: strings(d.assetIds),
      wifi: {
        testSpot: str(wifi.testSpot),
        testedOn: str(wifi.testedOn),
        downloadMbps: str(wifi.downloadMbps),
        uploadMbps: str(wifi.uploadMbps),
      },
      redactionConfirmed: d.redactionConfirmed === true,
      redactionAssetIds: strings(d.redactionAssetIds),
      ...uploadsPending(d.uploadsPending),
      ...(d.facility && typeof d.facility === "object"
        ? { facility: facilityFromDraft(d.facility) }
        : {}),
      ...(d.access && typeof d.access === "object"
        ? { access: accessFromDraft(d.access) }
        : {}),
      ...(d.policy && typeof d.policy === "object"
        ? { policy: policyFromDraft(d.policy) }
        : {}),
      ...checkedOnOf(d.checkedOn),
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

/** A stored facility draft, field by field (the form's model, not the detail). */
function facilityFromDraft(v: unknown): FacilityDraft {
  const d = v as Record<string, unknown>
  const base = emptyFacility()
  const fees =
    d.fees && typeof d.fees === "object"
      ? (d.fees as Record<string, unknown>)
      : {}
  const kind = fees.kind
  return {
    locations: Array.isArray(d.locations)
      ? (d.locations.filter(
          (ref) =>
            ref &&
            typeof ref === "object" &&
            (typeof (ref as Record<string, unknown>).subjectId === "string" ||
              typeof (ref as Record<string, unknown>).label === "string")
        ) as FacilityDraft["locations"])
      : base.locations,
    availability:
      d.availability === "available" ||
      d.availability === "on_request" ||
      d.availability === "seasonal"
        ? d.availability
        : null,
    fees: {
      kind:
        kind === "free" || kind === "charged" || kind === "not_recorded"
          ? kind
          : "not_recorded",
      amount: typeof fees.amount === "string" ? fees.amount : "",
      unit: typeof fees.unit === "string" ? fees.unit : "",
    },
    limitations: str(d.limitations),
    howToRequest: str(d.howToRequest),
  }
}

function checkedOnOf(v: unknown): { checkedOn?: CheckedOn } {
  if (!v || typeof v !== "object") return {}
  const c = v as Record<string, unknown>
  const date =
    typeof c.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.date)
      ? c.date
      : null
  const source =
    c.source === "form_default" || c.source === "chosen" ? c.source : null
  return { checkedOn: { date, source } }
}
