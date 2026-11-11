// Accessibility detail (b03-design §4.3; B03 UI design §3.2, §3.3): what was
// checked, the version's features and measurements, and for step-free
// entrance each listed entrance's result. Only Places entrances can count:
// `entrances[]` needs a place id, so a typed entrance is never offered (A25).
// The scope isn't asked separately when entrances are listed (A34).

import type {
  Place,
  PlaceRef,
  QuestionFeature,
} from "@/lib/knowledge-client/contract"

export type FeatureValue = "yes" | "no" | "not_checked"
export type MeasureUnit = "mm" | "cm" | "degrees"
export type MeasureMethod = "tape" | "gauge" | "other"

export type MeasurementDraft = {
  feature: string
  value: string
  unit: MeasureUnit | ""
  measuredOn: string
  method: MeasureMethod | ""
}

export type AccessDraft = {
  scope: PlaceRef | null
  features: Record<string, FeatureValue>
  measurements: MeasurementDraft[]
  /** Step-free entrance only: each listed entrance's result, by place id. */
  entrances: Record<string, FeatureValue>
}

export type AccessField = "scope" | "features" | "measurements" | "entrances"

export const ACCESS_COPY = {
  scope: "What did you check?",
  scopeHelp:
    "Choose the entrance, route or facility you looked at. Your answer covers that place only.",
  somewhereElse: "Somewhere else",
  nameThePlace: "Name the place",
  noPlaces: (venue: string) =>
    `No places are listed for ${venue} yet. Name the place you checked.`,
  covers: (scope: string) =>
    `This covers ${scope} only. It says nothing about other entrances, routes inside, toilets or seating.`,
  scopeRequired: "Choose what you checked, or name it.",
  entrances: "Which entrances did you check?",
  entrancesHelp:
    "Mark each entrance you checked. Leave the rest as Not checked.",
  noEntrances: (venue: string) => `No entrances are listed for ${venue} yet.`,
  addEntrancesManager: "Add entrances under Places.",
  addEntrancesStaff: "Ask your manager to add entrances under Places.",
  entranceValue: {
    yes: "Step-free",
    no: "Has steps",
    not_checked: "Not checked",
  } satisfies Record<FeatureValue, string>,
  featureValue: {
    yes: "Yes",
    no: "No",
    not_checked: "Not checked",
  } satisfies Record<FeatureValue, string>,
  featureHelp: "Not checked means you didn't look. It isn't the same as No.",
  yesSays: (names: string[]) =>
    `Yes says ${joinNames(names)} ${names.length === 1 ? "is" : "are"} step-free. It says nothing about the others.`,
  noSays: (venue: string, n: number) =>
    `No says every entrance listed for ${venue} has steps (${n} listed).`,
  yesNeeds: "To answer Yes, mark at least one entrance as step-free.",
  noNeedsList: (venue: string) =>
    `No needs ${venue}'s entrances to be listed first. Ask your manager to add them under Places, or send Couldn't establish.`,
  noNeedsAll: (n: number) =>
    `To answer No, mark every listed entrance as having steps (${n} listed). If you didn't check them all, answer Couldn't establish.`,
  measurements: "Add a measurement",
  measurementsHelp:
    "Only if you measured it yourself. Never estimate from a photo.",
  measurement: (n: number) => `Measurement ${n}`,
  removeMeasurement: (n: number) => `Remove measurement ${n}`,
  addAnother: "Add a measurement",
  feature: "Feature",
  value: "Value",
  unit: "Unit",
  unitLabel: { mm: "mm", cm: "cm", degrees: "degrees" } satisfies Record<
    MeasureUnit,
    string
  >,
  measuredOn: "Measured on",
  method: "How did you measure?",
  methodLabel: {
    tape: "Tape",
    gauge: "Gauge",
    other: "Other",
  } satisfies Record<MeasureMethod, string>,
  measureNumber: "Enter a number.",
  measureUnit: "Choose a unit.",
  measureDate: "Add the date you measured.",
  measureFuture: "Choose today or an earlier day.",
  measureMethod: "Say how you measured it.",
  measureFeature: "Choose what you measured.",
} as const

function joinNames(names: string[]) {
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
    : (names[0] ?? "")
}

