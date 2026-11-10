// Policy detail (b03-design §5.1; B03 UI design §4): the rule, areas with
// their own rule, conditions and exceptions from the owner's value lists,
// what it applies to and who stated it. Saving an incomplete policy is
// allowed (D-B3-5): only a malformed row stops a send; what is missing for
// confirmation is the "still needs" list, which the server has the last word
// on.

import type {
  KnowledgeAnswer,
  Place,
  PlaceRef,
  PolicyMissing,
  ValueListItem,
} from "@/lib/knowledge-client/contract"

export type PolicyStance =
  "allowed" | "not_allowed" | "conditional" | "not_applicable" | "unknown"
export type ZoneStance = "allowed" | "not_allowed" | "conditional"
export type PolicySource = "in_person" | "written_policy"
export type PolicyBasis = "venue_manager" | "admin"
export type PolicyScope = "venue" | "organisation"

export type ZoneDraft = { place: PlaceRef | null; stance: ZoneStance | "" }
export type ConditionDraft = { type: string; value: string; note: string }
export type ExceptionDraft = { type: string; note: string }

export type PolicyDraft = {
  stance: PolicyStance | null
  zones: ZoneDraft[]
  conditions: ConditionDraft[]
  exceptions: ExceptionDraft[]
  policyScope: PolicyScope
  statedOn: string
  source: PolicySource | ""
  reference: string
}

export type PolicyField =
  | "stance"
  | "zones"
  | "conditions"
  | "exceptions"
  | "policyScope"
  | "statedOn"
  | "source"
  | "reference"

export const POLICY_LIMITS = {
  rows: 20,
  label: 80,
  value: 200,
  note: 500,
  reference: 200,
} as const

export const POLICY_STANCES: PolicyStance[] = [
  "allowed",
  "not_allowed",
  "conditional",
  "not_applicable",
  "unknown",
]
export const ZONE_STANCES: ZoneStance[] = [
  "allowed",
  "not_allowed",
  "conditional",
]

export const POLICY_COPY = {
  rule: "The rule",
  stanceLabel: {
    allowed: "Allowed",
    not_allowed: "Not allowed",
    conditional: "Allowed with conditions",
    not_applicable: "Not applicable",
    unknown: "Couldn't establish",
  } satisfies Record<PolicyStance, string>,
  stanceRequired: "Choose the rule.",
  staffContext:
    "A manager or an admin states the policy. What you send helps them; it doesn't set the rule.",
  ruleSeen: "The rule you saw",
  areas: "Areas",
  areasHelp:
    "Add a row for each area with its own rule, for example ⟨Area A⟩ allowed and ⟨Area B⟩ not allowed.",
  area: (n: number) => `Area ${n}`,
  place: "Place",
  somewhereElse: "Somewhere else",
  nameThePlace: "Name the place",
  ruleHere: "Rule here",
  addArea: "Add an area",
  removeArea: (n: number) => `Remove area ${n}`,
  areaPlace: "Choose the area, or name it.",
  areaRule: "Choose the rule here.",
  conditions: "Conditions",
  condition: (n: number) => `Condition ${n}`,
  conditionType: "Condition",
  conditionValue: "Value",
  note: "Note (internal)",
  addCondition: "Add a condition",
  removeCondition: (n: number) => `Remove condition ${n}`,
  noConditionTypes: "No condition types are set up yet. Ask an admin.",
  conditionChoose: "Choose a condition.",
  valueNeeded: "Add the value.",
  valueNumber: "Enter a number.",
  valueTime: "Enter a time, such as 18:00.",
  exceptions: "Exceptions",
  exception: (n: number) => `Exception ${n}`,
  exceptionType: "Exception",
  addException: "Add an exception",
  removeException: (n: number) => `Remove exception ${n}`,
  noExceptionTypes: "No exception types are set up yet.",
  exceptionChoose: "Choose an exception.",
  retired: (label: string) => `${label} (no longer offered)`,
  appliesTo: "Applies to",
  scopeLabel: {
    venue: "This venue",
    organisation: "Every venue",
  } satisfies Record<PolicyScope, string>,
  everyVenueHelp:
    "A policy for every venue applies at a venue only once that venue's answer uses it. Nothing changes at other venues by itself.",
  whoStated: "Who stated it",
  basisLabel: {
    venue_manager: "You, as venue manager",
    admin: "You, as admin",
  } satisfies Record<PolicyBasis, string>,
  statedOn: "Stated on",
  statedOnHelp:
    "The day the policy was stated. Check dates count from this day.",
  statedOnFuture: "Choose today or an earlier day.",
  where: "Where",
  sourceLabel: {
    in_person: "In person",
    written_policy: "Written policy",
  } satisfies Record<PolicySource, string>,
  reference: "Reference (optional, internal)",
  referenceTooLong: `Keep it to ${POLICY_LIMITS.reference} characters.`,
  evidenceHelp:
    "A photo can show what's there, such as a sign or a bowl. It doesn't confirm the policy.",
  needsTitle: "What this policy still needs",
  nothingMissing: "Nothing is missing.",
} as const

