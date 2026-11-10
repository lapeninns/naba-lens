// The value validator for B03 question schemas (docs/knowledge/b03-design.md
// §3.3, §4, §5.1). Mirrors private.knowledge_validate_value,
// private.knowledge_detail_problems and private.knowledge_policy_problems:
// the same schemas, the same field paths and problem codes in the same order;
// a shared fixture set runs through both. Checks that need the venue or the
// question (places, entrances, a version's features) are the database's.
// Policy condition and exception types come from the value lists (A4), which
// the caller passes; both are empty until the owner supplies them (OD-14).

import type { WifiMetadata } from "@/lib/amenities/contract"
import type {
  ValueFieldProblem,
  ValueSchemaName,
} from "@/lib/knowledge/contract"
import { parseWifi } from "@/lib/server/amenities/validate"

import { londonToday, safeDate } from "./dates"
import { scheduleProblems, scheduleWindowProblems } from "./schedules"

export { londonToday, safeDate }

const HEADLINES = ["yes", "no", "not_applicable", "unknown"] as const
type Headline = (typeof HEADLINES)[number]

const WIFI_KEYS = ["testSpot", "testedOn", "downloadMbps", "uploadMbps"]

export type ValidatedValue =
  | {
      ok: true
      headline: Headline
      detail: WifiMetadata | Record<string, unknown> | null
    }
  | { ok: false; reason: "unknown_value_schema" }
  | { ok: false; reason: "invalid_value"; fields: ValueFieldProblem[] }

/** The schemas this build supports; later batches add the others. */
const SUPPORTED: Record<string, true> = {
  "presence@1": true,
  "connectivity.wifi@1": true,
  "facility@1": true,
  "accessibility@1": true,
  "policy@1": true,
  "service@1": true,
  "schedule_event@1": true,
}

/** Active codes of the value lists (public.knowledge_value_list, A4, A9). */
export type PolicyValueLists = {
  conditionTypes: readonly string[]
  exceptionTypes: readonly string[]
  broadcasters?: readonly string[]
}
const NO_LISTS: PolicyValueLists = { conditionTypes: [], exceptionTypes: [] }

const POLICY_KEYS = [
  "stance",
  "zones",
  "conditions",
  "exceptions",
  "policyScope",
  "authority",
]
const STANCES = [
  "allowed",
  "not_allowed",
  "conditional",
  "not_applicable",
  "unknown",
]
/** The B01 answer a stance is stored as (Conditional is a qualified Yes). */
const STANCE_HEADLINE: Record<string, string> = {
  allowed: "yes",
  conditional: "yes",
  not_allowed: "no",
  not_applicable: "not_applicable",
  unknown: "unknown",
}

