// Facility detail (b03-design §4.2; B03 UI design §3.2): where it is, its
// availability and fees, and staff notes. The form's model, the detail the
// server stores, and the server's field paths mapped back onto the fields.
// Nothing is filled in for the person: fees stay "not recorded" and empty
// sections are left out of what is sent.

import type { PlaceRef } from "@/lib/knowledge/contract"

export type FacilityAvailability =
  "available" | "on_request" | "seasonal" | "temporarily_unavailable"
export type FacilityFeeKind = "not_recorded" | "free" | "charged"

export type FacilityDraft = {
  locations: PlaceRef[]
  availability: FacilityAvailability | null
  /** Temporarily unavailable (§5.4): the day it's back, and an internal note. */
  until: string
  availabilityNote: string
  fees: { kind: FacilityFeeKind; amount: string; unit: string }
  limitations: string
  howToRequest: string
}

export type FacilityField =
  "locations" | "availability" | "fees" | "limitations" | "howToRequest"

export const FACILITY_LIMITS = {
  label: 80,
  unit: 40,
  limitations: 2000,
  howToRequest: 500,
  availabilityNote: 500,
  amountMax: 100000,
  locations: 20,
} as const

export const FACILITY_COPY = {
  where: "Where is it?",
  whereHelp: "Optional. Choose each place, or name it.",
  somewhereElse: "Somewhere else",
  nameThePlace: "Name the place",
  addPlace: "Add this place",
  removePlace: (label: string) => `Remove ${label}`,
  noPlaces: (venue: string) =>
    `No places are listed for ${venue} yet. Name the place.`,
  availability: "Availability",
  availabilityHelp: "Optional.",
  availabilityLabel: {
    available: "Available",
    on_request: "On request",
    seasonal: "Seasonal",
    temporarily_unavailable: "Temporarily unavailable",
  } satisfies Record<FacilityAvailability, string>,
  until: "Back on (optional)",
  availabilityNote: "What's happening (internal)",
  untilOrNote: "Add the day it's back, or say what's happening.",
  fees: "Fees",
  feesHelp:
    "Leave as Not recorded unless you know. Don't guess from a sign you couldn't read.",
  feeLabel: {
    not_recorded: "Not recorded",
    free: "Free",
    charged: "Charged",
  } satisfies Record<FacilityFeeKind, string>,
  amount: "Amount (£)",
  amountHelp: "Optional.",
  per: "Per",
  perHelp: "Optional, for example ⟨game⟩ or ⟨hour⟩.",
  limitations: "Limitations",
  limitationsHelp: "Optional. Kept for staff and managers.",
  howToRequest: "How to ask for it",
  howToRequestHelp: "Optional. Kept for staff and managers.",
} as const

export function emptyFacility(): FacilityDraft {
  return {
    locations: [],
    availability: null,
    until: "",
    availabilityNote: "",
    fees: { kind: "not_recorded", amount: "", unit: "" },
    limitations: "",
    howToRequest: "",
  }
}

/** True when the person entered anything. */
export function facilityTouched(draft: FacilityDraft): boolean {
  return (
    draft.locations.length > 0 ||
    draft.availability !== null ||
    draft.until !== "" ||
    draft.availabilityNote.trim() !== "" ||
    draft.fees.kind !== "not_recorded" ||
    draft.limitations.trim() !== "" ||
    draft.howToRequest.trim() !== ""
  )
}

