/**
 * B10-03 venue onboarding records (b10-design §5.3). A record is JSON, one
 * file per venue, holding roles and counts only; named people stay in the
 * owner's own record (OD-B10-3). Every field is a sourced value, "not
 * applicable" with a reason, or "not recorded" with the owner role and the
 * milestone it is due by. Nothing is filled by inference.
 */

import { OWNER_ROLES, type OwnerRole } from "./metrics"
import {
  isIsoInstant,
  isObject,
  personalDataProblems,
  type LintProblem,
  type RosterVenue,
} from "./roster"

export const ONBOARDING_SCHEMA = "b10-onboarding/1"
export const DUE_BY = ["wave_entry", "wave_exit", "b10_exit"] as const
export type DueBy = (typeof DUE_BY)[number]
export const SITE_GENERATIONS = ["A", "B", "C", "D"] as const
export const CROSSWALK_STATUSES = ["probable", "verified"] as const

export type OnboardingField = {
  key: string
  section: "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "S"
  label: string
  owner: OwnerRole
  dueBy: DueBy
}

export const ONBOARDING_FIELDS: readonly OnboardingField[] = [
  {
    key: "identity.venue_id",
    section: "A",
    label: "NabaLens venue UUID",
    owner: "COORD",
    dueBy: "wave_entry",
  },
  {
    key: "identity.slug",
    section: "A",
    label: "NabaLens slug",
    owner: "COORD",
    dueBy: "wave_entry",
  },
  {
    key: "identity.name",
    section: "A",
    label: "NabaLens name",
    owner: "COORD",
    dueBy: "wave_entry",
  },
  {
    key: "identity.crosswalk_status",
    section: "A",
    label: "Crosswalk row status (probable or verified, X8)",
    owner: "PO",
    dueBy: "wave_entry",
  },
  {
    key: "identity.website",
    section: "A",
    label: "Website repository, Vercel project and live guest domain",
    owner: "WS5",
    dueBy: "wave_entry",
  },
  {
    key: "identity.generation",
    section: "A",
    label: "Agent-surface generation (A to D)",
    owner: "WS5",
    dueBy: "wave_entry",
  },
  {
    key: "identity.nabapresence_location",
    section: "A",
    label:
      "NabaPresence organisation, location and google_location_name, or none intended (X6)",
    owner: "WS5",
    dueBy: "b10_exit",
  },
  {
    key: "accounts.manager_accounts",
    section: "B",
    label: "Manager accounts (count)",
    owner: "COORD",
    dueBy: "wave_entry",
  },
  {
    key: "accounts.staff",
    section: "B",
    label: "Staff accounts (count, by department only)",
    owner: "COORD",
    dueBy: "wave_entry",
  },
  {
    key: "accounts.staff_with_legacy_grant",
    section: "B",
    label: "Staff accounts with a legacy manager grant (count)",
    owner: "COORD",
    dueBy: "wave_entry",
  },
  {
    key: "accounts.admins",
    section: "B",
    label: "Admins acting for the venue (count)",
    owner: "COORD",
    dueBy: "wave_entry",
  },
  {
    key: "accounts.capabilities",
    section: "B",
    label:
      "Capability matrix rows 1 to 10: needed here, and allowed by the release in force",
    owner: "PO",
    dueBy: "wave_entry",
  },
  {
    key: "accounts.one_account_gaps",
    section: "B",
    label: "One-account gaps OA1 to OA9 that apply, with the owner's answers",
    owner: "PO",
    dueBy: "wave_entry",
  },
  {
    key: "questions.selected_set",
    section: "C",
    label:
      "Selected question keys with registry version, confirmation and self-confirmation rules",
    owner: "PO",
    dueBy: "wave_entry",
  },
  {
    key: "confirmers.by_family",
    section: "D",
    label:
      "Confirming role per family or key (named person in the owner record)",
    owner: "PO",
    dueBy: "wave_entry",
  },
  {
    key: "review.freshness_policies",
    section: "D",
    label: "Freshness policy per use (OD-15)",
    owner: "PO",
    dueBy: "wave_entry",
  },
  {
    key: "review.recheck_owner",
    section: "D",
    label: "Recheck owner role",
    owner: "PO",
    dueBy: "wave_entry",
  },
  {
    key: "review.to_confirm_cadence",
    section: "D",
    label: "To confirm review cadence",
    owner: "VM",
    dueBy: "wave_entry",
  },
  {
    key: "menus.active_version",
    section: "E",
    label: "Active menu version and activation date",
    owner: "WS3",
    dueBy: "wave_entry",
  },
  {
    key: "menus.field_authority",
    section: "E",
    label: "Menu field authority switches (OD-B4-1)",
    owner: "PO",
    dueBy: "wave_entry",
  },
  {
    key: "targets.policy",
    section: "E",
    label: "Monthly target policy and start month",
    owner: "PO",
    dueBy: "wave_entry",
  },
  {
    key: "devices.readiness",
    section: "F",
    label: "Devices tested at the venue (physical evidence only, X3)",
    owner: "VM",
    dueBy: "wave_entry",
  },
  {
    key: "consumers.internal_reader",
    section: "G",
    label: "Internal reader consumers holding this venue",
    owner: "WS5",
    dueBy: "wave_entry",
  },
  {
    key: "consumers.website",
    section: "G",
    label: "Website destination and its manifest (B10-07 row)",
    owner: "WS5",
    dueBy: "b10_exit",
  },
  {
    key: "consumers.nabapresence",
    section: "G",
    label: "NabaPresence destination (B10-07 row)",
    owner: "WS5",
    dueBy: "b10_exit",
  },
  {
    key: "consumers.boundary",
    section: "G",
    label: "Recorded boundary when no external destination is intended",
    owner: "PO",
    dueBy: "b10_exit",
  },
  {
    key: "training.sessions",
    section: "H",
    label: "Training sessions held (modules, dates, role kinds)",
    owner: "PO",
    dueBy: "wave_entry",
  },
  {
    key: "wave.assignment",
    section: "H",
    label: "Wave (OD-B10-5)",
    owner: "COORD",
    dueBy: "wave_entry",
  },
  {
    key: "wave.observation_window",
    section: "H",
    label: "Observation window (dates and active service days)",
    owner: "VM",
    dueBy: "wave_exit",
  },
  {
    key: "readiness.decision",
    section: "H",
    label: "Readiness decision with reason",
    owner: "PO",
    dueBy: "wave_exit",
  },
  {
    key: "signoff.product_owner",
    section: "S",
    label: "Product owner sign-off date",
    owner: "PO",
    dueBy: "wave_entry",
  },
  {
    key: "signoff.venue_manager",
    section: "S",
    label: "Venue manager sign-off date",
    owner: "VM",
    dueBy: "wave_entry",
  },
]