/** The headline a rule is stored under (Allowed with conditions is a Yes). */
export function stanceAnswer(stance: PolicyStance): KnowledgeAnswer {
  switch (stance) {
    case "allowed":
    case "conditional":
      return "yes"
    case "not_allowed":
      return "no"
    case "not_applicable":
      return "not_applicable"
    case "unknown":
      return "unknown"
  }
}

export function emptyZone(): ZoneDraft {
  return { place: null, stance: "" }
}

/** A version that requires areas starts with one empty row (§4.2). */
export function emptyPolicy({
  requiresZones = false,
}: { requiresZones?: boolean } = {}): PolicyDraft {
  return {
    stance: null,
    zones: requiresZones ? [emptyZone()] : [],
    conditions: [],
    exceptions: [],
    policyScope: "venue",
    statedOn: "",
    source: "",
    reference: "",
  }
}

export function policyTouched(draft: PolicyDraft): boolean {
  return (
    draft.stance !== null ||
    draft.zones.some((z) => z.place !== null || z.stance !== "") ||
    draft.conditions.length > 0 ||
    draft.exceptions.length > 0 ||
    draft.policyScope !== "venue" ||
    draft.statedOn !== "" ||
    draft.source !== "" ||
    draft.reference.trim() !== ""
  )
}

const hasPlace = (ref: PlaceRef | null): ref is PlaceRef =>
  !!ref && ("subjectId" in ref || ref.label.trim() !== "")
const zoneBlank = (z: ZoneDraft) => z.place === null && z.stance === ""
const conditionBlank = (c: ConditionDraft) =>
  !c.type && !c.value.trim() && !c.note.trim()
const exceptionBlank = (e: ExceptionDraft) => !e.type && !e.note.trim()

/**
 * The form's guide to what's still missing, in the server's order (A5).
 * Content only: who confirms is the server's to say once it's sent.
 */
