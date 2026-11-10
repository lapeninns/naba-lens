// The value validator for B03 question schemas (docs/knowledge/b03-design.md
// §3.3, §4). Mirrors private.knowledge_validate_value and
// private.knowledge_detail_problems: the same schemas, the same field paths
// and problem codes in the same order; a shared fixture set runs through
// both. Checks that need the venue (places, entrances) are the database's.

import type { WifiMetadata } from "@/lib/amenities/contract"
import type {
  ValueFieldProblem,
  ValueSchemaName,
} from "@/lib/knowledge/contract"
import { parseWifi } from "@/lib/server/amenities/validate"

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

/** private.knowledge_safe_date: a real calendar date written YYYY-MM-DD. */
export function safeDate(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const [y, m, d] = v.split("-").map(Number) as [number, number, number]
  if (y < 1 || m < 1 || m > 12 || d < 1) return null
  const days = new Date(Date.UTC(2000, m, 0)).getUTCDate()
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  if (d > (m === 2 ? (leap ? 29 : 28) : days)) return null
  return v
}

/** Today's date in London, YYYY-MM-DD (private.london_today). */
export function londonToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

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
      else if (v.state === "temporarily_unavailable")
        // Refused until the consumers show it as qualified (§3.8 gate, B03-c).
        add("detail.availability.state", "not_allowed")
      else if (
        typeof v.state !== "string" ||
        !["available", "on_request", "seasonal"].includes(v.state)
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
  now: Date = new Date()
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
    } else {
      fields.push(...detailProblems(schema, given, now))
      normalised = given as Record<string, unknown>
    }
  }
  // An accessibility answer other than Unknown says where it applies (§4.3).
  if (
    schema === "accessibility" &&
    headline !== "unknown" &&
    (given === null || !hasKey(given, "scope"))
  )
    fields.push({ path: "detail.scope", problem: "required" })

  if (fields.length) return { ok: false, reason: "invalid_value", fields }
  return { ok: true, headline: headline as Headline, detail: normalised }
}
