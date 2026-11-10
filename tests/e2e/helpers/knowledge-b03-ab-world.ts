import { randomUUID } from "node:crypto"

import {
  expect,
  type APIResponse,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test"

import type { Db } from "../../support/identities"
import { sessionOf, type AmenitiesWorld } from "./amenities-world"
import { psql } from "./stack"
import type { Person, Venue } from "./world"

/**
 * DEV FIXTURE seeds for the B03-A and B03-B browser cases
 * (knowledge-b03-ab.spec.ts), on the isolated stack only. Registry versions
 * are append-only and global per key, so a real key's new version would
 * change every venue on the lane: each case pins its own SYNTHETIC catalogue
 * key (`b03ab_<kind>_<tag>`), with its version 1 already in force, and only
 * these keys' rows are written. Value-list items are global by list, so the
 * synthetic codes carry the tag too. Every action the cases assert runs as a
 * real user in the UI or the user's own session; psql only creates these
 * rows and reads state back.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const uuid = (id: string) => {
  if (!UUID.test(id)) throw new Error(`not a uuid: ${id}`)
  return `'${id}'::uuid`
}
const text = (v: string) => `'${v.replace(/'/g, "''")}'`
const synthetic = (key: string) => {
  if (!/^b03ab_[a-z0-9_]{1,34}$/.test(key))
    throw new Error(`not a synthetic B03 A/B key: ${key}`)
  return text(key)
}

export type SyntheticQuestion = {
  key: string
  question: string
  category: string
}

/**
 * A synthetic catalogue key with its registry version 1 (in force since an
 * hour ago) on `schema`, and the B01 rule it restates: a venue manager
 * confirms, and may confirm their own finding. Photo evidence for a Yes.
 */
export function seedSyntheticQuestion(opts: {
  tag: string
  kind: string
  schema: "accessibility" | "policy"
  category: string
  question: string
}): SyntheticQuestion {
  const key = `b03ab_${opts.kind}_${opts.tag}`
  const brief = `DEV FIXTURE B03 ${opts.kind} capture brief ${opts.tag}.`
  const confirmation =
    opts.schema === "policy" ? "policy_authority" : "venue_manager"
  psql(`
    insert into public.amenity_catalogue
      (key, category, question, capture_brief, evidence_rule, is_core, position, catalogue_version)
    values (${synthetic(key)}, ${text(opts.category)}, ${text(opts.question)}, ${text(brief)},
      'photo', false, (select max(position) + 1 from public.amenity_catalogue), 1);
    insert into public.knowledge_question_rules
      (question_key, rule_version, confirmation, self_confirmation_allowed,
       unassigned_auto_complete, staff_text_internal, redaction_required)
    values (${synthetic(key)}, 1, 'venue_manager', true, false, true, false);
    insert into public.knowledge_questions (key) values (${synthetic(key)});
    insert into public.knowledge_question_versions
      (key, version, catalogue_version, rule_version, value_schema, value_schema_version,
       guidance, evidence_rule, confirmation, self_confirmation_allowed, sensitivity,
       requires_zones, lifecycle, effective_from, change_kind, change_note,
       family, subject_type, owner_role)
    values (${synthetic(key)}, 1, 1, 1, ${text(opts.schema)}, 1,
      jsonb_build_object('question', ${text(opts.question)}, 'captureBrief', ${text(brief)},
        'staffHelp', null, 'publicLabel', null),
      'photo', ${text(confirmation)}, true, 'sensitive_claim',
      false, 'supported', now() - interval '1 hour', 'initial',
      'DEV FIXTURE B03 A/B synthetic question',
      ${text(opts.schema)}, 'venue', 'venue_manager');
  `)
  return { key, question: opts.question, category: opts.category }
}

/** The registry version in force for a key, as knowledge_submit reads it. */
export function registryVersion(key: string) {
  return JSON.parse(
    psql(`
      select json_build_object('version', v.version, 'schema', v.value_schema,
        'schemaVersion', v.value_schema_version, 'lifecycle', v.lifecycle,
        'inForce', coalesce(v.effective_from, v.created_at) <= now())
      from public.knowledge_question_versions v
      where v.key = ${synthetic(key)} order by v.version desc limit 1`)
  ) as {
    version: number
    schema: string
    schemaVersion: number
    lifecycle: string
    inForce: boolean
  }
}

type RpcError = { code: string; message: string; details?: string | null }

/** A knowledge RPC in the caller's own session (not in the generated types). */
export async function knowledgeRpc<T = unknown>(
  db: Db,
  fn: string,
  args: Record<string, unknown>
): Promise<T> {
  const rpc = db.rpc.bind(db) as unknown as (
    name: string,
    a: unknown
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>
  const { data, error } = await rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message} (${error.code})`)
  return data as T
}

/**
 * Enables Amenities at `venue`, adds the keys' checks and puts them on the
 * venue's working list, all in the admin's own session. Returns check ids.
 */
export async function enableOnWorkingList(
  w: Pick<AmenitiesWorld, "admin">,
  venue: Venue,
  keys: string[]
): Promise<Record<string, string>> {
  const admin = await sessionOf(w.admin)
  await knowledgeRpc(admin, "amenity_enable_venue", { p_venue_id: venue.id })
  await knowledgeRpc(admin, "amenity_add_checks", {
    p_venue_id: venue.id,
    p_keys: keys,
  })
  await knowledgeRpc(admin, "knowledge_set_working_list", {
    p_venue_id: venue.id,
    p_keys: keys,
    p_enabled: true,
    p_reason: "DEV FIXTURE B03 A/B",
  })
  return Object.fromEntries(
    keys.map((key) => [
      key,
      psql(
        `select id from public.venue_amenity_checks where venue_id = ${uuid(venue.id)} and template_key = ${text(key)}`
      ),
    ])
  )
}

/** A place added by the venue's manager in their own session. */
export async function addPlace(
  manager: Pick<Person, "email">,
  kind: "entrance" | "area" | "room",
  label: string
): Promise<string> {
  const db = await sessionOf(manager)
  const out = await knowledgeRpc<{ subjectId: string }>(
    db,
    "knowledge_subject_add",
    {
      p_venue_id: null,
      p_kind: kind,
      p_label: label,
      p_idempotency_key: randomUUID(),
    }
  )
  return out.subjectId
}

export function place(id: string) {
  return JSON.parse(
    psql(`
      select json_build_object('venue', venue_id, 'kind', kind, 'label', label,
        'retired', retired_at is not null)
      from public.knowledge_subjects where id = ${uuid(id)}`)
  ) as { venue: string; kind: string; label: string; retired: boolean }
}

/** Every contribution on one check, with its B03 detail row when there is one. */
export function contributionsAt(venue: Pick<Venue, "id">, checkId: string) {
  return JSON.parse(
    psql(`
      select coalesce(json_agg(json_build_object(
        'id', c.id, 'by', c.contributed_by, 'basis', c.contributor_basis,
        'kind', c.kind, 'answer', c.answer,
        'detailRow', d.contribution_id is not null, 'detailVenue', d.venue_id,
        'detail', d.detail, 'observedOn', d.observed_on,
        'observedOnSource', d.observed_on_source,
        'questionVersion', d.question_version, 'schema', d.value_schema,
        'schemaVersion', d.value_schema_version
      ) order by c.created_at, c.id), '[]'::json)
      from public.knowledge_contributions c
      left join public.knowledge_contribution_details d on d.contribution_id = c.id
      where c.venue_id = ${uuid(venue.id)} and c.check_id = ${uuid(checkId)}`)
  ) as {
    id: string
    by: string
    basis: string
    kind: string
    answer: string
    detailRow: boolean
    detailVenue: string | null
    detail: Record<string, unknown> | null
    observedOn: string | null
    observedOnSource: string | null
    questionVersion: number | null
    schema: string | null
    schemaVersion: number | null
  }[]
}

/** Every decision on one check, oldest first. */
export function decisionsAt(venue: Pick<Venue, "id">, checkId: string) {
  return JSON.parse(
    psql(`
      select coalesce(json_agg(json_build_object(
        'contribution', d.contribution_id, 'decision', d.decision,
        'by', d.decided_by, 'basis', d.decider_basis, 'self', d.self_confirmed
      ) order by d.created_at, d.id), '[]'::json)
      from public.knowledge_decisions d
      where d.venue_id = ${uuid(venue.id)} and d.check_id = ${uuid(checkId)}`)
  ) as {
    contribution: string | null
    decision: string
    by: string | null
    basis: string
    self: boolean
  }[]
}

/** A check row as stored, for before/after comparisons. */
export function storedCheck(checkId: string) {
  return JSON.parse(
    psql(`
      select json_build_object('progress', progress, 'answer', answer,
        'revision', revision, 'submission', current_submission_id)
      from public.venue_amenity_checks where id = ${uuid(checkId)}`)
  ) as {
    progress: string
    answer: string
    revision: number
    submission: string | null
  }
}

/**
 * The evidence picker's checkbox for one asset. The knowledge path lists the
 * person's own media by its library thumbnail, the legacy path by the
 * amenity evidence route; both carry the asset id.
 */
export function evidenceBox(page: Page, assetId: string): Locator {
  if (!UUID.test(assetId)) throw new Error(`not a uuid: ${assetId}`)
  return page
    .getByRole("listitem")
    .filter({ has: page.locator(`img[src*="${assetId}"]`) })
    .getByRole("checkbox")
}

/** London today minus `days`, YYYY-MM-DD. */
export function londonDaysAgo(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  const [y, m, d] = today.split("-").map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! - days)).toISOString().slice(0, 10)
}

/** `promise`, or a rejection naming `what` once `ms` pass first. */
async function within<T>(promise: Promise<T>, ms: number, what: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} within ${ms} ms`)), ms)
  })
  try {
    return await Promise.race([promise, deadline])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Holds the next real knowledge submit (a server action POST from `path`
 * whose body carries `marker`) while `held` runs: the request reaches the
 * server and its real response is delivered only after. Later submits pass
 * through but are counted; `held` gets how many submits left the page, and
 * the hold fails unless exactly one had once the held route settled.
 *
 * `send` is started, not awaited, so it can never wait on the release. The
 * submit must arrive within `arrivalMs`, and a failed `send` or route fetch
 * fails the hold at once. Whatever happens, the hold is then released, the
 * held route settled and only this handler removed, each within `settleMs`;
 * the first failure is the one thrown.
 */
export async function holdNextSubmit(
  page: Page,
  path: string,
  marker: string,
  steps: {
    send: () => Promise<unknown>
    held: (count: () => number) => Promise<void>
    arrivalMs?: number
    settleMs?: number
  }
) {
  const { send, held, arrivalMs = 30_000, settleMs = 15_000 } = steps
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  let arrived!: () => void
  const reached = new Promise<void>((resolve) => (arrived = resolve))
  let fail!: (cause: unknown) => void
  const failed = new Promise<never>((_, reject) => (fail = reject))
  failed.catch(() => {})
  /** The held route's handling; resolves to its failure, never rejects. */
  let settled: Promise<unknown> | undefined
  let submits = 0

  const matcher = (url: URL) => url.pathname === path
  const handler = async (route: Route) => {
    const request = route.request()
    const isSubmit =
      request.method() === "POST" &&
      Boolean(request.headers()["next-action"]) &&
      (request.postData() ?? "").includes(marker)
    if (!isSubmit) return route.fallback()
    submits++
    if (submits > 1) return route.fallback()
    settled = (async () => {
      let response: APIResponse
      try {
        response = await route.fetch()
      } catch (cause) {
        const failure = new Error(
          `held submit to ${path}: route.fetch failed`,
          { cause }
        )
        // Published first: the abort below can hang too.
        fail(failure)
        await route.abort().catch(() => {})
        throw failure
      }
      arrived()
      await gate
      await route.fulfill({ response })
    })().then(
      () => undefined,
      (cause: unknown) => {
        fail(cause)
        return cause
      }
    )
    await settled
  }

  let first: { cause: unknown } | undefined
  const keep = (cause: unknown) => {
    first ??= { cause }
  }
  await page.route(matcher, handler)
  let sending: Promise<unknown> | undefined
  try {
    sending = Promise.resolve().then(send)
    sending.catch(fail)
    await within(
      Promise.race([reached, failed]),
      arrivalMs,
      `held submit to ${path} did not arrive`
    )
    const holding = held(() => submits)
    holding.catch(() => {})
    await Promise.race([holding, failed])
  } catch (cause) {
    keep(cause)
  } finally {
    release()
    if (settled)
      await within(settled, settleMs, `held submit to ${path} did not settle`)
        .then((cause) => cause && keep(cause))
        .catch(keep)
    const unrouting = page.unroute(matcher, handler)
    unrouting.catch(() => {})
    await within(
      unrouting,
      settleMs,
      `unroute for ${path} did not finish`
    ).catch(keep)
    // A second submit can still leave the page while the held one is being
    // fulfilled, after `held` last counted.
    if (submits !== 1)
      keep(new Error(`${submits} submits to ${path} left the page; expected 1`))
    if (sending)
      await within(sending, settleMs, `send for ${path} did not finish`).catch(
        keep
      )
  }
  if (first) throw first.cause
}

/** The focused element sits inside `scope`. */
export async function expectFocusWithin(scope: Locator) {
  await expect
    .poll(() => scope.evaluate((el) => el.contains(document.activeElement)))
    .toBe(true)
}

// ---- The fixed step-free entrance key (B03-A) --------------------------------

/**
 * The capture screen offers the step-free form (each listed entrance with its
 * result) only on this key (app/staff/tasks/amenities/_capture/screen.tsx),
 * and the database's step-free rule matches it by name, so B03-A can't use a
 * synthetic key.
 */
export const STEP_FREE_KEY = "step_free_entrance"

/**
 * Set on a disposable B03 fixture lane only. B03-A appends an accessibility.v1
 * registry version to the real step-free key, which every venue on that
 * database then reads; the inherited baseline run never sets it.
 */
export const B03_DISPOSABLE_REGISTRY =
  process.env.B03_DISPOSABLE_REGISTRY === "1"

export type StepFreeVersion = {
  version: number
  schema: string
  schemaVersion: number
  lifecycle: string
  inForce: boolean
  question: string
  evidenceRule: string
  confirmation: string
  selfConfirmation: boolean
}

function stepFreeLatest(): StepFreeVersion {
  return JSON.parse(
    psql(`
      select json_build_object('version', v.version, 'schema', v.value_schema,
        'schemaVersion', v.value_schema_version, 'lifecycle', v.lifecycle,
        'inForce', coalesce(v.effective_from, v.created_at) <= now(),
        'question', v.guidance ->> 'question', 'evidenceRule', v.evidence_rule,
        'confirmation', v.confirmation, 'selfConfirmation', v.self_confirmation_allowed)
      from public.knowledge_question_versions v
      where v.key = ${text(STEP_FREE_KEY)} order by v.version desc limit 1`)
  ) as StepFreeVersion
}

const isAccessibilityV1 = (v: StepFreeVersion) =>
  v.schema === "accessibility" &&
  v.schemaVersion === 1 &&
  v.lifecycle === "supported" &&
  v.inForce

/**
 * The step-free key's version in force as accessibility.v1. When the latest
 * version isn't that already (an earlier run on the lane appended it), one
 * version is appended: the latest row's guidance, evidence and confirmation
 * rules, in force now. No existing row is changed; a concurrent append of
 * the same version number is left to the other run and read back.
 */
export function stepFreeAccessibilityVersion(): StepFreeVersion {
  if (!B03_DISPOSABLE_REGISTRY)
    throw new Error(
      "B03-A appends a registry version to step_free_entrance: disposable B03 lane only (B03_DISPOSABLE_REGISTRY=1)."
    )
  const latest = stepFreeLatest()
  if (isAccessibilityV1(latest)) return latest
  psql(`
    insert into public.knowledge_question_versions
    select (jsonb_populate_record(null::public.knowledge_question_versions, to_jsonb(v) || jsonb_build_object(
      'version', v.version + 1, 'value_schema', 'accessibility', 'value_schema_version', 1,
      'family', 'accessibility', 'lifecycle', 'supported', 'superseded_by', null,
      'change_kind', 'schema', 'change_note', 'DEV FIXTURE B03-A disposable lane: accessibility.v1',
      'upgrade_rules', '{}'::jsonb, 'created_at', now(), 'effective_from', now(),
      'created_by', null))).*
    from public.knowledge_question_versions v
    where v.key = ${text(STEP_FREE_KEY)} order by v.version desc limit 1
    on conflict (key, version) do nothing`)
  const after = stepFreeLatest()
  if (!isAccessibilityV1(after))
    throw new Error(
      `step_free_entrance is not accessibility.v1 in force: ${JSON.stringify(after)}`
    )
  return after
}

// ---- Policy value lists and a legacy statement (B03-B) -----------------------

export type ValueItem = { code: string; label: string }

/**
 * One synthetic item on a policy value list (global by list, so the code and
 * label carry the tag). Items are never deleted, only retired.
 */
export function seedValueItem(opts: {
  tag: string
  list: "policy_condition_types" | "policy_exception_types"
  name: string
  label: string
  valueKind?: "number" | "text" | "time"
}): ValueItem {
  const code = `b03ab_${opts.name}_${opts.tag}`
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(code)) throw new Error(`bad code ${code}`)
  const label = `DEV FIXTURE ${opts.label} ${opts.tag}`
  psql(`
    insert into public.knowledge_value_list_items
      (list, code, label, needs_value, value_kind, position)
    values (${text(opts.list)}, ${text(code)}, ${text(label)},
      ${opts.valueKind ? "true" : "false"},
      ${opts.valueKind ? text(opts.valueKind) : "null"}, 9000)`)
  return { code, label }
}

