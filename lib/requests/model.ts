// Requests and shot lists (spec §7 M4, §2 "Task"; FA-5; S2-REQ). Pure and
// client-safe: the shapes public.media_requests, media_request_detail and
// my_media_requests return (20261118114000_media_requests.sql), their
// parsers, and the words each screen shows.
//
// A request points at a slot (dish, area or amenity), at a fact, or at a New
// brief with no slot. It is never a second copy of the requirement: the slot
// keeps its own coverage state, and a request's state follows it.
// Managers see the spec's words (Open, Submitted, Completed, Blocked,
// Cancelled, Due, Overdue). Staff see slots with the brief and, for a dated
// one, "Needed by": no due date and no Overdue (DESIGN.md §7, §9; FA-5).

import { BRIEF_MAX } from "@/lib/album/model"

export const REQUEST_TYPES = [
  "missing_photo",
  "replacement",
  "optional_angle",
  "fact_confirmation",
  "campaign",
] as const
export type RequestType = (typeof REQUEST_TYPES)[number]

export const REQUEST_STATES = [
  "open",
  "submitted",
  "completed",
  "blocked",
  "cancelled",
] as const
export type RequestState = (typeof REQUEST_STATES)[number]

export const INTENDED_USES = [
  "public",
  "social",
  "reference",
  "internal",
] as const
export type IntendedUse = (typeof INTENDED_USES)[number]

export const PRIORITIES = ["high", "normal", "low"] as const
export type Priority = (typeof PRIORITIES)[number]

export const TEAMS = ["boh", "foh", "any"] as const
export type Team = (typeof TEAMS)[number]

export const ORIENTATIONS = ["portrait", "landscape", "square"] as const
export type Orientation = (typeof ORIENTATIONS)[number]

export const SHOT_LIST_PURPOSES = [
  "menu_launch",
  "quiet_period",
  "campaign",
] as const
export type ShotListPurpose = (typeof SHOT_LIST_PURPOSES)[number]

export type RequestSlotKind = "dish" | "area" | "amenity"

/** Limits the database holds too. */
export const SUBJECT_MAX = 120
export const REQUEST_BRIEF_MAX = BRIEF_MAX
export const CAPTURE_WINDOW_MAX = 80
export const REASON_MAX = 500
export const SHOT_LIST_NAME_MAX = 80
export const SHOT_LIST_NOTE_MAX = 280
export const PHOTO_COUNT_MAX = 20

export const REQUEST_WORDS = {
  type: {
    missing_photo: "Missing photo",
    replacement: "Replacement",
    optional_angle: "Optional angle",
    fact_confirmation: "Fact confirmation",
    campaign: "Campaign",
  } satisfies Record<RequestType, string>,
  typeHint: {
    missing_photo: "A required slot with no photo yet, or a new subject.",
    replacement: "The slot has a photo that no longer fits.",
    optional_angle: "Another angle of a slot. Not counted in coverage.",
    fact_confirmation:
      "A manager or admin checks an answer. Staff findings help but do not finish it.",
    campaign: "Photos for a campaign or event. Not counted in coverage.",
  } satisfies Record<RequestType, string>,
  use: {
    public: "Public website and listings",
    social: "Social media",
    reference: "Reference only",
    internal: "Internal use",
  } satisfies Record<IntendedUse, string>,
  priority: {
    high: "High",
    normal: "Normal",
    low: "Low",
  } satisfies Record<Priority, string>,
  team: {
    boh: "Kitchen",
    foh: "Front of house",
    any: "Anyone",
  } satisfies Record<Team, string>,
  orientation: {
    portrait: "Portrait",
    landscape: "Landscape",
    square: "Square",
  } satisfies Record<Orientation, string>,
  purpose: {
    menu_launch: "Menu launch",
    quiet_period: "Quiet service period",
    campaign: "Campaign",
  } satisfies Record<ShotListPurpose, string>,
  required: "Required",
  optional: "Optional, outside coverage",
  retake: "Another photo was asked for",
  noLongerNeeded: "Closed by the slot",
}

// ---- shapes ----------------------------------------------------------------

export type RequestSlot = {
  kind: RequestSlotKind
  slotId: string
  name: string | null
  category: string | null
  state: string | null
  unavailable: boolean
}

