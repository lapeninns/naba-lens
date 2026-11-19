// Admin venues (Full App v1, S2-ADMIN; spec §8 A2; FA-33). Pure and
// client-safe: the shapes public.admin_venues_list, admin_venue_detail and
// the related reads return (20261118115000_admin_venues.sql), their parsers,
// form validation and the setup checklist's words.

export type OperatingStatus =
  "open" | "temporarily_closed" | "permanently_closed"

export const OPERATING_STATUSES: ReadonlyArray<{
  value: OperatingStatus
  label: string
  hint: string
}> = [
  { value: "open", label: "Open", hint: "Trading as normal." },
  {
    value: "temporarily_closed",
    label: "Temporarily closed",
    hint: "Closed for now; everything carries on as before.",
  },
  {
    value: "permanently_closed",
    label: "Closed for good",
    hint: "Archives the venue. Its photos, decisions and history are kept; nobody but an admin can open it.",
  },
]

/**
 * The operating status a venue really has. A venue switched off
 * (`venues.active` false) is archived whatever its stored trading state: one
 * switched off before operating statuses existed kept the column's 'open'
 * default (S3-R6, V22; 20261118125000 backfills it). Showing it as Open made
 * Open impossible to choose and Temporarily closed turn the venue back on.
 */
export function effectiveOperatingStatus(
  status: string,
  active: boolean
): OperatingStatus {
  if (!active) return "permanently_closed"
  return STATUSES.has(status) ? (status as OperatingStatus) : "open"
}

/** The status chip key for a venue's operating status (status-chip.tsx). */
export function operatingStatusChip(
  status: OperatingStatus
): "venue_open" | "venue_temporarily_closed" | "venue_archived" {
  return status === "open"
    ? "venue_open"
    : status === "temporarily_closed"
      ? "venue_temporarily_closed"
      : "venue_archived"
}

export type VenueReviewer = {
  profileId: string
  name: string
  /** Reviews at the venue today (manager or admin there). */
  eligible: boolean
  revision: number
  setAt: string | null
}

export type ReviewerResponsibility = "main" | "backup"

export type SetupKey =
  "inventory" | "reviewers" | "staff" | "spaces" | "collection"

export type SetupItem = {
  key: SetupKey
  done: boolean
  /** inventory */
  menuVersionId?: string | null
  menuTitle?: string | null
  /** reviewers */
  main?: boolean
  backup?: boolean
  /** staff */
  members?: number
  /** spaces */
  checks?: number
  unanswered?: number
  places?: number
  /** collection */
  covered?: number
}

export type SetupChecklist = {
  items: SetupItem[]
  done: number
  total: number
}

export type AdminVenue = {
  id: string
  name: string
  slug: string
  locality: string | null
  address: string | null
  timezone: string
  operatingStatus: OperatingStatus
  active: boolean
  archivedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
  reviewers: { main: VenueReviewer | null; backup: VenueReviewer | null }
  setup: SetupChecklist
}

/**
 * Someone who may be named a reviewer: a manager at the venue now (S2-MGR's
 * private.venue_reviewer_eligible). Admins review every venue without being
 * named, so they are never candidates (K8, S3-R5).
 */
export type ReviewerCandidate = {
  profileId: string
  name: string
  role: "manager"
}

export type AdminVenueDetail = AdminVenue & {
  candidates: ReviewerCandidate[]
}

export type ArchiveImpact = {
  members: number
  /** People for whom this is their only active venue: they lose access. */
  onlyVenue: number
  scheduledMenus: number
  photos: number
  destinations: number
}

export type TemplatePreview = {
  sourceVenueId: string | null
  questions: { key: string; label: string }[]
  places: { label: string; kind: string }[]
}

export type ScopeImpact = {
  key: "accommodation"
  applicableBefore: boolean
  applicableAfter: boolean
  changes: boolean
  slotsBefore: number
  coveredBefore: number
  slotsAdded: number
  slotsRemoved: number
  roomPlaces: number
}

// ---- parsing -----------------------------------------------------------------

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0
const bool = (v: unknown) => v === true

const STATUSES = new Set<string>(OPERATING_STATUSES.map((s) => s.value))
const SETUP_KEYS = new Set<string>([
  "inventory",
  "reviewers",
  "staff",
  "spaces",
  "collection",
])

function parseReviewer(v: unknown): VenueReviewer | null {
  if (!isObj(v) || !str(v.profileId)) return null
  return {
    profileId: v.profileId as string,
    name: str(v.name) ?? "",
    eligible: bool(v.eligible),
    revision: num(v.revision),
    setAt: str(v.setAt),
  }
}