export function policyNeeds(
  draft: PolicyDraft,
  { requiresZones = false }: { requiresZones?: boolean } = {}
): PolicyMissing[] {
  const out: PolicyMissing[] = []
  if (!draft.stance || draft.stance === "unknown") out.push("stance")
  if (
    draft.stance === "conditional" &&
    !draft.conditions.some((c) => !conditionBlank(c))
  )
    out.push("conditions")
  if (requiresZones && !draft.zones.some((z) => !zoneBlank(z)))
    out.push("zones")
  if (!draft.source) out.push("authority")
  if (!draft.statedOn) out.push("stated_on")
  return out
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

type Lists = {
  conditionTypes: readonly ValueListItem[]
  exceptionTypes: readonly ValueListItem[]
}

/** The first malformed row of a section: which, which control, what to say. */
export type PolicyRowProblem = {
  index: number
  part: "place" | "stance" | "type" | "value"
  message: string
}

export function firstBadZone(draft: PolicyDraft): PolicyRowProblem | null {
  for (const [index, z] of draft.zones.entries()) {
    if (zoneBlank(z)) continue
    if (!hasPlace(z.place))
      return { index, part: "place", message: POLICY_COPY.areaPlace }
    if (!z.stance)
      return { index, part: "stance", message: POLICY_COPY.areaRule }
  }
  return null
}

export function firstBadCondition(
  draft: PolicyDraft,
  lists: Pick<Lists, "conditionTypes">
): PolicyRowProblem | null {
  if (draft.stance !== "conditional") return null
  for (const [index, c] of draft.conditions.entries()) {
    if (conditionBlank(c)) continue
    if (!c.type)
      return { index, part: "type", message: POLICY_COPY.conditionChoose }
    const item = lists.conditionTypes.find((t) => t.code === c.type)
    const value = c.value.trim()
    if (item?.needsValue && !value)
      return { index, part: "value", message: POLICY_COPY.valueNeeded }
    if (
      value &&
      item?.valueKind === "number" &&
      !Number.isFinite(Number(value))
    )
      return { index, part: "value", message: POLICY_COPY.valueNumber }
    if (value && item?.valueKind === "time" && !TIME.test(value))
      return { index, part: "value", message: POLICY_COPY.valueTime }
  }
  return null
}

export function firstBadException(draft: PolicyDraft): PolicyRowProblem | null {
  for (const [index, e] of draft.exceptions.entries())
    if (!exceptionBlank(e) && !e.type)
      return { index, part: "type", message: POLICY_COPY.exceptionChoose }
  return null
}

/** What stops a send: malformed rows and dates (never what's missing). */
export function policyErrors(
  draft: PolicyDraft,
  ctx: Lists & { today: string; staff?: boolean }
): Partial<Record<PolicyField, string>> {
  const errors: Partial<Record<PolicyField, string>> = {}
  if (!draft.stance) errors.stance = POLICY_COPY.stanceRequired
  const zone = firstBadZone(draft)
  if (zone) errors.zones = zone.message
  if (!ctx.staff) {
    const condition = firstBadCondition(draft, ctx)
    if (condition) errors.conditions = condition.message
    const exception = firstBadException(draft)
    if (exception) errors.exceptions = exception.message
    if (draft.statedOn && draft.statedOn > ctx.today)
      errors.statedOn = POLICY_COPY.statedOnFuture
    if (draft.reference.trim().length > POLICY_LIMITS.reference)
      errors.reference = POLICY_COPY.referenceTooLong
  }
  return errors
}

const trimmedNote = (note: string) => (note.trim() ? { note: note.trim() } : {})

/**
 * The detail to send. A manager's or an admin's statement carries what it
 * applies to and who stated it (the basis is the account's, never chosen);
 * a staff observation carries only the rule seen and its areas (§4.1).
 */
export function policyDetail(
  draft: PolicyDraft,
  ctx: { basis: PolicyBasis | null } & Pick<Lists, "conditionTypes">
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (draft.stance) out.stance = draft.stance
  const zones = draft.zones.filter((z) => !zoneBlank(z))
  if (zones.length)
    out.zones = zones.map((z) => ({
      ...(z.place && "subjectId" in z.place
        ? { subjectId: z.place.subjectId }
        : { label: z.place?.label.trim() ?? "" }),
      stance: z.stance,
    }))
  if (!ctx.basis) return out
  const conditions = draft.conditions.filter((c) => !conditionBlank(c))
  if (draft.stance === "conditional" && conditions.length)
    out.conditions = conditions.map((c) => {
      const kind = ctx.conditionTypes.find((t) => t.code === c.type)?.valueKind
      const value = c.value.trim()
      return {
        type: c.type,
        ...(value ? { value: kind === "number" ? Number(value) : value } : {}),
        ...trimmedNote(c.note),
      }
    })
  const exceptions = draft.exceptions.filter((e) => !exceptionBlank(e))
  if (exceptions.length)
    out.exceptions = exceptions.map((e) => ({
      type: e.type,
      ...trimmedNote(e.note),
    }))
  out.policyScope = draft.policyScope
  out.authority = {
    basis: ctx.basis,
    ...(draft.statedOn ? { statedOn: draft.statedOn } : {}),
    ...(draft.source ? { source: draft.source } : {}),
    ...(draft.reference.trim() ? { reference: draft.reference.trim() } : {}),
  }
  return out
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === "string" ? v : "")
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null =>
  (list as readonly unknown[]).includes(v) ? (v as T) : null

/** A stored or drafted policy detail back into the form, defensively. */
export function policyFromDetail(
  detail: unknown,
  { requiresZones = false }: { requiresZones?: boolean } = {}
): PolicyDraft {
  const draft = emptyPolicy({ requiresZones })
  if (!isRecord(detail)) return draft
  draft.stance = oneOf(detail.stance, POLICY_STANCES)
  if (Array.isArray(detail.zones)) {
    const zones = detail.zones.filter(isRecord).map((z): ZoneDraft => ({
      place:
        typeof z.subjectId === "string"
          ? { subjectId: z.subjectId }
          : typeof z.label === "string"
            ? { label: z.label }
            : null,
      stance: oneOf(z.stance, ZONE_STANCES) ?? "",
    }))
    if (zones.length) draft.zones = zones
  }
  if (Array.isArray(detail.conditions))
    draft.conditions = detail.conditions.filter(isRecord).map((c) => ({
      type: str(c.type),
      value: typeof c.value === "number" ? String(c.value) : str(c.value),
      note: str(c.note),
    }))
  if (Array.isArray(detail.exceptions))
    draft.exceptions = detail.exceptions.filter(isRecord).map((e) => ({
      type: str(e.type),
      note: str(e.note),
    }))
  draft.policyScope =
    oneOf(detail.policyScope, ["venue", "organisation"] as const) ?? "venue"
  if (isRecord(detail.authority)) {
    const a = detail.authority
    draft.statedOn = /^\d{4}-\d{2}-\d{2}$/.test(str(a.statedOn))
      ? str(a.statedOn)
      : ""
    draft.source =
      oneOf(a.source, ["in_person", "written_policy"] as const) ?? ""
    draft.reference = str(a.reference)
  }
  return draft
}

/** The section a server error path belongs to (b03-design §14.3). */
export function policyFieldOf(path: string): PolicyField | null {
  const section =
    /^detail\.(stance|zones|conditions|exceptions|policyScope)\b/.exec(path)
  if (section) return section[1] as PolicyField
  const authority =
    /^detail\.authority(?:\.(statedOn|source|reference))?\b/.exec(path)
  if (authority) return (authority[1] as PolicyField | undefined) ?? "source"
  return null
}

/** Server field errors (keyed by path) onto the sections. */
export function policyFieldErrors(
  fieldErrors: Partial<Record<string, string>> | undefined
): Partial<Record<PolicyField, string>> {
  const out: Partial<Record<PolicyField, string>> = {}
  for (const [path, message] of Object.entries(fieldErrors ?? {})) {
    if (!message) continue
    const field = policyFieldOf(path)
    if (field && !out[field]) out[field] = message
  }
  return out
}

/** A list item's label, an old answer's retired code included (§4.2). */
export function listLabel(
  code: string,
  items: readonly ValueListItem[]
): string {
  return items.find((t) => t.code === code)?.label ?? POLICY_COPY.retired(code)
}

/** "⟨Back bar⟩" for an area's place, from the venue's places when known. */
export function zonePlaceName(ref: PlaceRef, places: Place[]): string {
  if ("label" in ref) return ref.label
  return (
    places.find((p) => p.subjectId === ref.subjectId)?.label ?? "that place"
  )
}
