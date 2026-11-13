import { randomUUID } from "node:crypto"

import { signIn, type Db } from "../../support/identities"
import { londonToday } from "./amenities-world"
import { provisioner, psql } from "./stack"
import type { Person, Venue } from "./world"

/**
 * DEV FIXTURE seeds for the B03-C and B03-D browser cases
 * (knowledge-b03-cd.spec.ts) only, on the isolated stack. Every key, question
 * and freshness rule is synthetic and unique per call (`e2e_b03c_*`,
 * `e2e_b03d_*`): the registry and rule tables are append-only, so these rows
 * stay on the stack, but no other venue's working list names them and no
 * shared catalogue key gains a version. Readbacks are scoped by these keys and
 * by explicit fixture ids. Every product action still runs as a real user, in
 * the page or in that user's own database session. Neither case calls the
 * global hourly job (public.knowledge_run_rechecks): it opens and closes
 * every venue's tasks.
 */

const SQL_KEY = /^[a-z][a-z0-9_]{0,39}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const lit = (v: string | null) =>
  v === null ? "null" : `'${v.replace(/'/g, "''")}'`
export const key = (k: string) => {
  if (!SQL_KEY.test(k)) throw new Error(`not a synthetic key: ${k}`)
  return `'${k}'`
}
export const uuid = (id: string) => {
  if (!UUID.test(id)) throw new Error(`not a uuid: ${id}`)
  return `'${id}'::uuid`
}

/** A fresh synthetic key prefix, e.g. e2e_b03c_1a2b3c4d. */
export const syntheticPrefix = (pair: "c" | "d") =>
  `e2e_b03${pair}_${randomUUID().replace(/-/g, "").slice(0, 8)}`

/** YYYY-MM-DD `n` days after a local date. */
export const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10)

/** London today plus `n` days. */
export const londonDay = (n = 0) => addDays(londonToday(), n)

/** "3 Nov 2026", as components/nabalens/knowledge/copy.ts longDate words it. */
export const longDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(iso))

// ---- Synthetic registry ------------------------------------------------------

export type Rules = { internal: string | null; public: string | null }

export type SeedVersion = {
  version: number
  schema: "presence" | "facility" | "service"
  confirmation: "none" | "venue_manager"
  freshness: Rules
  /** SQL for effective_from; null when in force from creation. */
  effectiveFrom: string | null
  /** SQL for created_at. */
  createdAt: string
}

export type SeedQuestion = {
  key: string
  question: string
  /** A B01 rule row (for a working list and an answer); null for registry only. */
  rule: "none" | "venue_manager" | null
  versions: SeedVersion[]
}

export type SeedPolicy = {
  id: string
  use: "internal" | "public"
  claimClass: "offering" | "schedule" | "event"
  /** Days; null for an event_end rule. */
  maxAgeDays: number | null
  leadDays: number | null
}

/** Freshness rules, each version 1, unused until a seeded version names it. */
export function seedPolicies(policies: SeedPolicy[]) {
  psql(`insert into public.knowledge_freshness_policies
    (id, version, claim_class, use, max_age, recheck_lead, basis, note, created_at)
  values ${policies
    .map(
      (p) => `(${key(p.id)}, 1, ${lit(p.claimClass)}, ${lit(p.use)},
      ${p.maxAgeDays === null ? "null" : `interval '${p.maxAgeDays} days'`},
      ${p.leadDays === null ? "null" : `interval '${p.leadDays} days'`},
      ${p.maxAgeDays === null ? "'event_end'" : "'observed_on'"},
      'DEV-FIXTURE B03-C/D', now() - interval '1 day')`
    )
    .join(",\n")};`)
}

/**
 * Catalogue rows, registry questions, optional B01 rule rows and registry
 * versions for synthetic keys, in one transaction. Each copies guest_toilets
 * (photo evidence, its catalogue category and version 1's guidance) and
 * names its own question, schema, confirmation and freshness.
 */