export type FieldEntry =
  | { value: string | number; source: string }
  | { notApplicable: string }
  | { notRecorded: { owner: OwnerRole; dueBy: DueBy } }

export type OnboardingRecord = {
  schema: typeof ONBOARDING_SCHEMA
  venueId: string
  recordVersion: number
  updatedAt: string
  updatedByRole: OwnerRole
  fields: Record<string, FieldEntry>
}

/** A record with the identity fields copied from the roster and crosswalk; all else not recorded. */
export function identityOnlyRecord(input: {
  venue: RosterVenue
  rosterSource: string
  crosswalkStatus: (typeof CROSSWALK_STATUSES)[number]
  crosswalkSource: string
  generation: (typeof SITE_GENERATIONS)[number]
  generationSource: string
  updatedAt: string
}): OnboardingRecord {
  const fields: Record<string, FieldEntry> = {}
  for (const field of ONBOARDING_FIELDS)
    fields[field.key] = {
      notRecorded: { owner: field.owner, dueBy: field.dueBy },
    }
  const { venue, rosterSource } = input
  fields["identity.venue_id"] = { value: venue.id, source: rosterSource }
  fields["identity.slug"] = { value: venue.slug, source: rosterSource }
  fields["identity.name"] = { value: venue.name, source: rosterSource }
  fields["identity.crosswalk_status"] = {
    value: input.crosswalkStatus,
    source: input.crosswalkSource,
  }
  fields["identity.generation"] = {
    value: input.generation,
    source: input.generationSource,
  }
  return {
    schema: ONBOARDING_SCHEMA,
    venueId: venue.id,
    recordVersion: 1,
    updatedAt: input.updatedAt,
    updatedByRole: "WS6",
    fields,
  }
}

const nonEmpty = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0