export type RequestView = {
  id: string
  type: RequestType
  required: boolean
  slot: RequestSlot | null
  fact: {
    checkId: string
    key: string | null
    verification: string | null
  } | null
  subject: string
  brief: string
  intendedUse: IntendedUse
  team: Team
  photoCount: number
  priority: Priority
  assignee: { id: string; name: string } | null
  /** YYYY-MM-DD. */
  date: string | null
  /** FA-5: a slot request's date is "needed by", never overdue. */
  dateKind: "needed_by" | "due" | null
  overdue: boolean
  referenceAssetId: string | null
  orientation: Orientation | null
  wantsVideo: boolean
  captureWindow: string | null
  shotListId: string | null
  state: RequestState
  blockedReason: string | null
  /** The slot is waiting for another photo (a retake reopens the request). */
  retake: boolean
  closedReason: string | null
  closedAt: string | null
  /** Closed by the slot's or fact's own rule rather than by a person. */
  closedByRule: boolean
  revision: number
  createdAt: string
  createdBy: string | null
}

export type ShotListView = {
  id: string
  name: string
  purpose: ShotListPurpose
  note: string | null
  date: string | null
  state: "open" | "completed" | "cancelled"
  overdue: boolean
  total: number
  completed: number
  cancelReason: string | null
  revision: number
}

export type RequestPerson = {
  id: string
  name: string
  role: "staff" | "manager"
  team: "foh" | "boh" | null
}

export type RequestList = {
  venueId: string
  today: string
  items: RequestView[]
  shotLists: ShotListView[]
  people: RequestPerson[]
}

export type RequestHistoryEntry = {
  kind: string
  reason: string | null
  actor: string | null
  at: string
  byRule: boolean
}

export type RequestDetail = RequestView & { history: RequestHistoryEntry[] }

export type StaffRequest = {
  id: string
  type: Exclude<RequestType, "fact_confirmation">
  slot: {
    kind: RequestSlotKind
    slotId: string
    name: string | null
    state: string | null
  } | null
  subject: string
  brief: string
  photoCount: number
  neededBy: string | null
  orientation: Orientation | null
  wantsVideo: boolean
  captureWindow: string | null
  referenceAssetId: string | null
  forMe: boolean
  state: "open" | "submitted"
}

export type StaffRequestList = {
  venueId: string
  today: string
  items: StaffRequest[]
}

// ---- parsing ---------------------------------------------------------------

