// B04-b1 (docs: b04-design §5, A1-4, A1-6): trading lines, assertions,
// decisions, availability schedules and the read-time states. Pure: no
// Supabase, no Node APIs, so server code, Server Functions and components may
// all import it.
//
// The closed sets and the stored value schema mirror
// supabase/migrations/20261110203000_menu_b04b_trading_assertions.sql (one
// list per side, §5.3). The database is authoritative for writes;
// tests/security/menus-trading.test.ts pins both sides.

export const TRADING_FIELDS = [
  "price",
  "availability",
  "temporary_unavailability",
] as const
export type TradingField = (typeof TRADING_FIELDS)[number]

/** Staff may report only these (§5.4, OD-B4-16). */
export const STAFF_REPORT_FIELDS = [
  "price",
  "temporary_unavailability",
] as const satisfies readonly TradingField[]

export const TRADING_CHANNELS = ["all", "dine_in", "takeaway"] as const
export type TradingChannel = (typeof TRADING_CHANNELS)[number]

export const PORTION_UNITS = [
  "ml",
  "cl",
  "l",
  "pint",
  "g",
  "kg",
  "oz",
  "piece",
] as const
export type PortionUnit = (typeof PORTION_UNITS)[number]

export const TRADING_BASES = [
  "source_mapping",
  "manager_statement",
  "staff_report",
  "correction",
  "rollback",
] as const
export type TradingBasis = (typeof TRADING_BASES)[number]

export const TRADING_DECISIONS = ["confirmed", "declined", "withdrawn"] as const
export type TradingDecision = (typeof TRADING_DECISIONS)[number]

/** A1-2 / L2: where a confirmation's stated_on came from. */
export const STATED_ON_SOURCES = ["form_default", "chosen"] as const
export type StatedOnSource = (typeof STATED_ON_SOURCES)[number]

/** OD-B4-4: allowed currencies (private.menu_trading_currencies). */
export const TRADING_CURRENCIES = ["GBP"] as const
export type TradingCurrency = (typeof TRADING_CURRENCIES)[number]

/**
 * The largest amount in minor units: 8 digits (£999,999.99), exact in SQL and
 * in a JavaScript number, so a price never loses a penny across the boundary.
 */
export const PRICE_MAX_MINOR = 99_999_999

export const AMBIGUOUS_PRICE_FORMS = ["market", "from", "multiple"] as const
export type AmbiguousPriceForm = (typeof AMBIGUOUS_PRICE_FORMS)[number]

/** A1-4 causes; b1 opens only temporary_until_passed. */
export const RECHECK_CAUSES = [
  "due_soon",
  "expired",
  "basis_missing",
  "temporary_until_passed",
  "material_change",
] as const
export type TradingRecheckCause = (typeof RECHECK_CAUSES)[number]

/** Limits shared with the SQL checks. */
export const TRADING_LIMITS = {
  portionLabelMax: 40,
  reasonMax: 500,
  rawTextMax: 80,
  sourceLocatorMax: 1152,
  /** numeric(10, 3): 7 integer digits, 3 decimals. */
  portionQuantityPattern: /^[0-9]{1,7}(\.[0-9]{1,3})?$/,
  /** Days before the venue's today a stated_on or observed_on may be. */
  statedOnBackDays: 30,
  noteMax: 500,
} as const

// ---------------------------------------------------------------------------
// Stored values (§5.3)
// ---------------------------------------------------------------------------

export type FixedPrice = {
  kind: "fixed"
  amountMinor: number
  currency: TradingCurrency
}
/** Source-mapped only; can be declined or withdrawn, never confirmed. */
export type AmbiguousPrice = { kind: "ambiguous"; form: AmbiguousPriceForm }
export type PriceValue = FixedPrice | AmbiguousPrice

export type AvailabilityValue =
  | { state: "always" }
  | { state: "not_offered" }
  | { state: "scheduled"; scheduleId: string }

export type TemporaryUnavailabilityValue =
  | {
      state: "temporarily_unavailable"
      /** UTC, whole seconds, `YYYY-MM-DDTHH:MM:SSZ`; null until further notice. */
      until: string | null
    }
  | { state: "back_in_service" }