export function seedQuestions(questions: SeedQuestion[]) {
  const ruled = questions.filter((q) => q.rule)
  psql(`begin;
insert into public.amenity_catalogue
select (jsonb_populate_record(null::public.amenity_catalogue, to_jsonb(c) || jsonb_build_object(
  'key', n.key, 'question', n.question, 'is_core', false,
  'position', (select max(m.position) from public.amenity_catalogue m) + n.pos))).*
from public.amenity_catalogue c
cross join (values ${questions
    .map((q, i) => `(${key(q.key)}, ${i + 1}, ${lit(q.question)})`)
    .join(", ")}) n(key, pos, question)
where c.key = 'guest_toilets';
insert into public.knowledge_questions (key) values ${questions
    .map((q) => `(${key(q.key)})`)
    .join(", ")};
${
  ruled.length
    ? `insert into public.knowledge_question_rules (question_key, rule_version, confirmation) values ${ruled
        .map((q) => `(${key(q.key)}, 1, ${lit(q.rule)})`)
        .join(", ")};`
    : ""
}
insert into public.knowledge_question_versions
select (jsonb_populate_record(null::public.knowledge_question_versions, to_jsonb(v) || jsonb_build_object(
  'key', n.key, 'version', n.version, 'value_schema', n.schema, 'value_schema_version', 1,
  'family', n.schema, 'confirmation', n.confirmation, 'self_confirmation_allowed', false,
  'rule_version', n.rule_version, 'freshness', n.freshness, 'effective_from', n.effective_from,
  'lifecycle', 'supported', 'superseded_by', null, 'change_kind', n.change_kind,
  'change_note', 'DEV-FIXTURE B03-C/D', 'guidance', v.guidance || jsonb_build_object('question', n.question),
  'created_at', n.created_at, 'created_by', null))).*
from public.knowledge_question_versions v
cross join (values ${questions
    .flatMap((q) =>
      q.versions.map(
        (
          s
        ) => `(${key(q.key)}, ${s.version}, ${lit(s.schema)}, ${lit(s.confirmation)},
      ${q.rule ? "1" : "null::integer"}, ${lit(JSON.stringify(s.freshness))}::jsonb,
      ${s.effectiveFrom ?? "null::timestamptz"}, ${s.version === 1 ? "'initial'" : "'rule'"},
      ${s.createdAt}, ${lit(q.question)})`
      )
    )
    .join(
      ",\n"
    )}) n(key, version, schema, confirmation, rule_version, freshness, effective_from, change_kind, created_at, question)
where v.key = 'guest_toilets' and v.version = 1;
commit;`)
}

// ---- RPCs in a real user's own session ----------------------------------------

type RpcError = { code: string; message: string; details?: string | null }

export const sessionFor = (who: Pick<Person, "email">) =>
  signIn(provisioner(), who.email)

