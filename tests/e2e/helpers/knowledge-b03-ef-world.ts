import { randomUUID } from "node:crypto"

import { expect, type Page, type Route } from "@playwright/test"

import type { Db } from "../../support/identities"
import { readyCheck, sessionOf, type AmenitiesWorld } from "./amenities-world"
import { psql } from "./stack"
import { createPeople, type Person, type Venue } from "./world"

/**
 * B03-E and B03-F fixtures on the isolated stack, over provisionAmenitiesWorld.
 * Questions go on the venue's knowledge working list, legacy facts are mapped
 * and imported, and history is recorded in each person's OWN session (the
 * admin's for the working list, mappings and runs; staff and managers for
 * findings and decisions). psql only inserts synthetic legacy facts, bumps a
 * synthetic fact's revision and reads state back, always scoped to explicit
 * fixture venue, check, fact and contribution ids. Every action under test
 * runs in a browser through the real UI.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const uuid = (id: string) => {
  if (!UUID.test(id)) throw new Error(`not a uuid: ${id}`)
  return `'${id}'::uuid`
}
const key = (k: string) => {
  if (!/^[a-z_]+$/.test(k)) throw new Error(`not a key: ${k}`)
  return `'${k}'`
}
const text = (v: string) => `'${v.replace(/'/g, "''")}'`

// ---- Knowledge RPCs in a person's own session -------------------------------------

type RpcError = { code: string; message: string; details?: string | null }

/** A knowledge RPC (not in the generated types) in the caller's own session. */
export async function knowledgeCall<T = unknown>(
  db: Db,
  fn: string,
  args: Record<string, unknown>
): Promise<{ data: T | null; error: RpcError | null }> {
  const rpc = db.rpc.bind(db) as unknown as (
    fn: string,
    args: unknown
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>
  const { data, error } = await rpc(fn, args)
  return { data: data as T | null, error }
}

export async function knowledgeOk<T = unknown>(
  db: Db,
  fn: string,
  args: Record<string, unknown>
): Promise<T> {
  const { data, error } = await knowledgeCall<T>(db, fn, args)
  if (error)
    throw new Error(
      `${fn}: ${error.message} (${error.code}) ${error.details ?? ""}`
    )
  return data as T
}

/** The slot revision the decision and correction RPCs check. */
export function slotRevision(venue: Pick<Venue, "id">, questionKey: string) {
  return Number(
    psql(
      `select private.knowledge_slot_revision(${uuid(venue.id)}, ${key(questionKey)})`
    )
  )
}

/**
 * Enables the venue's checks for `keys` (unassigned) and puts them on its
 * knowledge working list, in the admin's own session. Returns key -> check id.
 */
export async function knowledgeChecks(
  w: AmenitiesWorld,
  venue: Venue,
  keys: string[]
): Promise<Record<string, string>> {
  const checks: Record<string, string> = {}
  for (const k of keys) checks[k] = await readyCheck(w, venue, k, null)
  await knowledgeOk(await sessionOf(w.admin), "knowledge_set_working_list", {
    p_venue_id: venue.id,
    p_keys: keys,
    p_enabled: true,
    p_reason: `DEV FIXTURE B03-EF working list ${w.tag}`,
  })
  return checks
}

/** An ordinary staff member of `venue`, past first-run setup. */
export function addStaff(
  w: Pick<AmenitiesWorld, "tag">,
  venue: Venue,
  label: string
): Person {
  const [person] = createPeople(w.tag, [
    { label, role: "staff", venueId: venue.id, jobTitle: "Server" },
  ])
  psql(
    `update public.profiles set department = 'foh' where id = ${uuid(person!.id)}`
  )
  return person!
}

/**
 * A finding in the sender's own session. Without structured detail or a
 * Checked on date it is the legacy 16-argument knowledge_submit; with
 * either, the 19-argument one that validates them against the registry
 * version, as the capture form sends. `signature` says which was called.
 */
export async function sendFinding(
  db: Db,
  venue: Venue,
  checkId: string,
  questionKey: string,
  answer: "yes" | "no",
  o: {
    assets?: string[]
    reason?: string | null
    /** The registry version's structured detail, when it asks for one. */
    detail?: Record<string, unknown> | null
    /** The London day it was checked (YYYY-MM-DD), as chosen on the form. */
    observedOn?: string | null
  } = {}
) {
  const legacy = {
    p_check_id: checkId,
    p_slot_revision: slotRevision(venue, questionKey),
    p_idempotency_key: randomUUID(),
    p_kind: "finding",
    p_answer: answer,
    p_finding: null,
    p_limitations: null,
    p_reason: o.reason ?? null,
    p_unknown_preset: null,
    p_tried_text: null,
    p_change_reason: null,
    p_responds_to: null,
    p_asset_ids: o.assets ?? [],
    p_internal_metadata: null,
    p_redaction_confirmed: null,
    p_confirm_own: false,
  }
  const args =
    o.detail || o.observedOn
      ? {
          ...legacy,
          p_detail: o.detail ?? null,
          p_observed_on: o.observedOn ?? null,
          p_observed_on_source: o.observedOn ? "chosen" : null,
        }
      : legacy
  const out = await knowledgeOk<{ contributionId: string; outcome: string }>(
    db,
    "knowledge_submit",
    args
  )
  return { ...out, signature: Object.keys(args).length as 16 | 19 }
}

/** Confirms a finding in the decider's own session. */
export async function confirmFinding(
  db: Db,
  venue: Venue,
  questionKey: string,
  contributionId: string
) {
  return knowledgeOk(db, "knowledge_decide", {
    p_target_type: "contribution",
    p_target_id: contributionId,
    p_decision: "confirm",
    p_slot_revision: slotRevision(venue, questionKey),
    p_idempotency_key: randomUUID(),
    p_note: null,
  })
}

// ---- Legacy facts, mappings and imports ----------------------------------------------

/** A synthetic legacy fact (Coverage's venue_amenity_facts) at revision 1. */
export function seedLegacyFact(
  venue: Pick<Venue, "id">,
  legacyKey: string,
  presence: "present" | "absent",
  facts: string
): string {
  const id = randomUUID()
  psql(`insert into public.venue_amenity_facts (id, venue_id, amenity_key, presence, facts)
    values (${uuid(id)}, ${uuid(venue.id)}, ${key(legacyKey)}, ${text(presence)}, ${text(facts)})`)
  return id
}

/** The fact's ready photo, attached as the legacy evidence an import carries. */
export function attachFactPhoto(
  factId: string,
  venue: Pick<Venue, "id">,
  assetId: string
) {
  psql(`insert into public.venue_amenity_fact_media (fact_id, venue_id, asset_id)
    values (${uuid(factId)}, ${uuid(venue.id)}, ${uuid(assetId)})`)
}

/** A newer revision of a synthetic fact: earlier reviews stop counting. */
export function bumpLegacyRevision(factId: string): number {
  return Number(
    psql(
      `with bumped as (update public.venue_amenity_facts set revision = revision + 1
        where id = ${uuid(factId)} returning revision) select revision from bumped`
    )
  )
}

export function reviewMapping(
  adminDb: Db,
  factId: string,
  revision: number,
  questionKey: string,
  kind: "exact" | "candidate" | "none",
  reason: string
) {
  return knowledgeOk(adminDb, "knowledge_mapping_review", {
    p_legacy_fact_id: factId,
    p_legacy_revision: revision,
    p_question_key: questionKey,
    p_kind: kind,
    p_reason: reason,
    p_idempotency_key: randomUUID(),
  })
}

/** A venue-scoped legacy dry run then apply, in the admin's own session. */
export async function importLegacy(adminDb: Db, venue: Pick<Venue, "id">) {
  for (const mode of ["dry_run", "apply"])
    await knowledgeOk(adminDb, "knowledge_reconcile", {
      p_kind: "legacy",
      p_mode: mode,
      p_venue_id: venue.id,
    })
}

export type ContributionSource = {
  contributionId: string
  venueId: string
  checkId: string
  questionKey: string
  sourceKind: string
  sourceLabel: string
  legacyFactId: string | null
  legacyRevision: number | null
  assertionId: string | null
  contributedBy: string
  initialOutcome: string
}

/** The import made from one legacy fact at one venue. */
export function importOf(
  venue: Pick<Venue, "id">,
  factId: string
): ContributionSource {
  const row = psql(`
    select json_build_object(
      'contributionId', ks.contribution_id, 'venueId', ks.venue_id, 'checkId', x.check_id,
      'questionKey', ks.question_key, 'sourceKind', ks.source_kind, 'sourceLabel', ks.source_label,
      'legacyFactId', ks.legacy_fact_id, 'legacyRevision', ks.legacy_revision,
      'assertionId', ks.assertion_id, 'contributedBy', x.contributed_by,
      'initialOutcome', x.initial_outcome)
    from public.knowledge_contribution_sources ks
    join public.knowledge_contributions x on x.id = ks.contribution_id
    where ks.venue_id = ${uuid(venue.id)} and ks.legacy_fact_id = ${uuid(factId)}`)
  expect(row, `one import from fact ${factId}`).not.toBe("")
  return JSON.parse(row) as ContributionSource
}

export type Mapping = {
  legacyFactId: string
  legacyRevision: number
  questionKey: string
  kind: string
}

/** Reviews of these synthetic facts, latest first per (fact, revision, key). */
export function mappingsOf(factIds: string[]): Mapping[] {
  const ids = factIds.map(uuid).join(", ")
  return JSON.parse(
    psql(`select coalesce(json_agg(json_build_object(
        'legacyFactId', m.legacy_fact_id, 'legacyRevision', m.legacy_revision,
        'questionKey', m.question_key, 'kind', m.mapping_kind)
        order by m.legacy_fact_id, m.legacy_revision, m.question_key, m.reviewed_at desc, m.id desc), '[]'::json)
      from public.knowledge_legacy_mappings m where m.legacy_fact_id in (${ids})`)
  ) as Mapping[]
}

export function legacyRevision(factId: string): number {
  return Number(
    psql(
      `select revision from public.venue_amenity_facts where id = ${uuid(factId)}`
    )
  )
}

/** Reconciliation runs scoped to this venue (the Runs case counts them). */
export function runsAt(venue: Pick<Venue, "id">): number {
  return Number(
    psql(
      `select count(*) from public.knowledge_reconciliation_runs where venue_id = ${uuid(venue.id)}`
    )
  )
}

// ---- One check's slot, read for assertions ---------------------------------------------

export type DecisionRow = {
  id: string
  decision: string
  decidedBy: string | null
  basis: string
  contributionId: string | null
  submissionId: string | null
  resultingSubmissionId: string | null
  note: string | null
  detail: Record<string, unknown> | null
  at: string
}

export type SlotRead = {
  currentSubmissionId: string | null
  currentAnswer: string | null
  submittedBy: string | null
  sourceContributionId: string | null
  progress: string
  revision: number
  decisions: DecisionRow[]
}

/** The check's current submission, revision and every decision, by venue and check. */
export function slotRead(venue: Pick<Venue, "id">, checkId: string): SlotRead {
  return JSON.parse(
    psql(`
    select json_build_object(
      'currentSubmissionId', c.current_submission_id,
      'currentAnswer', s.answer,
      'submittedBy', s.submitted_by,
      'sourceContributionId', s.source_contribution_id,
      'progress', c.progress,
      'revision', c.revision,
      'decisions', (select coalesce(json_agg(json_build_object(
          'id', d.id, 'decision', d.decision, 'decidedBy', d.decided_by, 'basis', d.decider_basis,
          'contributionId', d.contribution_id, 'submissionId', d.submission_id,
          'resultingSubmissionId', d.resulting_submission_id, 'note', d.note,
          'detail', d.detail, 'at', to_json(d.created_at) #>> '{}')
          order by d.created_at, d.id), '[]'::json)
        from public.knowledge_decisions d
        where d.venue_id = c.venue_id and d.check_id = c.id)
    ) from public.venue_amenity_checks c
    left join public.amenity_submissions s on s.id = c.current_submission_id
    where c.venue_id = ${uuid(venue.id)} and c.id = ${uuid(checkId)}`)
  ) as SlotRead
}

/** Detail-correction overlay rows on this check's contributions (§9.1). */
export function detailCorrections(
  venue: Pick<Venue, "id">,
  checkId: string
): number {
  return Number(
    psql(`select count(*) from public.knowledge_detail_corrections dc
      join public.knowledge_contributions x on x.id = dc.contribution_id
      join public.knowledge_decisions d on d.id = dc.decision_id
      where dc.venue_id = ${uuid(venue.id)} and x.check_id = ${uuid(checkId)}
        and d.check_id = ${uuid(checkId)}`)
  )
}

// ---- Holding a real Server Action response ---------------------------------------------

export type HeldAction = {
  /**
   * Resolves when the first matching request reaches the browser's network
   * layer; rejects if none has within ARRIVAL_MS of holding, so a click that
   * sends nothing fails as itself instead of running out the test's time.
   */
  arrived: Promise<void>
  /** Matching requests seen so far. */
  count: () => number
  /** Lets the held request(s) continue to the real server. */
  release: () => void
  /**
   * Releases, waits until every held request has been passed on, then
   * removes the route. Idempotent; never throws, so it is safe in `finally`.
   */
  settle: () => Promise<void>
}

/** How long a held action may take to be sent after its route is set. */
const ARRIVAL_MS = 15_000

/**
 * Holds the browser's next-action POSTs whose body matches, until released,
 * then sends them on unchanged to the real server: nothing is fulfilled from
 * a mock, and the server sees nothing while held. Other requests pass.
 */
export async function holdServerAction(
  page: Page,
  matches: (body: string) => boolean
): Promise<HeldAction> {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  let arrive!: () => void
  let arrivalTimer: ReturnType<typeof setTimeout> | undefined
  const arrived = Promise.race([
    new Promise<void>((resolve) => (arrive = resolve)),
    new Promise<never>((_, reject) => {
      arrivalTimer = setTimeout(
        () =>
          reject(
            new Error(
              `no matching server action was sent within ${ARRIVAL_MS} ms`
            )
          ),
        ARRIVAL_MS
      )
    }),
  ]).finally(() => clearTimeout(arrivalTimer))
  // Only the caller's await reports a late arrival; never unhandled.
  arrived.catch(() => undefined)
  let count = 0
  const passing = new Set<Promise<void>>()
  const handler = async (route: Route) => {
    const request = route.request()
    if (
      request.method() !== "POST" ||
      !request.headers()["next-action"] ||
      !matches(request.postData() ?? "")
    )
      return route.fallback()
    count++
    arrive()
    const passed = gate.then(() => route.continue())
    passing.add(passed)
    try {
      await passed
    } finally {
      passing.delete(passed)
    }
  }
  await page.route("**/*", handler)
  let settled: Promise<void> | null = null
  return {
    arrived,
    count: () => count,
    release,
    settle: () =>
      (settled ??= (async () => {
        clearTimeout(arrivalTimer)
        release()
        await Promise.allSettled([...passing])
        await page.unroute("**/*", handler).catch(() => undefined)
      })()),
  }
}

// ---- London wall clock ----------------------------------------------------------------

/** An instant as the London date and HH:MM:SS a person would type. */
export function londonWallClock(iso: string): { date: string; time: string } {
  const at = new Date(iso)
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at)
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(at)
  return { date, time }
}

/** A whole second strictly after `iso` (the history read is per instant). */
export function secondAfter(iso: string, seconds = 1): string {
  const ms = Date.parse(iso)
  return new Date(Math.floor(ms / 1000) * 1000 + seconds * 1000).toISOString()
}