export function parseSetup(v: unknown): SetupChecklist {
  const raw = isObj(v) && Array.isArray(v.items) ? v.items : []
  const items: SetupItem[] = []
  for (const i of raw) {
    if (!isObj(i) || typeof i.key !== "string" || !SETUP_KEYS.has(i.key))
      continue
    items.push({
      key: i.key as SetupKey,
      done: bool(i.done),
      ...("menuVersionId" in i ? { menuVersionId: str(i.menuVersionId) } : {}),
      ...("menuTitle" in i ? { menuTitle: str(i.menuTitle) } : {}),
      ...("main" in i ? { main: bool(i.main) } : {}),
      ...("backup" in i ? { backup: bool(i.backup) } : {}),
      ...("members" in i ? { members: num(i.members) } : {}),
      ...("checks" in i ? { checks: num(i.checks) } : {}),
      ...("unanswered" in i ? { unanswered: num(i.unanswered) } : {}),
      ...("places" in i ? { places: num(i.places) } : {}),
      ...("covered" in i ? { covered: num(i.covered) } : {}),
    })
  }
  return {
    items,
    done: items.filter((i) => i.done).length,
    total: items.length,
  }
}

export function parseAdminVenue(v: unknown): AdminVenue | null {
  if (!isObj(v)) return null
  const id = str(v.id)
  const name = str(v.name)
  const status = str(v.operatingStatus)
  if (!id || !name || !status || !STATUSES.has(status)) return null
  const reviewers = isObj(v.reviewers) ? v.reviewers : {}
  return {
    id,
    name,
    slug: str(v.slug) ?? "",
    locality: str(v.locality),
    address: str(v.address),
    timezone: str(v.timezone) ?? "Europe/London",
    operatingStatus: effectiveOperatingStatus(status, bool(v.active)),
    active: bool(v.active),
    archivedAt: str(v.archivedAt),
    revision: num(v.revision) || 1,
    createdAt: str(v.createdAt),
    updatedAt: str(v.updatedAt),
    reviewers: {
      main: parseReviewer(reviewers.main),
      backup: parseReviewer(reviewers.backup),
    },
    setup: parseSetup(v.setup),
  }
}

export function parseVenueList(data: unknown): AdminVenue[] | null {
  if (!isObj(data) || !Array.isArray(data.items)) return null
  return data.items
    .map(parseAdminVenue)
    .filter((v): v is AdminVenue => v !== null)
}

export function parseVenueDetail(data: unknown): AdminVenueDetail | null {
  const venue = parseAdminVenue(data)
  if (!venue || !isObj(data)) return null
  const candidates = Array.isArray(data.candidates) ? data.candidates : []
  return {
    ...venue,
    candidates: candidates.flatMap((c) =>
      isObj(c) && str(c.profileId) && c.role === "manager"
        ? [
            {
              profileId: c.profileId as string,
              name: str(c.name) ?? "",
              role: c.role,
            },
          ]
        : []
    ),
  }
}

export function parseArchiveImpact(data: unknown): ArchiveImpact | null {
  if (!isObj(data)) return null
  return {
    members: num(data.members),
    onlyVenue: num(data.onlyVenue),
    scheduledMenus: num(data.scheduledMenus),
    photos: num(data.photos),
    destinations: num(data.destinations),
  }
}

export function parseTemplatePreview(data: unknown): TemplatePreview | null {
  if (!isObj(data)) return null
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : [])
  return {
    sourceVenueId: str(data.sourceVenueId),
    questions: list(data.questions).map((q) => ({
      key: str(q.key) ?? "",
      label: str(q.label) ?? "",
    })),
    places: list(data.places).map((p) => ({
      label: str(p.label) ?? "",
      kind: str(p.kind) ?? "",
    })),
  }
}

export function parseScopeImpact(data: unknown): ScopeImpact | null {
  if (!isObj(data) || data.key !== "accommodation") return null
  return {
    key: "accommodation",
    applicableBefore: bool(data.applicableBefore),
    applicableAfter: bool(data.applicableAfter),
    changes: bool(data.changes),
    slotsBefore: num(data.slotsBefore),
    coveredBefore: num(data.coveredBefore),
    slotsAdded: num(data.slotsAdded),
    slotsRemoved: num(data.slotsRemoved),
    roomPlaces: num(data.roomPlaces),
  }
}

// ---- the form ----------------------------------------------------------------

export type VenueField = "name" | "locality" | "address" | "timezone" | "reason"

export type VenueForm = {
  name: string
  locality: string
  address: string
  timezone: string
  reason: string
}

/**
 * Timezones offered in the form. Europe/London first (every Lapen Inns pub
 * today, spec §8 A2); the rest cover the UK and Ireland's neighbours. The
 * database accepts any IANA name.
 */