export type TradingValue =
  PriceValue | AvailabilityValue | TemporaryUnavailabilityValue

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const UNTIL = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const sameKeys = (v: Record<string, unknown>, keys: string[]) => {
  const own = Object.keys(v).sort()
  const want = [...keys].sort()
  return own.length === want.length && own.every((k, i) => k === want[i])
}

/**
 * private.menu_trading_value_problem: null when `value` is a valid stored
 * value of `field`, else the same short problem name.
 */
export function tradingValueProblem(
  field: TradingField,
  value: unknown
): string | null {
  if (!isRecord(value)) return "not_an_object"
  if (field === "price") {
    if (value.kind === "fixed") {
      if (!sameKeys(value, ["amountMinor", "currency", "kind"])) return "keys"
      if (
        typeof value.amountMinor !== "number" ||
        !Number.isInteger(value.amountMinor) ||
        value.amountMinor < 0 ||
        value.amountMinor > PRICE_MAX_MINOR
      )
        return "amount"
      if (
        typeof value.currency !== "string" ||
        !(TRADING_CURRENCIES as readonly string[]).includes(value.currency)
      )
        return "currency"
      return null
    }
    if (value.kind === "ambiguous") {
      if (!sameKeys(value, ["form", "kind"])) return "keys"
      if (
        typeof value.form !== "string" ||
        !(AMBIGUOUS_PRICE_FORMS as readonly string[]).includes(value.form)
      )
        return "form"
      return null
    }
    return "kind"
  }
  if (field === "availability") {
    if (value.state === "always" || value.state === "not_offered")
      return sameKeys(value, ["state"]) ? null : "keys"
    if (value.state === "scheduled") {
      if (!sameKeys(value, ["scheduleId", "state"])) return "keys"
      return typeof value.scheduleId === "string" && UUID.test(value.scheduleId)
        ? null
        : "schedule"
    }
    return "state"
  }
  if (field === "temporary_unavailability") {
    if (value.state === "temporarily_unavailable") {
      if (!sameKeys(value, ["state", "until"])) return "keys"
      if (value.until === null) return null
      return typeof value.until === "string" && UNTIL.test(value.until)
        ? null
        : "until"
    }
    if (value.state === "back_in_service")
      return sameKeys(value, ["state"]) ? null : "keys"
    return "state"
  }
  return "field"
}