/** A chosen place, or a typed name that isn't empty. */
function hasScope(
  draft: AccessDraft
): draft is AccessDraft & { scope: PlaceRef } {
  const scope = draft.scope
  if (!scope) return false
  return "subjectId" in scope || scope.label.trim() !== ""
}

export function emptyAccess(): AccessDraft {
  return { scope: null, features: {}, measurements: [], entrances: {} }
}

export function emptyMeasurement(feature = ""): MeasurementDraft {
  return { feature, value: "", unit: "", measuredOn: "", method: "" }
}

export function accessTouched(draft: AccessDraft): boolean {
  return (
    draft.scope !== null ||
    Object.values(draft.features).some((v) => v !== "not_checked") ||
    draft.measurements.length > 0 ||
    Object.values(draft.entrances).some((v) => v !== "not_checked")
  )
}

type Context = {
  answer: string | null
  stepFree: boolean
  /** The venue's active entrances (step-free only). */
  entrances: Place[]
  venueName: string
  today: string
}

/** The first problem per section, or nothing. */
export function accessErrors(
  draft: AccessDraft,
  ctx: Context
): Partial<Record<AccessField, string>> {
  const errors: Partial<Record<AccessField, string>> = {}
  if (ctx.stepFree) {
    const value = (p: Place) => draft.entrances[p.subjectId] ?? "not_checked"
    if (ctx.answer === "yes" && !ctx.entrances.some((p) => value(p) === "yes"))
      errors.entrances = ACCESS_COPY.yesNeeds
    if (ctx.answer === "no") {
      if (ctx.entrances.length === 0)
        errors.entrances = ACCESS_COPY.noNeedsList(ctx.venueName)
      else if (!ctx.entrances.every((p) => value(p) === "no"))
        errors.entrances = ACCESS_COPY.noNeedsAll(ctx.entrances.length)
    }
  } else if (ctx.answer && ctx.answer !== "unknown" && !hasScope(draft))
    errors.scope = ACCESS_COPY.scopeRequired
  const bad = firstBadMeasurement(draft, ctx.today)
  if (bad) errors.measurements = bad.message
  return errors
}

/** A measurement's controls, as the fields name them. */
export type MeasurementPart = "feature" | "value" | "unit" | "date" | "method"

/** The first measurement with a problem, which control, and what to say. */
export function firstBadMeasurement(
  draft: AccessDraft,
  today: string
): { index: number; part: MeasurementPart; message: string } | null {
  for (const [index, m] of draft.measurements.entries()) {
    const n = Number(m.value.trim())
    const found: [MeasurementPart, string] | null = !m.feature
      ? ["feature", ACCESS_COPY.measureFeature]
      : !m.value.trim() || !Number.isFinite(n) || n < 0 || n > 100000
        ? ["value", ACCESS_COPY.measureNumber]
        : !m.unit
          ? ["unit", ACCESS_COPY.measureUnit]
          : !m.measuredOn
            ? ["date", ACCESS_COPY.measureDate]
            : m.measuredOn > today
              ? ["date", ACCESS_COPY.measureFuture]
              : !m.method
                ? ["method", ACCESS_COPY.measureMethod]
                : null
    if (found) return { index, part: found[0], message: found[1] }
  }
  return null
}

/** The line shown before sending, for step-free; null otherwise. */
export function stepFreeLine(
  draft: AccessDraft,
  ctx: Pick<Context, "answer" | "entrances" | "venueName">
): string | null {
  if (ctx.answer === "yes") {
    const names = ctx.entrances
      .filter((p) => draft.entrances[p.subjectId] === "yes")
      .map((p) => p.label)
    return names.length ? ACCESS_COPY.yesSays(names) : null
  }
  if (ctx.answer === "no" && ctx.entrances.length)
    return ACCESS_COPY.noSays(ctx.venueName, ctx.entrances.length)
  return null
}

/**
 * The detail to send. Every feature the version asks about goes with its
 * value (Not checked when untouched); for step-free, every listed entrance.
 */