/** Retires a synthetic item: kept, readable on old answers, never offered. */
export function retireValueItem(
  list: "policy_condition_types" | "policy_exception_types",
  item: ValueItem
) {
  if (!item.code.startsWith("b03ab_")) throw new Error("synthetic items only")
  psql(`
    update public.knowledge_value_list_items set retired_at = now()
    where list = ${text(list)} and code = ${text(item.code)} and retired_at is null`)
}

/**
 * A policy statement sent through knowledge_submit in `who`'s own session
 * and left for another manager to confirm, with `detail` as given (an
 * incomplete one is accepted when sent, A36).
 */
export async function sendStatement(
  who: Pick<Person, "email">,
  venue: Pick<Venue, "id">,
  check: { id: string; key: string },
  detail: Record<string, unknown>,
  assetIds: string[]
): Promise<string> {
  const revision = Number(
    psql(
      `select private.knowledge_slot_revision(${uuid(venue.id)}, ${synthetic(check.key)})`
    )
  )
  const out = await knowledgeRpc<{ contributionId: string }>(
    await sessionOf(who),
    "knowledge_submit",
    {
      p_check_id: check.id,
      p_slot_revision: revision,
      p_idempotency_key: randomUUID(),
      p_kind: "finding",
      p_answer: "yes",
      p_finding: null,
      p_limitations: null,
      p_reason: null,
      p_unknown_preset: null,
      p_tried_text: null,
      p_change_reason: null,
      p_responds_to: null,
      p_asset_ids: assetIds,
      p_internal_metadata: null,
      p_redaction_confirmed: false,
      p_confirm_own: false,
      p_detail: detail,
      p_observed_on: null,
      p_observed_on_source: null,
    }
  )
  return out.contributionId
}

/** What the answer in use at a check still needs to be a complete policy. */
export function policyMissing(checkId: string): string[] {
  return JSON.parse(
    psql(
      `select coalesce(private.knowledge_policy_complete(${uuid(checkId)}), '[]'::jsonb)::text`
    )
  ) as string[]
}

/** Detail rows naming an organisation-wide scope on these keys, anywhere. */
export function organisationScopeRows(keys: string[]): number {
  return Number(
    psql(`
      select count(*) from public.knowledge_contribution_details d
      join public.knowledge_contributions c on c.id = d.contribution_id
      where c.question_key in (${keys.map(synthetic).join(", ")})
        and d.detail ->> 'policyScope' = 'organisation'`)
  )
}