type Raw = Record<string, unknown>

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null
const bool = (v: unknown) => v === true
const num = (v: unknown, fallback = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === "string" && (list as readonly string[]).includes(v)
    ? (v as T)
    : null
const obj = (v: unknown): Raw | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null
const arr = (v: unknown): Raw[] =>
  Array.isArray(v) ? (v.filter((x) => obj(x)) as Raw[]) : []

const SLOT_KINDS = ["dish", "area", "amenity"] as const

function parseSlot(raw: unknown): RequestSlot | null {
  const s = obj(raw)
  const kind = oneOf(SLOT_KINDS, s?.kind)
  const slotId = str(s?.slotId)
  if (!s || !kind || !slotId) return null
  return {
    kind,
    slotId,
    name: str(s.name),
    category: str(s.category),
    state: str(s.state),
    unavailable: bool(s.unavailable),
  }
}

export function parseRequest(raw: unknown): RequestView | null {
  const r = obj(raw)
  if (!r) return null
  const id = str(r.id)
  const type = oneOf(REQUEST_TYPES, r.type)
  const state = oneOf(REQUEST_STATES, r.state)
  const subject = str(r.subject)
  const brief = str(r.brief)
  if (!id || !type || !state || !subject || !brief) return null
  const fact = obj(r.fact)
  const assignee = obj(r.assignee)
  return {
    id,
    type,
    required: bool(r.required),
    slot: parseSlot(r.slot),
    fact:
      fact && str(fact.checkId)
        ? {
            checkId: str(fact.checkId)!,
            key: str(fact.key),
            verification: str(fact.verification),
          }
        : null,
    subject,
    brief,
    intendedUse: oneOf(INTENDED_USES, r.intendedUse) ?? "internal",
    team: oneOf(TEAMS, r.team) ?? "any",
    photoCount: num(r.photoCount, 1),
    priority: oneOf(PRIORITIES, r.priority) ?? "normal",
    assignee:
      assignee && str(assignee.id)
        ? { id: str(assignee.id)!, name: str(assignee.name) ?? "Someone" }
        : null,
    date: str(r.date),
    dateKind: oneOf(["needed_by", "due"] as const, r.dateKind),
    overdue: bool(r.overdue),
    referenceAssetId: str(r.referenceAssetId),
    orientation: oneOf(ORIENTATIONS, r.orientation),
    wantsVideo: bool(r.wantsVideo),
    captureWindow: str(r.captureWindow),
    shotListId: str(r.shotListId),
    state,
    blockedReason: str(r.blockedReason),
    retake: bool(r.retake),
    closedReason: str(r.closedReason),
    closedAt: str(r.closedAt),
    closedByRule: bool(r.closedByRule),
    revision: num(r.revision, 1),
    createdAt: str(r.createdAt) ?? "",
    createdBy: str(r.createdBy),
  }
}

function parseShotList(raw: Raw): ShotListView | null {
  const id = str(raw.id)
  const name = str(raw.name)
  const purpose = oneOf(SHOT_LIST_PURPOSES, raw.purpose)
  const state = oneOf(["open", "completed", "cancelled"] as const, raw.state)
  if (!id || !name || !purpose || !state) return null
  return {
    id,
    name,
    purpose,
    note: str(raw.note),
    date: str(raw.date),
    state,
    overdue: bool(raw.overdue),
    total: num(raw.total),
    completed: num(raw.completed),
    cancelReason: str(raw.cancelReason),
    revision: num(raw.revision, 1),
  }
}

/** public.media_requests; null when the shape is not one. */
export function parseRequestList(data: unknown): RequestList | null {
  const d = obj(data)
  const venueId = str(d?.venueId)
  if (!d || !venueId || !Array.isArray(d.items)) return null
  return {
    venueId,
    today: str(d.today) ?? "",
    items: arr(d.items).flatMap((r) => parseRequest(r) ?? []),
    shotLists: arr(d.shotLists).flatMap((l) => parseShotList(l) ?? []),
    people: arr(d.people).flatMap((p): RequestPerson[] => {
      const id = str(p.id)
      const role = oneOf(["staff", "manager"] as const, p.role)
      if (!id || !role) return []
      return [
        {
          id,
          name: str(p.name) ?? "Someone",
          role,
          team: oneOf(["foh", "boh"] as const, p.team),
        },
      ]
    }),
  }
}

/** public.media_request_detail; null when the shape is not one. */
export function parseRequestDetail(data: unknown): RequestDetail | null {
  const request = parseRequest(data)
  if (!request) return null
  const history = arr(obj(data)?.history).flatMap(
    (h): RequestHistoryEntry[] => {
      const kind = str(h.kind)
      const at = str(h.at)
      if (!kind || !at) return []
      const detail = obj(h.detail)
      return [
        {
          kind,
          reason: str(h.reason),
          actor: str(h.actor),
          at,
          byRule: detail?.by === "rule",
        },
      ]
    }
  )
  return { ...request, history }
}

/** public.my_media_requests; null when the shape is not one. */
export function parseStaffRequests(data: unknown): StaffRequestList | null {
  const d = obj(data)
  const venueId = str(d?.venueId)
  if (!d || !venueId || !Array.isArray(d.items)) return null
  return {
    venueId,
    today: str(d.today) ?? "",
    items: arr(d.items).flatMap((r): StaffRequest[] => {
      const id = str(r.id)
      const type = oneOf(
        ["missing_photo", "replacement", "optional_angle", "campaign"] as const,
        r.type
      )
      const subject = str(r.subject)
      const brief = str(r.brief)
      const state = oneOf(["open", "submitted"] as const, r.state)
      if (!id || !type || !subject || !brief || !state) return []
      const slot = parseSlot(r.slot)
      return [
        {
          id,
          type,
          slot: slot
            ? {
                kind: slot.kind,
                slotId: slot.slotId,
                name: slot.name,
                state: slot.state,
              }
            : null,
          subject,
          brief,
          photoCount: num(r.photoCount, 1),
          neededBy: str(r.neededBy),
          orientation: oneOf(ORIENTATIONS, r.orientation),
          wantsVideo: bool(r.wantsVideo),
          captureWindow: str(r.captureWindow),
          referenceAssetId: str(r.referenceAssetId),
          forMe: bool(r.forMe),
          state,
        },
      ]
    }),
  }
}

// ---- words -----------------------------------------------------------------

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
})

/** "30 Nov" for a YYYY-MM-DD date; the input itself when it is not one. */
export function shortDate(iso: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(`${iso}T00:00:00Z`)
    : null
  return d && !Number.isNaN(d.getTime()) ? DAY.format(d) : iso
}

/**
 * A request's date for a manager. A slot request reads "Needed by 30 Nov"
 * and never Overdue (FA-5); a request with no slot reads "Due 30 Nov", or
 * "Overdue: 30 Nov" once past.
 */
export function managerDateWords(
  r: Pick<RequestView, "date" | "dateKind" | "overdue">
): string | null {
  if (!r.date) return null
  if (r.dateKind === "needed_by") return `Needed by ${shortDate(r.date)}`
  return r.overdue
    ? `Overdue: ${shortDate(r.date)}`
    : `Due ${shortDate(r.date)}`
}