/** An RPC that is not in the generated types yet, in `db`'s own session. */
export async function rpcOk<T = unknown>(
  db: Db,
  fn: string,
  args: object = {}
): Promise<T> {
  const call = db.rpc.bind(db) as unknown as (
    name: string,
    args: object
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>
  const { data, error } = await call(fn, args)
  if (error)
    throw new Error(
      `${fn}: ${error.message} (${error.code}) ${error.details ?? ""}`
    )
  return data as T
}

export const slotRevision = (venue: Pick<Venue, "id">, k: string) =>
  Number(
    psql(`select private.knowledge_slot_revision(${uuid(venue.id)}, ${key(k)})`)
  )

export const checkIdFor = (venue: Pick<Venue, "id">, k: string) =>
  psql(`select id from public.venue_amenity_checks
    where venue_id = ${uuid(venue.id)} and template_key = ${key(k)}`)

export const checkRevision = (checkId: string) =>
  Number(
    psql(
      `select revision from public.venue_amenity_checks where id = ${uuid(checkId)}`
    )
  )

/** A Yes finding with one photo, in the sender's own session. */
export function sendYes(
  db: Db,
  venue: Pick<Venue, "id">,
  k: string,
  asset: string,
  opts: { detail?: object | null; observedOn?: string | null } = {}
) {
  return rpcOk<{ contributionId: string; outcome: string }>(
    db,
    "knowledge_submit",
    {
      p_check_id: checkIdFor(venue, k),
      p_slot_revision: slotRevision(venue, k),
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
      p_asset_ids: [asset],
      p_internal_metadata: null,
      p_redaction_confirmed: null,
      p_confirm_own: false,
      p_detail: opts.detail ?? null,
      p_observed_on: opts.observedOn ?? null,
      p_observed_on_source: opts.observedOn ? "chosen" : null,
    }
  )
}

/** A manager's (or admin's) confirmation of a waiting contribution. */
export function confirmContribution(
  db: Db,
  venue: Pick<Venue, "id">,
  k: string,
  contributionId: string
) {
  return rpcOk(db, "knowledge_decide", {
    p_target_type: "contribution",
    p_target_id: contributionId,
    p_decision: "confirm",
    p_slot_revision: slotRevision(venue, k),
    p_idempotency_key: randomUUID(),
    p_note: null,
  })
}

/**
 * DEV FIXTURE: opens the freshness recheck tasks (due soon, expired, no date)
 * of one venue's synthetic `keys` only, as the hourly job's freshness step
 * would, from the product's own slot state and due times. Never the global
 * job (public.knowledge_run_rechecks), so no other check's tasks are opened
 * or closed; idempotent by the task table's unique key. Schedule ends,
 * temporary and schema rechecks are not opened here: the job's own database
 * qualification covers those, deliberate stops included.
 */
export function openFreshnessRechecks(
  venue: Pick<Venue, "id">,
  keys: string[]
) {
  if (!keys.length) throw new Error("no keys")
  psql(`insert into public.knowledge_recheck_tasks (venue_id, check_id, question_key, cause, use, due_at)
    select st.venue_id, st.check_id, st.question_key, e ->> 'state', e ->> 'use',
      coalesce((e ->> 'nextCheckDue')::timestamptz, st.saved_at)
    from private.knowledge_slot_state_b03(${uuid(venue.id)}, array[${keys.map(key).join(", ")}]::text[], now()) st
    cross join lateral jsonb_array_elements(st.freshness) e
    where st.question_key in (${keys.map(key).join(", ")})
      and st.in_scope and st.current_submission_id is not null
      and st.check_progress = 'complete' and st.check_status = 'active'
      and e ->> 'state' in ('due_soon', 'expired', 'basis_missing')
    on conflict on constraint knowledge_recheck_tasks_once do nothing`)
}

// ---- Readbacks, scoped by fixture ids (service, read-only) ----------------------

/**
 * One check's answer as the resolver reads it at `at` (an instant), and its
 * service end then: `value` and `private.knowledge_check_service_end`.
 */
export function serviceAt(
  venue: Pick<Venue, "id">,
  k: string,
  checkId: string,
  at: string
) {
  const instant = new Date(at)
  if (Number.isNaN(instant.getTime())) throw new Error(`not an instant: ${at}`)
  const t = `'${instant.toISOString()}'::timestamptz`
  return JSON.parse(
    psql(`select json_build_object(
        'value', (select st.value from private.knowledge_slot_state_b03(${uuid(venue.id)}, array[${key(k)}]::text[], ${t}) st
          where st.check_id = ${uuid(checkId)}),
        'end', private.knowledge_check_service_end(${uuid(checkId)}, ${t}))`)
  ) as {
    value: string | null
    end: { kind: string; inEffect: boolean; notOfferedFromAt: string } | null
  }
}

export type TaskRow = {
  id: string
  cause: string
  use: string
  state: string
  dueAt: string
  closedDecisionId: string | null
}

/** Every recheck task of one check, oldest first. */
export function tasksOf(checkId: string): TaskRow[] {
  return JSON.parse(
    psql(`select coalesce(json_agg(json_build_object('id', t.id, 'cause', t.cause, 'use', t.use,
        'state', t.state, 'dueAt', t.due_at, 'closedDecisionId', t.closed_decision_id)
        order by t.created_at, t.id), '[]'::json)
      from public.knowledge_recheck_tasks t where t.check_id = ${uuid(checkId)}`)
  ) as TaskRow[]
}