/** private.menu_until_text: an instant as UTC, whole seconds. */
export function untilText(instant: Date | string | number): string {
  const ms = new Date(instant).getTime()
  return new Date(Math.floor(ms / 1000) * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
}

// ---------------------------------------------------------------------------
// Records the resolver reads (one line's rows)
// ---------------------------------------------------------------------------

export type TradingAssertionRecord = {
  id: string
  field: TradingField
  value: TradingValue
  basis: TradingBasis
  supersedes: string | null
  /** Venue-local dates, YYYY-MM-DD, inclusive. */
  effectiveFrom: string | null
  effectiveTo: string | null
}

/**
 * public.menu_trading_line_reviews (A1-6): a declared portion or
 * variant-meaning change reached the line at activation. Confirmations with
 * seq at most lastDecisionSeq precede it.
 */
export type TradingLineReviewRecord = {
  /** ISO 8601 instant (activation). */
  openedAt: string
  lastDecisionSeq: number
}

export type TradingDecisionRecord = {
  assertionId: string
  decision: TradingDecision
  /** ISO 8601 instant. */
  decidedAt: string
  /** Order of decisions (the table's seq); ties on decidedAt break by it. */
  seq: number
  statedOn?: string | null
  statedOnSource?: StatedOnSource | null
}

// ---------------------------------------------------------------------------
// Read states (§5.5, A1-6)
// ---------------------------------------------------------------------------

/** private.menu_trading_field_state. updatedBy never names a person (§10). */
export type FieldState =
  | {
      status: "available"
      assertionId: string
      value: TradingValue
      updatedBy: "menu_source" | "manager"
      effectiveFrom: string | null
      effectiveTo: string | null
      startsAt: string
      endsAt: string | null
      confirmedAt: string
      statedOn: string | null
      statedOnSource: StatedOnSource | null
    }
  | {
      status: "unavailable"
      reason: "disputed"
      detail: "conflict"
      assertionIds: string[]
    }
  | { status: "unavailable"; reason: "withdrawn"; detail: "value_withdrawn" }
  | {
      /** A1-6: a declared portion or variant-meaning change since it was confirmed. */
      status: "unavailable"
      reason: "not_confirmed"
      detail: "pending"
      previousAssertionId: string
      reviewSince: string
    }
  | { status: "unavailable"; reason: "unknown"; detail: "not_recorded" }

export type OccurrenceView = {
  localDate: string
  startsAt: string
  endsAt: string
  state: "scheduled" | "cancelled" | "changed" | "extra"
}

/** private.menu_trading_availability (keys the reader needs). */
export type AvailabilityState =
  | {
      state: "available"
      source: "always" | "menu_schedule" | "service"
      occurrence?: OccurrenceView
    }
  | {
      state: "cancelled"
      source: "menu_schedule" | "service"
      occurrence: OccurrenceView
    }
  | { state: "outside_window"; source: "menu_schedule" | "service" }
  | {
      state: "not_offered"
      detail:
        "not_offered" | "not_started" | "schedule_ended" | "service_not_offered"
    }
  | { state: "temporarily_unavailable"; until: string | null }
  | {
      state: "needs_checking"
      reason: "stale"
      detail: "recheck_requested"
      until: string
    }
  | { state: "unknown"; reason: string; detail: string }

/** One use's freshness of a confirmed value (A1-2, A1-6; B03's entry). */
export type FreshnessEntry = {
  use: "internal" | "public"
  state: "current" | "due_soon" | "expired" | "basis_missing" | "unrated"
  basis: "stated_on" | null
  basisDate: string | null
  nextCheckDue: string | null
  policyId: string | null
  policyVersion: number | null
}

/**
 * A bound value whose internal freshness is expired or basis_missing: stale,
 * with the value shown to admins and managers only (A1-6).
 */
type StaleRead<T> = {
  reason: "stale"
  detail: "expired" | "basis_missing"
  nextCheckDue: string | null
  freshness: FreshnessEntry[]
  staleValue?: T
}

/** A line's price as read (S2's state; freshness only when bound). */
export type PriceRead =
  | (FieldState & { freshness?: FreshnessEntry[] })
  | ({ status: "unavailable" } & StaleRead<FieldState>)

/** A line's availability as read (S2's state; freshness only when bound). */
export type AvailabilityRead =
  | (AvailabilityState & { freshness?: FreshnessEntry[] })
  | ({ state: "unknown" } & StaleRead<AvailabilityState>)

export type TradingPortion = {
  label: string
  quantity?: number
  unit?: PortionUnit
}

/** One line as public.menu_trading_lines_for_item returns it. */
export type TradingLineView = {
  lineId: string
  revision: number
  itemId: string
  variantId: string | null
  portion: TradingPortion | null
  channel: TradingChannel
  retiredAt: string | null
  price: PriceRead
  availability: AvailabilityRead & Record<string, unknown>
  /** Admin and manager only. */
  pending?: {
    assertionId: string
    field: TradingField
    value: TradingValue
    basis: TradingBasis
    effectiveFrom: string | null
    effectiveTo: string | null
    observedOn: string | null
    statedAt: string
    statedBy: string
    reason: string | null
    supersedes: string | null
    /** Admin only. */
    snapshotId?: string | null
    sourceLocator?: string | null
    rawText?: string | null
  }[]
  rechecks?: {
    taskId: string
    cause: TradingRecheckCause
    use: "internal" | "public"
    dueAt: string
    createdAt: string
  }[]
  /** Staff only: their own open reports. */
  myPending?: {
    assertionId: string
    field: TradingField
    value: TradingValue
    statedAt: string
  }[]
}

export type TradingLinesView = {
  itemId: string
  venueId: string
  view: "admin" | "manager" | "staff"
  at: string
  lines: TradingLineView[]
}