/**
 * A request's date for staff (DESIGN.md §7): "Needed by 30 Nov", and after
 * the date just "Needed". Never a due date or Overdue.
 */
export function staffDateWords(
  neededBy: string | null,
  today: string
): string | null {
  if (!neededBy) return null
  return today && neededBy < today
    ? "Needed"
    : `Needed by ${shortDate(neededBy)}`
}

/** The status chip key for a request state (components/nabalens/status-chip.tsx). */
export const requestChip = (state: RequestState) => `request_${state}` as const

/** What staff read under a requested slot: how many, video, orientation, when. */
export function staffRequestExtras(r: StaffRequest): string[] {
  const out: string[] = []
  if (r.photoCount > 1) out.push(`${r.photoCount} photos`)
  if (r.wantsVideo) out.push("A short video too")
  if (r.orientation) out.push(REQUEST_WORDS.orientation[r.orientation])
  if (r.captureWindow) out.push(r.captureWindow)
  return out
}

// ---- the request form --------------------------------------------------------

export type RequestDraft = {
  mode: "slot" | "new" | "fact"
  type: RequestType
  slotKind?: RequestSlotKind | null
  slotId?: string | null
  factCheckId?: string | null
  subject?: string
  brief: string
  intendedUse: IntendedUse | ""
  team?: Team | null
  photoCount: number
  priority: Priority
  assigneeId?: string | null
  date?: string | null
  orientation?: Orientation | null
  wantsVideo: boolean
  captureWindow?: string
  shotListId?: string | null
}

export type DraftErrors = Partial<Record<keyof RequestDraft, string>>

// Postgres [[:cntrl:]]: control characters, line breaks and tabs.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const length = (s: string) => [...s].length

function line(
  value: string | undefined,
  max: number,
  label: string
): string | null {
  const v = (value ?? "").trim()
  if (length(v) > max) return `${label}: ${max} characters or fewer.`
  if (CONTROL.test(v)) return `${label}: write it as one line.`
  return null
}

/**
 * The form's own checks, the same the database makes (it checks again):
 * the required fields (§7 M4: subject, short instruction, intended use) and
 * the limits. `today` is the venue's date (YYYY-MM-DD).
 */
export function checkRequestDraft(
  draft: RequestDraft,
  today: string
): DraftErrors {
  const errors: DraftErrors = {}
  const fact = draft.mode === "fact"
  if (draft.mode === "slot" && (!draft.slotKind || !draft.slotId))
    errors.slotId = "Choose the slot."
  if (fact && !draft.factCheckId) errors.factCheckId = "Choose the fact."
  if (draft.mode === "new") {
    if (!draft.subject?.trim()) errors.subject = "Write what to photograph."
    else {
      const bad = line(draft.subject, SUBJECT_MAX, "Subject")
      if (bad) errors.subject = bad
    }
    if (draft.type === "replacement")
      errors.type = "A replacement needs a slot with a photo."
  }
  if (!fact && !draft.brief.trim())
    errors.brief = "Write one line on what the photo must show."
  else {
    const bad = line(draft.brief, REQUEST_BRIEF_MAX, "Brief")
    if (bad) errors.brief = bad
  }
  if (!fact && !draft.intendedUse) errors.intendedUse = "Choose the use."
  if (
    !Number.isInteger(draft.photoCount) ||
    draft.photoCount < 1 ||
    draft.photoCount > PHOTO_COUNT_MAX
  )
    errors.photoCount = `Between 1 and ${PHOTO_COUNT_MAX}.`
  if (draft.date && today && draft.date < today)
    errors.date = "Choose today or a later date."
  const window = line(draft.captureWindow, CAPTURE_WINDOW_MAX, "When to shoot")
  if (window) errors.captureWindow = window
  return errors
}

/**
 * The type a slot request starts with: a Replacement when the slot already
 * has a photo, else a Missing photo.
 */
export function defaultTypeForSlot(state: string | null): RequestType {
  return state === "covered" || state === "check_due"
    ? "replacement"
    : "missing_photo"
}

/** Requests to show on the manager list for a filter. */
export type RequestFilter = "active" | "done" | "all"

export function filterRequests(
  items: RequestView[],
  filter: RequestFilter
): RequestView[] {
  if (filter === "all") return items
  const done = (r: RequestView) =>
    r.state === "completed" || r.state === "cancelled"
  return items.filter((r) => (filter === "done" ? done(r) : !done(r)))
}

/** Counts by state for the list's summary line. */
export function countRequests(items: RequestView[]) {
  const counts: Record<RequestState, number> = {
    open: 0,
    submitted: 0,
    completed: 0,
    blocked: 0,
    cancelled: 0,
  }
  for (const r of items) counts[r.state] += 1
  return counts
}