export const TIMEZONES: ReadonlyArray<string> = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Amsterdam",
  "Europe/Madrid",
  "Europe/Lisbon",
  "Atlantic/Canary",
]

const IANA = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/
/** tz database variants the database lists but Intl rejects. */
const TZ_VARIANT = /^(posix|right)\//i

/** Field errors, or null when the form can be sent. */
export function validateVenueForm(
  form: VenueForm
): Partial<Record<VenueField, string>> | null {
  const errors: Partial<Record<VenueField, string>> = {}
  const name = form.name.trim()
  if (!name) errors.name = "Give the venue a name."
  else if ([...name].length > 120) errors.name = "At most 120 characters."
  if ([...form.locality.trim()].length > 120)
    errors.locality = "At most 120 characters."
  if ([...form.address.trim()].length > 300)
    errors.address = "At most 300 characters."
  if (
    form.timezone.trim() &&
    (!IANA.test(form.timezone.trim()) || TZ_VARIANT.test(form.timezone.trim()))
  )
    errors.timezone = "Choose a timezone from the list."
  if ([...form.reason.trim()].length > 500)
    errors.reason = "At most 500 characters."
  return Object.keys(errors).length ? errors : null
}

/** Database refusals onto the field and words to show. */
export const VENUE_ERRORS: Record<
  string,
  { field: VenueField; message: string }
> = {
  venue_name_required: { field: "name", message: "Give the venue a name." },
  venue_name_too_long: { field: "name", message: "At most 120 characters." },
  venue_name_taken: {
    field: "name",
    message: "Another venue already has this name.",
  },
  venue_locality_too_long: {
    field: "locality",
    message: "At most 120 characters.",
  },
  venue_address_too_long: {
    field: "address",
    message: "At most 300 characters.",
  },
  invalid_timezone: {
    field: "timezone",
    message: "Choose a timezone from the list.",
  },
  reason_required: { field: "reason", message: "Say why." },
  reason_too_long: { field: "reason", message: "At most 500 characters." },
  reviewer_not_eligible: {
    field: "reason",
    message:
      "Only this venue's managers can be named. Make them a manager here first.",
  },
  reviewer_same_person: {
    field: "reason",
    message: "The main and backup reviewer must be different people.",
  },
  template_source_invalid: {
    field: "reason",
    message: "Choose another venue to copy from.",
  },
}

// ---- the setup checklist's words (spec §8 A2) ---------------------------------

export const SETUP_TITLES: Record<SetupKey, string> = {
  inventory: "Current menu confirmed",
  reviewers: "Main and backup reviewer",
  staff: "Staff invited",
  spaces: "Spaces and facilities checked",
  collection: "First accepted photo",
}

/** One line under the item: what is there, or what is missing. */
export function setupDetail(item: SetupItem): string {
  switch (item.key) {
    case "inventory":
      return item.done
        ? `Active menu: ${item.menuTitle ?? "untitled"}`
        : "No active menu yet."
    case "reviewers":
      if (item.done) return "Both named, and both review here."
      if (!item.main && !item.backup) return "Neither is named yet."
      if (!item.main) return "No main reviewer yet."
      if (!item.backup) return "No backup reviewer yet."
      return "A named reviewer no longer reviews here."
    case "staff": {
      const n = item.members ?? 0
      return n === 0
        ? "Nobody has access yet."
        : `${n} ${n === 1 ? "person has" : "people have"} access.`
    }
    case "spaces": {
      const checks = item.checks ?? 0
      const unanswered = item.unanswered ?? 0
      const places = item.places ?? 0
      if (checks === 0) return "No facility questions yet. Copy a template."
      if (places === 0) return "No spaces listed yet."
      if (unanswered > 0)
        return `${unanswered} of ${checks} facility questions still to answer.`
      return `${checks} questions answered, ${places} ${places === 1 ? "space" : "spaces"}.`
    }
    case "collection": {
      const n = item.covered ?? 0
      return n === 0
        ? "No slot has an accepted photo yet."
        : `${n} ${n === 1 ? "slot has" : "slots have"} an accepted photo.`
    }
  }
}

/** Where the record behind an item lives. */
export function setupHref(item: SetupItem, venueId: string): string {
  switch (item.key) {
    case "inventory":
      return `/admin/menus/${venueId}`
    case "reviewers":
      return `/admin/venues/${venueId}#reviewers`
    case "staff":
      return `/admin/coverage/${venueId}/team`
    case "spaces":
      return `/admin/coverage/${venueId}/amenities`
    case "collection":
      return `/admin/coverage/${venueId}`
  }
}

/** Blocked setup: any item not in place at an open venue. */
export function setupBlocked(venue: Pick<AdminVenue, "active" | "setup">) {
  return venue.active && venue.setup.done < venue.setup.total
}