const FACILITY_KEYS = [
  "locations",
  "availability",
  "fees",
  "limitations",
  "howToRequest",
]
const ACCESSIBILITY_KEYS = [
  ...FACILITY_KEYS,
  "scope",
  "features",
  "measurements",
  "entrances",
]
const MEASUREMENT_KEYS = ["feature", "value", "unit", "measuredOn", "method"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FEATURE = /^[a-z_]{1,40}$/
const MAX_ITEMS = 20

type Problem = ValueFieldProblem["problem"]
type Json = Record<string, unknown>

const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const has = (o: Json, k: string) => Object.prototype.hasOwnProperty.call(o, k)
/** Characters, as Postgres length() counts them. */
const chars = (s: string) => Array.from(s).length
/** Postgres btrim(text): spaces only. */
const btrim = (s: string) => s.replace(/^ +| +$/g, "")
const onlyKeys = (o: Json, allowed: string[]) =>
  Object.keys(o).every((k) => allowed.includes(k))
/** jsonb `?`: an object key, an array string element, or the string itself. */
const hasKey = (v: unknown, k: string) =>
  isRecord(v)
    ? has(v, k)
    : Array.isArray(v)
      ? v.includes(k)
      : typeof v === "string" && v === k

const isEmptyDetail = (v: unknown) =>
  v === null || v === undefined || (isRecord(v) && Object.keys(v).length === 0)

/** private.knowledge_place_ref_problem: exactly one of subjectId or label. */
export function placeRefProblem(ref: unknown): Problem | null {
  if (!isRecord(ref) || !onlyKeys(ref, ["subjectId", "label"])) return "invalid"
  if (has(ref, "subjectId") === has(ref, "label")) return "invalid"
  if (has(ref, "subjectId"))
    return typeof ref.subjectId === "string" && UUID.test(ref.subjectId)
      ? null
      : "invalid"
  if (typeof ref.label !== "string") return "invalid"
  const length = chars(btrim(ref.label))
  if (length === 0) return "required"
  if (length > 80) return "too_long"
  return null
}

const inRange = (n: number) => n >= 0 && n <= 100000

function detailProblems(
  schema: string,
  detail: unknown,
  now: Date
): ValueFieldProblem[] {
  const out: ValueFieldProblem[] = []
  const add = (path: string, problem: Problem) => out.push({ path, problem })
  if (!isRecord(detail)) return [{ path: "detail", problem: "invalid" }]
  const allowed =
    schema === "accessibility" ? ACCESSIBILITY_KEYS : FACILITY_KEYS
  for (const key of Object.keys(detail).sort())
    if (!allowed.includes(key)) add(`detail.${key}`, "not_allowed")

  if (has(detail, "locations")) {
    const list = detail.locations
    if (!Array.isArray(list) || list.length > MAX_ITEMS)
      add("detail.locations", "invalid")
    else
      list.forEach((ref, i) => {
        const problem = placeRefProblem(ref)
        if (problem) add(`detail.locations[${i}]`, problem)
      })
  }

  if (has(detail, "availability")) {
    const v = detail.availability
    if (!isRecord(v) || !onlyKeys(v, ["state", "until", "note"]))
      add("detail.availability", "invalid")
    else {
      if (!has(v, "state")) add("detail.availability.state", "required")
      else if (
        typeof v.state !== "string" ||
        ![
          "available",
          "on_request",
          "seasonal",
          "temporarily_unavailable",
        ].includes(v.state)
      )
        add("detail.availability.state", "invalid")
      if (has(v, "until") && !safeDate(v.until))
        add("detail.availability.until", "invalid")
      if (has(v, "note") && typeof v.note !== "string")
        add("detail.availability.note", "invalid")
      else if (typeof v.note === "string" && chars(v.note) > 500)
        add("detail.availability.note", "too_long")
    }
  }

  if (has(detail, "fees")) {
    const v = detail.fees
    if (!isRecord(v) || !onlyKeys(v, ["kind", "amount", "unit"]))
      add("detail.fees", "invalid")
    else {
      if (!has(v, "kind")) add("detail.fees.kind", "required")
      else if (
        typeof v.kind !== "string" ||
        !["free", "charged", "not_recorded"].includes(v.kind)
      )
        add("detail.fees.kind", "invalid")
      if (has(v, "amount")) {
        const amount = v.amount
        if (v.kind !== "charged") add("detail.fees.amount", "not_allowed")
        else if (
          !isRecord(amount) ||
          !onlyKeys(amount, ["value", "currency"]) ||
          typeof amount.value !== "number" ||
          amount.currency !== "GBP"
        )
          add("detail.fees.amount", "invalid")
        else if (!inRange(amount.value))
          add("detail.fees.amount", "out_of_range")
      }
      if (has(v, "unit") && typeof v.unit !== "string")
        add("detail.fees.unit", "invalid")
      else if (typeof v.unit === "string" && chars(v.unit) > 40)
        add("detail.fees.unit", "too_long")
    }
  }

  for (const [key, max] of [
    ["limitations", 2000],
    ["howToRequest", 500],
  ] as const)
    if (has(detail, key)) {
      const v = detail[key]
      if (typeof v !== "string") add(`detail.${key}`, "invalid")
      else if (chars(v) > max) add(`detail.${key}`, "too_long")
    }

  if (schema !== "accessibility") return out

  if (has(detail, "scope")) {
    const problem = placeRefProblem(detail.scope)
    if (problem) add("detail.scope", problem)
  }
  if (has(detail, "features")) {
    const v = detail.features
    if (!isRecord(v)) add("detail.features", "invalid")
    else
      for (const key of Object.keys(v).sort())
        if (
          !FEATURE.test(key) ||
          typeof v[key] !== "string" ||
          !["yes", "no", "not_checked"].includes(v[key] as string)
        )
          add(`detail.features.${key}`, "invalid")
  }
  if (has(detail, "measurements")) {
    const list = detail.measurements
    if (!Array.isArray(list) || list.length > MAX_ITEMS)
      add("detail.measurements", "invalid")
    else
      list.forEach((item: unknown, i) => {
        const path = `detail.measurements[${i}]`
        if (!isRecord(item) || !onlyKeys(item, MEASUREMENT_KEYS)) {
          add(path, "invalid")
          return
        }
        for (const key of MEASUREMENT_KEYS)
          if (!has(item, key)) add(`${path}.${key}`, "required")
        if (
          has(item, "feature") &&
          (typeof item.feature !== "string" || !FEATURE.test(item.feature))
        )
          add(`${path}.feature`, "invalid")
        if (has(item, "value")) {
          if (typeof item.value !== "number") add(`${path}.value`, "invalid")
          else if (!inRange(item.value)) add(`${path}.value`, "out_of_range")
        }
        if (
          has(item, "unit") &&
          (typeof item.unit !== "string" ||
            !["mm", "cm", "degrees"].includes(item.unit))
        )
          add(`${path}.unit`, "invalid")
        if (
          has(item, "method") &&
          (typeof item.method !== "string" ||
            !["tape", "gauge", "other"].includes(item.method))
        )
          add(`${path}.method`, "invalid")
        if (has(item, "measuredOn")) {
          const date = safeDate(item.measuredOn)
          if (!date) add(`${path}.measuredOn`, "invalid")
          else if (date > londonToday(now))
            add(`${path}.measuredOn`, "out_of_range")
        }
      })
  }
  if (has(detail, "entrances")) {
    const list = detail.entrances
    if (!Array.isArray(list) || list.length > MAX_ITEMS)
      add("detail.entrances", "invalid")
    else
      list.forEach((item: unknown, i) => {
        const path = `detail.entrances[${i}]`
        if (
          !isRecord(item) ||
          !onlyKeys(item, ["subjectId", "stepFree"]) ||
          typeof item.subjectId !== "string" ||
          !UUID.test(item.subjectId)
        )
          add(path, "invalid")
        else if (
          typeof item.stepFree !== "string" ||
          !["yes", "no", "not_checked"].includes(item.stepFree)
        )
          add(`${path}.stepFree`, "invalid")
      })
  }
  return out
}

/** private.knowledge_policy_problems (§5.1). */
function policyProblems(
  headline: unknown,
  detail: unknown,
  lists: PolicyValueLists,
  now: Date
): ValueFieldProblem[] {
  const out: ValueFieldProblem[] = []
  const add = (path: string, problem: Problem) => out.push({ path, problem })
  if (!isRecord(detail)) return [{ path: "detail", problem: "invalid" }]
  for (const key of Object.keys(detail).sort())
    if (!POLICY_KEYS.includes(key)) add(`detail.${key}`, "not_allowed")

  if (has(detail, "stance")) {
    const stance = detail.stance
    if (typeof stance !== "string" || !STANCES.includes(stance))
      add("detail.stance", "invalid")
    else if (
      HEADLINES.includes(headline as Headline) &&
      STANCE_HEADLINE[stance] !== headline
    )
      add("detail.stance", "invalid")
  }

  if (has(detail, "zones")) {
    const list = detail.zones
    if (!Array.isArray(list) || list.length > MAX_ITEMS)
      add("detail.zones", "invalid")
    else
      list.forEach((item: unknown, i) => {
        const path = `detail.zones[${i}]`
        if (!isRecord(item)) {
          add(path, "invalid")
          return
        }
        const { stance, ...ref } = item
        const problem = placeRefProblem(ref)
        if (problem) add(path, problem)
        if (!has(item, "stance")) add(`${path}.stance`, "required")
        else if (
          typeof stance !== "string" ||
          !["allowed", "not_allowed", "conditional"].includes(stance)
        )
          add(`${path}.stance`, "invalid")
      })
  }

  for (const key of ["conditions", "exceptions"] as const)
    if (has(detail, key)) {
      const codes =
        key === "conditions" ? lists.conditionTypes : lists.exceptionTypes
      const allowed =
        key === "conditions" ? ["type", "note", "value"] : ["type", "note"]
      const list = detail[key]
      if (!Array.isArray(list) || list.length > MAX_ITEMS)
        add(`detail.${key}`, "invalid")
      else
        list.forEach((item: unknown, i) => {
          const path = `detail.${key}[${i}]`
          if (!isRecord(item) || !onlyKeys(item, allowed)) {
            add(path, "invalid")
            return
          }
          if (!has(item, "type")) add(`${path}.type`, "required")
          else if (typeof item.type !== "string" || !codes.includes(item.type))
            add(`${path}.type`, "invalid")
          if (
            has(item, "value") &&
            typeof item.value !== "string" &&
            typeof item.value !== "number"
          )
            add(`${path}.value`, "invalid")
          else if (typeof item.value === "string" && chars(item.value) > 200)
            add(`${path}.value`, "too_long")
          if (has(item, "note") && typeof item.note !== "string")
            add(`${path}.note`, "invalid")
          else if (typeof item.note === "string" && chars(item.note) > 500)
            add(`${path}.note`, "too_long")
        })
    }

  if (
    has(detail, "policyScope") &&
    (typeof detail.policyScope !== "string" ||
      !["venue", "organisation"].includes(detail.policyScope))
  )
    add("detail.policyScope", "invalid")

  if (has(detail, "authority")) {
    const v = detail.authority
    if (
      !isRecord(v) ||
      !onlyKeys(v, ["basis", "statedOn", "source", "reference"])
    )
      add("detail.authority", "invalid")
    else {
      if (
        has(v, "basis") &&
        (typeof v.basis !== "string" ||
          !["venue_manager", "admin"].includes(v.basis))
      )
        add("detail.authority.basis", "invalid")
      if (has(v, "statedOn")) {
        const date = safeDate(v.statedOn)
        if (!date) add("detail.authority.statedOn", "invalid")
        else if (date > londonToday(now))
          add("detail.authority.statedOn", "out_of_range")
      }
      if (
        has(v, "source") &&
        (typeof v.source !== "string" ||
          !["in_person", "written_policy"].includes(v.source))
      )
        add("detail.authority.source", "invalid")
      if (has(v, "reference") && typeof v.reference !== "string")
        add("detail.authority.reference", "invalid")
      else if (typeof v.reference === "string" && chars(v.reference) > 200)
        add("detail.authority.reference", "too_long")
    }
  }
  return out
}

/** private.knowledge_service_problems (§6, B03-d). */
function serviceProblems(
  detail: unknown,
  lists: PolicyValueLists,
  now: Date
): ValueFieldProblem[] {
  const out: ValueFieldProblem[] = []
  const add = (path: string, problem: Problem) => out.push({ path, problem })
  if (!isRecord(detail)) return [{ path: "detail", problem: "invalid" }]
  for (const key of Object.keys(detail).sort())
    if (
      ![
        "schedule",
        "channels",
        "fees",
        "limitations",
        "availability",
        "broadcasters",
        "lastDayOffered",
      ].includes(key)
    )
      add(`detail.${key}`, "not_allowed")
  if (has(detail, "schedule"))
    out.push(...scheduleProblems("detail.schedule", detail.schedule))
  if (has(detail, "channels")) {
    const list = detail.channels
    if (!Array.isArray(list) || list.length > 10)
      add("detail.channels", "invalid")
    else
      list.forEach((c: unknown, i) => {
        if (
          typeof c !== "string" ||
          chars(btrim(c)) < 1 ||
          chars(btrim(c)) > 40
        )
          add(`detail.channels[${i}]`, "invalid")
      })
  }
  const facility: Json = {}
  for (const key of ["fees", "limitations", "availability"])
    if (has(detail, key)) facility[key] = detail[key]
  out.push(...detailProblems("facility", facility, now))
  if (has(detail, "broadcasters")) {
    const codes = lists.broadcasters ?? []
    const list = detail.broadcasters
    if (!Array.isArray(list) || list.length > MAX_ITEMS)
      add("detail.broadcasters", "invalid")
    else
      list.forEach((b: unknown, i) => {
        if (typeof b !== "string" || !codes.includes(b))
          add(`detail.broadcasters[${i}]`, "invalid")
      })
  }
  return out
}

/**
 * private.knowledge_service_stop_problems (A40): a stop date and a schedule
 * belong to an Offered answer; with a schedule, the stop date is its
 * effectiveTo. A stop date before today is the database's venue check.
 */
function serviceStopProblems(
  headline: unknown,
  detail: unknown
): ValueFieldProblem[] {
  const out: ValueFieldProblem[] = []
  const add = (path: string, problem: Problem) => out.push({ path, problem })
  if (!isRecord(detail)) return out
  const other = ["no", "not_applicable", "unknown"].includes(headline as string)
  if (has(detail, "lastDayOffered")) {
    const last = safeDate(detail.lastDayOffered)
    const schedule = detail.schedule
    if (other) add("detail.lastDayOffered", "not_allowed")
    else if (!last) add("detail.lastDayOffered", "invalid")
    else if (isRecord(schedule)) {
      if (!has(schedule, "effectiveTo"))
        add("detail.schedule.effectiveTo", "required")
      else {
        // An unreadable effectiveTo is already invalid (scheduleProblems).
        const to = safeDate(schedule.effectiveTo)
        if (to && to !== last)
          add("detail.schedule.effectiveTo", "out_of_range")
      }
    }
  }
  if (other && has(detail, "schedule")) add("detail.schedule", "not_allowed")
  return out
}

/** private.knowledge_schedule_event_problems (§6.3, §6.4, B03-d). */
function scheduleEventProblems(
  headline: unknown,
  detail: unknown
): ValueFieldProblem[] {
  const out: ValueFieldProblem[] = []
  const add = (path: string, problem: Problem) => out.push({ path, problem })
  if (!isRecord(detail)) return [{ path: "detail", problem: "invalid" }]
  for (const key of Object.keys(detail).sort())
    if (!["event", "cancelled", "limitations"].includes(key))
      add(`detail.${key}`, "not_allowed")
  if (has(detail, "event")) {
    const e = detail.event
    if (!isRecord(e) || !onlyKeys(e, ["title", "localDate", "start", "end"]))
      add("detail.event", "invalid")
    else {
      if (typeof e.title !== "string")
        add("detail.event.title", has(e, "title") ? "invalid" : "required")
      else if (chars(btrim(e.title)) === 0)
        add("detail.event.title", "required")
      else if (chars(e.title) > 120) add("detail.event.title", "too_long")
      if (!has(e, "localDate")) add("detail.event.localDate", "required")
      else if (!safeDate(e.localDate)) add("detail.event.localDate", "invalid")
      if (has(e, "start") || has(e, "end"))
        out.push(
          ...scheduleWindowProblems("detail.event.window", [
            { start: e.start ?? null, end: e.end ?? null },
          ])
        )
    }
  } else if (headline === "yes") add("detail.event", "required")
  if (
    has(detail, "cancelled") &&
    (typeof detail.cancelled !== "boolean" ||
      (detail.cancelled && headline !== "no"))
  )
    add("detail.cancelled", "invalid")
  if (has(detail, "limitations") && typeof detail.limitations !== "string")
    add("detail.limitations", "invalid")
  else if (
    typeof detail.limitations === "string" &&
    chars(detail.limitations) > 2000
  )
    add("detail.limitations", "too_long")
  return out
}

function wifiDetail(v: unknown, now: Date): WifiMetadata | null {
  if (!isRecord(v)) return null
  if (Object.keys(v).some((k) => !WIFI_KEYS.includes(k))) return null
  if (
    typeof v.testSpot !== "string" ||
    typeof v.testedOn !== "string" ||
    typeof v.downloadMbps !== "number" ||
    typeof v.uploadMbps !== "number"
  )
    return null
  const parsed = parseWifi(v, now)
  return parsed.ok ? parsed.value : null
}

export function validateKnowledgeValue(
  schema: ValueSchemaName | string,
  version: number,
  headline: unknown,
  detail: unknown,
  now: Date = new Date(),
  lists: PolicyValueLists = NO_LISTS
): ValidatedValue {
  if (!SUPPORTED[`${schema}@${version}`])
    return { ok: false, reason: "unknown_value_schema" }
  const fields: ValueFieldProblem[] = []
  if (headline === null || headline === undefined)
    fields.push({ path: "headline", problem: "required" })
  else if (!HEADLINES.includes(headline as Headline))
    fields.push({ path: "headline", problem: "not_allowed" })

  const given = isEmptyDetail(detail) ? null : detail
  let normalised: WifiMetadata | Record<string, unknown> | null = null
  if (given !== null) {
    if (schema === "presence")
      fields.push({ path: "detail", problem: "not_allowed" })
    else if (schema === "connectivity.wifi") {
      normalised = wifiDetail(given, now)
      if (!normalised) fields.push({ path: "detail", problem: "invalid" })
    } else if (schema === "policy") {
      fields.push(...policyProblems(headline, given, lists, now))
      normalised = given as Record<string, unknown>
    } else if (schema === "service") {
      fields.push(
        ...serviceProblems(given, lists, now),
        ...serviceStopProblems(headline, given)
      )
      normalised = given as Record<string, unknown>
    } else if (schema === "schedule_event") {
      fields.push(...scheduleEventProblems(headline, given))
      normalised = given as Record<string, unknown>
    } else {
      fields.push(...detailProblems(schema, given, now))
      normalised = given as Record<string, unknown>
    }
  }
  // An accessibility answer other than Unknown says where it applies (§4.3),
  // unless it lists entrances, which it then covers (A34).
  const entrances =
    isRecord(given) && Array.isArray(given.entrances)
      ? given.entrances.length
      : 0
  if (
    schema === "accessibility" &&
    headline !== "unknown" &&
    (given === null || !hasKey(given, "scope")) &&
    entrances === 0
  )
    fields.push({ path: "detail.scope", problem: "required" })

  if (fields.length) return { ok: false, reason: "invalid_value", fields }
  return { ok: true, headline: headline as Headline, detail: normalised }
}
