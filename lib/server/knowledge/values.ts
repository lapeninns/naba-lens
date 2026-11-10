// The value validator for B03 question schemas (docs/knowledge/b03-design.md
// §3.3). Mirrors private.knowledge_validate_value: the same schemas, the
// same field paths and problem codes; a shared fixture set runs through both.

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
  | { ok: true; headline: Headline; detail: WifiMetadata | null }
  | { ok: false; reason: "unknown_value_schema" }
  | { ok: false; reason: "invalid_value"; fields: ValueFieldProblem[] }

/** The schemas this build supports; later batches add the others. */
const SUPPORTED: Record<string, true> = {
  "presence@1": true,
  "connectivity.wifi@1": true,
}

const isEmptyDetail = (v: unknown) =>
  v === null ||
  v === undefined ||
  (typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v as object).length === 0)

function wifiDetail(v: unknown, now: Date): WifiMetadata | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  const record = v as Record<string, unknown>
  if (Object.keys(record).some((k) => !WIFI_KEYS.includes(k))) return null
  if (
    typeof record.testSpot !== "string" ||
    typeof record.testedOn !== "string" ||
    typeof record.downloadMbps !== "number" ||
    typeof record.uploadMbps !== "number"
  )
    return null
  const parsed = parseWifi(record, now)
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

  let normalised: WifiMetadata | null = null
  if (!isEmptyDetail(detail)) {
    if (schema === "presence")
      fields.push({ path: "detail", problem: "not_allowed" })
    else {
      normalised = wifiDetail(detail, now)
      if (!normalised) fields.push({ path: "detail", problem: "invalid" })
    }
  }
  if (fields.length) return { ok: false, reason: "invalid_value", fields }
  return { ok: true, headline: headline as Headline, detail: normalised }
}
