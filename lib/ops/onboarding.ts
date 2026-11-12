/**
 * B10-03 venue onboarding records (b10-design §5.3). A record is JSON, one
 * file per venue, holding roles and counts only; named people stay in the
 * owner's own record (OD-B10-3). Every field is a sourced value, "not
 * applicable" with a reason, or "not recorded" with the owner role and the
 * milestone it is due by. Nothing is filled by inference.
 *
 * Schema 2 follows the owner scope correction of 11 Nov 2026: it records
 * NabaLens's own data model only. Website, NabaPresence and other external
 * destination fields are gone, and one fixed field states that boundary.
 */

import { OWNER_ROLES, type OwnerRole } from "./metrics"
import {
  isIsoInstant,
  isObject,
  personalDataProblems,
  type LintProblem,
  type RosterVenue,
} from "./roster"

export const ONBOARDING_SCHEMA = "b10-onboarding/2"
export const ONBOARDING_SCHEMA_V1 = "b10-onboarding/1"
export const DUE_BY = ["wave_entry", "wave_exit", "b10_exit"] as const
export type DueBy = (typeof DUE_BY)[number]

/** The fixed boundary every schema-2 record states (plan §15 exit gate, item 5). */
export const EXTERNAL_DESTINATIONS_OUT_OF_SCOPE =
  "Out of scope: owner scope correction of 11 Nov 2026 (OWNER-SCOPE-CORRECTION-20261111.md). No website, NabaPresence or other external destination is onboarded in B10."

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
    key: "identity.active",
    section: "A",
    label: "Venue active in NabaLens (venues.active)",
    owner: "COORD",
    dueBy: "wave_entry",
  },
  {
    key: "accounts.manager_accounts",
    section: "B",
    label: "Active manager accounts (count)",
    owner: "COORD",
    dueBy: "wave_entry",
  },
  {
    key: "accounts.staff",
    section: "B",
    label:
      "Active staff accounts (count, by department only: FOH, BOH, unassigned)",
    owner: "COORD",
    dueBy: "wave_entry",
  },
  {
    key: "accounts.staff_with_legacy_grant",
    section: "B",
    label:
      "Active staff accounts holding an open venue-manager grant (count, R28)",
    owner: "COORD",
    dueBy: "wave_entry",
  },
  {
    key: "accounts.admins",
    section: "B",
    label: "Admins acting for the venue (count)",
    owner: "PO",
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
    key: "knowledge.amenities_enabled",
    section: "C",
    label: "Amenities enabled for the venue (date; enabling is one-way)",
    owner: "COORD",
    dueBy: "wave_entry",
  },
  {
    key: "knowledge.amenity_checks",
    section: "C",
    label: "Active amenity checks (count, by progress)",
    owner: "COORD",
    dueBy: "wave_entry",
  },
  {
    key: "knowledge.working_list",
    section: "C",
    label: "Question keys open on the knowledge working list now",
    owner: "COORD",
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
    label: "Active menu versions (count) and latest activation date",
    owner: "COORD",
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
    key: "coverage.requirements",
    section: "E",
    label: "Coverage checklist items (count, by status)",
    owner: "COORD",
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
    key: "targets.venue_monthly",
    section: "E",
    label: "Venue monthly completion target in force this London month",
    owner: "COORD",
    dueBy: "wave_entry",
  },
  {
    key: "targets.staff_this_month",
    section: "E",
    label: "Staff targets this London month (set, needs setup)",
    owner: "COORD",
    dueBy: "wave_entry",
  },
  {
    key: "switches.b01_fallback",
    section: "E",
    label: "Venue held on the B01 Home or Add entry (SW-04, SW-05)",
    owner: "OPS",
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
    key: "scope.external_destinations",
    section: "G",
    label: "External destinations (websites, NabaPresence)",
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

/** Fields an aggregate read (scripts/ops/b10-onboarding-aggregate.sql) fills. */
export const AGGREGATE_FIELDS = [
  "identity.active",
  "accounts.manager_accounts",
  "accounts.staff",
  "accounts.staff_with_legacy_grant",
  "knowledge.amenities_enabled",
  "knowledge.amenity_checks",
  "knowledge.working_list",
  "menus.active_version",
  "coverage.requirements",
  "targets.venue_monthly",
  "targets.staff_this_month",
] as const

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

const notRecordedFor = (field: OnboardingField): FieldEntry => ({
  notRecorded: { owner: field.owner, dueBy: field.dueBy },
})

/** A record with the identity fields copied from the roster; all else not recorded. */
export function identityOnlyRecord(input: {
  venue: RosterVenue
  rosterSource: string
  updatedAt: string
}): OnboardingRecord {
  const fields: Record<string, FieldEntry> = {}
  for (const field of ONBOARDING_FIELDS)
    fields[field.key] = notRecordedFor(field)
  const { venue, rosterSource } = input
  fields["identity.venue_id"] = { value: venue.id, source: rosterSource }
  fields["identity.slug"] = { value: venue.slug, source: rosterSource }
  fields["identity.name"] = { value: venue.name, source: rosterSource }
  fields["identity.active"] = {
    value: venue.active ? "yes" : "no",
    source: rosterSource,
  }
  fields["scope.external_destinations"] = {
    notApplicable: EXTERNAL_DESTINATIONS_OUT_OF_SCOPE,
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

/**
 * Carries a schema-1 record to schema 2: every field both schemas share keeps
 * its entry as recorded; the website, NabaPresence, crosswalk and generation
 * fields are dropped (out of scope, not complete); new fields start not
 * recorded, except the fixed boundary. The record version goes up by one.
 */
export function upgradeV1Record(
  v1: OnboardingRecord | Record<string, unknown>,
  input: { venue: RosterVenue; rosterSource: string; updatedAt: string }
): { record: OnboardingRecord; dropped: string[] } {
  if (!isObject(v1) || v1.schema !== ONBOARDING_SCHEMA_V1)
    throw new Error(`not a ${ONBOARDING_SCHEMA_V1} record`)
  if (v1.venueId !== input.venue.id)
    throw new Error("record venue differs from the roster venue")
  const old = (isObject(v1.fields) ? v1.fields : {}) as Record<string, unknown>
  const record = identityOnlyRecord(input)
  const kept = new Set(ONBOARDING_FIELDS.map((f) => f.key))
  for (const [key, entry] of Object.entries(old))
    if (kept.has(key) && !key.startsWith("identity."))
      record.fields[key] = entry as FieldEntry
  record.recordVersion =
    (typeof v1.recordVersion === "number" ? v1.recordVersion : 0) + 1
  return {
    record,
    dropped: Object.keys(old).filter((key) => !kept.has(key)),
  }
}

export type VenueAggregate = {
  venueId: string
  active: boolean
  managerAccounts: number
  staff: { foh: number; boh: number; unassigned: number }
  staffWithLegacyGrant: number
  amenitiesEnabledOn: string | null
  amenityChecks: Record<string, number>
  workingListKeys: string[]
  activeMenuVersions: number
  activeMenuActivatedOn: string | null
  coverageRequirements: Record<string, number>
  venueMonthlyTarget: number | null
  staffTargetsThisMonth: { set: number; needsSetup: number }
  londonMonth: string
}

const count = (n: unknown) =>
  typeof n === "number" && Number.isInteger(n) && n >= 0
const counts = (o: unknown) => isObject(o) && Object.values(o).every(count)
const dateOrNull = (d: unknown) =>
  d === null || (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))

/** Problems in one venue's aggregate row; it must hold IDs, counts, keys and dates only. */
export function aggregateProblems(row: unknown): string[] {
  if (!isObject(row)) return ["is not an object"]
  const problems: string[] = []
  const expected =
    "active,activeMenuActivatedOn,activeMenuVersions,amenitiesEnabledOn,amenityChecks,coverageRequirements,londonMonth,managerAccounts,staff,staffTargetsThisMonth,staffWithLegacyGrant,venueId,venueMonthlyTarget,workingListKeys"
  if (Object.keys(row).sort().join(",") !== expected)
    problems.push(`keys must be ${expected}`)
  if (typeof row.active !== "boolean") problems.push("active")
  for (const k of [
    "managerAccounts",
    "staffWithLegacyGrant",
    "activeMenuVersions",
  ] as const)
    if (!count(row[k])) problems.push(k)
  if (
    !isObject(row.staff) ||
    Object.keys(row.staff).sort().join(",") !== "boh,foh,unassigned" ||
    !counts(row.staff)
  )
    problems.push("staff")
  if (
    !isObject(row.staffTargetsThisMonth) ||
    Object.keys(row.staffTargetsThisMonth).sort().join(",") !==
      "needsSetup,set" ||
    !counts(row.staffTargetsThisMonth)
  )
    problems.push("staffTargetsThisMonth")
  for (const k of ["amenityChecks", "coverageRequirements"] as const)
    if (!counts(row[k])) problems.push(k)
  for (const k of ["amenitiesEnabledOn", "activeMenuActivatedOn"] as const)
    if (!dateOrNull(row[k])) problems.push(k)
  if (!(row.venueMonthlyTarget === null || count(row.venueMonthlyTarget)))
    problems.push("venueMonthlyTarget")
  if (
    !Array.isArray(row.workingListKeys) ||
    !row.workingListKeys.every(
      (k) => typeof k === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(k)
    )
  )
    problems.push("workingListKeys")
  if (
    typeof row.londonMonth !== "string" ||
    !/^\d{4}-\d{2}$/.test(row.londonMonth)
  )
    problems.push("londonMonth")
  return problems
}

const breakdown = (o: Record<string, number>) => {
  const parts = Object.entries(o)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${k} ${n}`)
  return parts.length ? parts.join(", ") : "none"
}

/**
 * Fills the aggregate fields of a record from one venue's aggregate row. Only
 * the AGGREGATE_FIELDS change; every value carries the aggregate's source.
 */
export function applyAggregate(
  record: OnboardingRecord,
  row: VenueAggregate,
  input: { source: string; updatedAt: string }
): OnboardingRecord {
  const problems = aggregateProblems(row)
  if (problems.length)
    throw new Error(`aggregate row is malformed: ${problems.join(", ")}`)
  if (row.venueId !== record.venueId)
    throw new Error("aggregate row is for another venue")
  const total = row.staff.foh + row.staff.boh + row.staff.unassigned
  const values: Record<(typeof AGGREGATE_FIELDS)[number], string | number> = {
    "identity.active": row.active ? "yes" : "no",
    "accounts.manager_accounts": row.managerAccounts,
    "accounts.staff": `${total} (FOH ${row.staff.foh}, BOH ${row.staff.boh}, unassigned ${row.staff.unassigned})`,
    "accounts.staff_with_legacy_grant": row.staffWithLegacyGrant,
    "knowledge.amenities_enabled": row.amenitiesEnabledOn ?? "no",
    "knowledge.amenity_checks": breakdown(row.amenityChecks),
    "knowledge.working_list": row.workingListKeys.length
      ? [...row.workingListKeys].sort().join(", ")
      : "none",
    "menus.active_version": `${row.activeMenuVersions} active; latest activation ${row.activeMenuActivatedOn ?? "none"}`,
    "coverage.requirements": breakdown(row.coverageRequirements),
    "targets.venue_monthly":
      row.venueMonthlyTarget === null
        ? `none in force for ${row.londonMonth}`
        : `${row.venueMonthlyTarget} for ${row.londonMonth}`,
    "targets.staff_this_month": `${row.londonMonth}: set ${row.staffTargetsThisMonth.set}, needs setup ${row.staffTargetsThisMonth.needsSetup}`,
  }
  const fields = { ...record.fields }
  for (const key of AGGREGATE_FIELDS)
    fields[key] = { value: values[key], source: input.source }
  return {
    ...record,
    recordVersion: record.recordVersion + 1,
    updatedAt: input.updatedAt,
    updatedByRole: "COORD",
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
  const scopeEntry = fields["scope.external_destinations"]
  if (
    !isObject(scopeEntry) ||
    scopeEntry.notApplicable !== EXTERNAL_DESTINATIONS_OUT_OF_SCOPE
  )
    problems.push({
      path: "$.fields.scope.external_destinations",
      message: "must state the owner's out-of-scope boundary exactly",
    })
  const active = value("identity.active")
  if (active !== undefined && venue && active !== (venue.active ? "yes" : "no"))
    problems.push({
      path: "$.fields.identity.active",
      message: "differs from the roster",
    })
  problems.push(...personalDataProblems(record, "$"))
  return problems
}