function entryProblems(entry: unknown, path: string): LintProblem[] {
  if (!isObject(entry)) return [{ path, message: "is not an object" }]
  const keys = Object.keys(entry).sort().join(",")
  if (keys === "source,value" || keys === "value" || keys === "source") {
    const ok =
      (nonEmpty(entry.value) ||
        (typeof entry.value === "number" && Number.isFinite(entry.value))) &&
      nonEmpty(entry.source)
    return ok ? [] : [{ path, message: "needs a value and its source" }]
  }
  if (keys === "notApplicable")
    return nonEmpty(entry.notApplicable)
      ? []
      : [{ path, message: "not applicable needs a reason" }]
  if (keys === "notRecorded") {
    const nr = entry.notRecorded
    const ok =
      isObject(nr) &&
      Object.keys(nr).sort().join(",") === "dueBy,owner" &&
      (OWNER_ROLES as readonly unknown[]).includes(nr.owner) &&
      (DUE_BY as readonly unknown[]).includes(nr.dueBy)
    return ok
      ? []
      : [
          {
            path,
            message: "not recorded needs an owner role and a due milestone",
          },
        ]
  }
  return [
    {
      path,
      message:
        "must be exactly one of { value, source }, { notApplicable } or { notRecorded }",
    },
  ]
}

export function lintOnboardingRecord(
  record: unknown,
  roster: readonly RosterVenue[],
  fileVenueId?: string
): LintProblem[] {
  if (!isObject(record)) return [{ path: "$", message: "is not an object" }]
  const problems: LintProblem[] = []
  const expectedTop =
    "fields,recordVersion,schema,updatedAt,updatedByRole,venueId"
  if (Object.keys(record).sort().join(",") !== expectedTop)
    problems.push({ path: "$", message: `keys must be ${expectedTop}` })
  if (record.schema !== ONBOARDING_SCHEMA)
    problems.push({ path: "$.schema", message: `must be ${ONBOARDING_SCHEMA}` })
  const venue = roster.find((v) => v.id === record.venueId)
  if (!venue)
    problems.push({ path: "$.venueId", message: "is not in the roster" })
  if (fileVenueId !== undefined && fileVenueId !== record.venueId)
    problems.push({
      path: "$.venueId",
      message: "does not match the file name",
    })
  if (!(
    Number.isInteger(record.recordVersion) &&
    (record.recordVersion as number) >= 1
  ))
    problems.push({
      path: "$.recordVersion",
      message: "must be a whole number from 1",
    })
  if (!isIsoInstant(record.updatedAt))
    problems.push({ path: "$.updatedAt", message: "must be a UTC instant" })
  if (!(OWNER_ROLES as readonly unknown[]).includes(record.updatedByRole))
    problems.push({ path: "$.updatedByRole", message: "is not an owner role" })
  const fields = record.fields
  if (!isObject(fields)) {
    problems.push({ path: "$.fields", message: "is not an object" })
    return problems
  }
  const known = new Set(ONBOARDING_FIELDS.map((f) => f.key))
  for (const key of Object.keys(fields))
    if (!known.has(key))
      problems.push({
        path: `$.fields.${key}`,
        message: "is not a template field",
      })
  for (const field of ONBOARDING_FIELDS) {
    const path = `$.fields.${field.key}`
    const entry = fields[field.key]
    if (entry === undefined) {
      problems.push({ path, message: "is missing" })
      continue
    }
    problems.push(...entryProblems(entry, path))
  }
  const value = (key: string) => {
    const e = fields[key]
    return isObject(e) && "value" in e ? e.value : undefined
  }
  if (venue) {
    const identity: [string, string][] = [
      ["identity.venue_id", venue.id],
      ["identity.slug", venue.slug],
      ["identity.name", venue.name],
    ]
    for (const [key, expected] of identity) {
      const v = value(key)
      if (v !== undefined && v !== expected)
        problems.push({
          path: `$.fields.${key}`,
          message: "differs from the roster",
        })
      if (isObject(fields[key]) && "notApplicable" in (fields[key] as object))
        problems.push({
          path: `$.fields.${key}`,
          message: "identity is always applicable",
        })
    }
  }
  const crosswalk = value("identity.crosswalk_status")
  if (
    crosswalk !== undefined &&
    !(CROSSWALK_STATUSES as readonly unknown[]).includes(crosswalk)
  )
    problems.push({
      path: "$.fields.identity.crosswalk_status",
      message: "must be probable or verified",
    })
  const generation = value("identity.generation")
  if (
    generation !== undefined &&
    !(SITE_GENERATIONS as readonly unknown[]).includes(generation)
  )
    problems.push({
      path: "$.fields.identity.generation",
      message: "must be A, B, C or D",
    })
  problems.push(...personalDataProblems(record, "$"))
  return problems
}