const amountOf = (text: string): number | null => {
  const t = text.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

const chars = (s: string) => Array.from(s).length

/** Errors the form can tell before sending, keyed by field. */
export function facilityErrors(
  draft: FacilityDraft
): Partial<Record<FacilityField, string>> {
  const errors: Partial<Record<FacilityField, string>> = {}
  if (draft.locations.length > FACILITY_LIMITS.locations)
    errors.locations = `Choose up to ${FACILITY_LIMITS.locations} places.`
  if (draft.availability === "temporarily_unavailable") {
    if (!draft.until && !draft.availabilityNote.trim())
      errors.availability = FACILITY_COPY.untilOrNote
    else if (
      chars(draft.availabilityNote.trim()) > FACILITY_LIMITS.availabilityNote
    )
      errors.availability = `Use up to ${FACILITY_LIMITS.availabilityNote} characters.`
  }
  if (draft.fees.kind === "charged") {
    const amount = amountOf(draft.fees.amount)
    if (
      amount !== null &&
      (Number.isNaN(amount) || amount < 0 || amount > FACILITY_LIMITS.amountMax)
    )
      errors.fees = "Enter the amount as a number, or leave it empty."
    else if (chars(draft.fees.unit.trim()) > FACILITY_LIMITS.unit)
      errors.fees = `Use up to ${FACILITY_LIMITS.unit} characters after Per.`
  }
  if (chars(draft.limitations.trim()) > FACILITY_LIMITS.limitations)
    errors.limitations = `Use up to ${FACILITY_LIMITS.limitations} characters.`
  if (chars(draft.howToRequest.trim()) > FACILITY_LIMITS.howToRequest)
    errors.howToRequest = `Use up to ${FACILITY_LIMITS.howToRequest} characters.`
  return errors
}

/** The detail to send: only what the person gave; null when nothing. */
export function facilityDetail(
  draft: FacilityDraft
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  if (draft.locations.length) out.locations = draft.locations
  if (draft.availability) {
    const note = draft.availabilityNote.trim()
    out.availability =
      draft.availability === "temporarily_unavailable"
        ? {
            state: draft.availability,
            ...(draft.until ? { until: draft.until } : {}),
            ...(note ? { note } : {}),
          }
        : { state: draft.availability }
  }
  if (draft.fees.kind !== "not_recorded") {
    const fees: Record<string, unknown> = { kind: draft.fees.kind }
    if (draft.fees.kind === "charged") {
      const amount = amountOf(draft.fees.amount)
      if (amount !== null && !Number.isNaN(amount))
        fees.amount = { value: amount, currency: "GBP" }
      const unit = draft.fees.unit.trim()
      if (unit) fees.unit = unit
    }
    out.fees = fees
  }
  const limitations = draft.limitations.trim()
  if (limitations) out.limitations = limitations
  const how = draft.howToRequest.trim()
  if (how) out.howToRequest = how
  return Object.keys(out).length ? out : null
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** A stored or drafted detail back into the form, defensively. */
export function facilityFromDetail(detail: unknown): FacilityDraft {
  const draft = emptyFacility()
  if (!isRecord(detail)) return draft
  if (Array.isArray(detail.locations))
    draft.locations = detail.locations.filter(
      (ref): ref is PlaceRef =>
        isRecord(ref) &&
        (typeof ref.subjectId === "string" || typeof ref.label === "string")
    )
  const availability = isRecord(detail.availability)
    ? detail.availability
    : null
  const state = availability?.state
  if (
    state === "available" ||
    state === "on_request" ||
    state === "seasonal" ||
    state === "temporarily_unavailable"
  )
    draft.availability = state
  if (typeof availability?.until === "string") draft.until = availability.until
  if (typeof availability?.note === "string")
    draft.availabilityNote = availability.note
  if (isRecord(detail.fees)) {
    const kind = detail.fees.kind
    if (kind === "free" || kind === "charged" || kind === "not_recorded")
      draft.fees.kind = kind
    const amount = isRecord(detail.fees.amount)
      ? detail.fees.amount.value
      : null
    if (typeof amount === "number") draft.fees.amount = String(amount)
    if (typeof detail.fees.unit === "string") draft.fees.unit = detail.fees.unit
  }
  if (typeof detail.limitations === "string")
    draft.limitations = detail.limitations
  if (typeof detail.howToRequest === "string")
    draft.howToRequest = detail.howToRequest
  return draft
}

/**
 * The field a server error path belongs to (b03-design §14.3), for example
 * `detail.fees.amount` → `fees`, `detail.locations[2]` → `locations`.
 */
export function facilityFieldOf(path: string): FacilityField | null {
  const match =
    /^detail\.(locations|availability|fees|limitations|howToRequest)\b/.exec(
      path
    )
  return match ? (match[1] as FacilityField) : null
}

/** Server field errors (keyed by path) onto the form's fields. */
export function facilityFieldErrors(
  fieldErrors: Partial<Record<string, string>> | undefined
): Partial<Record<FacilityField, string>> {
  const out: Partial<Record<FacilityField, string>> = {}
  for (const [path, message] of Object.entries(fieldErrors ?? {})) {
    if (!message) continue
    const field = facilityFieldOf(path)
    if (field && !out[field]) out[field] = message
  }
  return out
}