export function accessDetail(
  draft: AccessDraft,
  ctx: {
    stepFree: boolean
    features: QuestionFeature[]
    entrances: Place[]
  }
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (ctx.stepFree) {
    if (ctx.entrances.length)
      out.entrances = ctx.entrances.map((p) => ({
        subjectId: p.subjectId,
        stepFree: draft.entrances[p.subjectId] ?? "not_checked",
      }))
  } else if (hasScope(draft)) out.scope = draft.scope
  if (ctx.features.length)
    out.features = Object.fromEntries(
      ctx.features.map((f) => [f.key, draft.features[f.key] ?? "not_checked"])
    )
  if (draft.measurements.length)
    out.measurements = draft.measurements.map((m) => ({
      feature: m.feature,
      value: Number(m.value.trim()),
      unit: m.unit,
      measuredOn: m.measuredOn,
      method: m.method,
    }))
  return out
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const FEATURE_VALUES: readonly unknown[] = ["yes", "no", "not_checked"]

/** A stored or drafted detail back into the form, defensively. */
export function accessFromDetail(detail: unknown): AccessDraft {
  const draft = emptyAccess()
  if (!isRecord(detail)) return draft
  const scope = detail.scope
  if (
    isRecord(scope) &&
    (typeof scope.subjectId === "string" || typeof scope.label === "string")
  )
    draft.scope = scope as PlaceRef
  if (isRecord(detail.features))
    for (const [key, v] of Object.entries(detail.features))
      if (FEATURE_VALUES.includes(v)) draft.features[key] = v as FeatureValue
  if (Array.isArray(detail.entrances))
    for (const item of detail.entrances)
      if (
        isRecord(item) &&
        typeof item.subjectId === "string" &&
        FEATURE_VALUES.includes(item.stepFree)
      )
        draft.entrances[item.subjectId] = item.stepFree as FeatureValue
  if (Array.isArray(detail.measurements))
    draft.measurements = detail.measurements
      .filter(isRecord)
      .map((m) =>
        measurementOf(m, typeof m.value === "number" ? String(m.value) : "")
      )
  return draft
}

function measurementOf(
  m: Record<string, unknown>,
  value: string
): MeasurementDraft {
  return {
    feature: typeof m.feature === "string" ? m.feature : "",
    value,
    unit:
      m.unit === "mm" || m.unit === "cm" || m.unit === "degrees" ? m.unit : "",
    measuredOn: typeof m.measuredOn === "string" ? m.measuredOn : "",
    method:
      m.method === "tape" || m.method === "gauge" || m.method === "other"
        ? m.method
        : "",
  }
}

/** The section a server error path belongs to (b03-design §14.3). */
export function accessFieldOf(path: string): AccessField | null {
  const match = /^detail\.(scope|features|measurements|entrances)\b/.exec(path)
  return match ? (match[1] as AccessField) : null
}

/** Server field errors (keyed by path) onto the sections. */
export function accessFieldErrors(
  fieldErrors: Partial<Record<string, string>> | undefined
): Partial<Record<AccessField, string>> {
  const out: Partial<Record<AccessField, string>> = {}
  for (const [path, message] of Object.entries(fieldErrors ?? {})) {
    if (!message) continue
    const field = accessFieldOf(path)
    if (field && !out[field]) out[field] = message
  }
  return out
}

/** "⟨Main entrance⟩" for a place ref, from the venue's places when known. */
export function scopeName(scope: PlaceRef, places: Place[]): string {
  if ("label" in scope) return scope.label
  return (
    places.find((p) => p.subjectId === scope.subjectId)?.label ?? "that place"
  )
}

/** A device draft's accessibility part (the form's own model), defensively. */
export function accessFromDraft(v: unknown): AccessDraft {
  const draft = emptyAccess()
  if (!isRecord(v)) return draft
  const { scope, features } = accessFromDetail({
    scope: v.scope,
    features: v.features,
  })
  draft.scope = scope
  draft.features = features
  if (Array.isArray(v.measurements))
    draft.measurements = v.measurements
      .filter(isRecord)
      .map((m) => measurementOf(m, typeof m.value === "string" ? m.value : ""))
  if (isRecord(v.entrances))
    for (const [id, value] of Object.entries(v.entrances))
      if (FEATURE_VALUES.includes(value))
        draft.entrances[id] = value as FeatureValue
  return draft
}
