// Shared fixtures for the knowledge security suites (knowledge-*.test.ts;
// docs/knowledge/b01-design.md §17). Assertions run as real signed-in
// identities through PostgREST. The service role and psql only build fixtures
// and read state back; psql is also used to hold a transaction open as a
// signed-in user for the concurrency cases.
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"

import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import {
  grantManager,
  insertAsset,
  legacyStaffGrant,
  ok,
  psql,
} from "./coverage-fixtures"

export const service = serviceClient()

export const PILOT_KEYS = [
  "onsite_parking",
  "step_free_entrance",
  "guest_toilets",
  "guest_wifi",
] as const

type RpcResult = {
  data: unknown
  error: { code: string; message: string; details?: string } | null
}
type RpcClient = { rpc(fn: string, args?: object): PromiseLike<RpcResult> }

/** Calls an RPC that is not in the generated types yet. */
export function call(
  who: TestIdentity | { client: unknown },
  fn: string,
  args: object = {}
) {
  return (who.client as RpcClient).rpc(fn, args)
}

export async function json<T = Record<string, unknown>>(
  who: TestIdentity | { client: unknown },
  fn: string,
  args: object = {}
): Promise<T> {
  return (await ok(
    call(who, fn, args) as PromiseLike<{
      data: T | null
      error: RpcResult["error"]
    }>
  )) as T
}

export async function refused(
  who: TestIdentity | { client: unknown },
  fn: string,
  args: object,
  message: string,
  code?: string
) {
  const { error } = await call(who, fn, args)
  if (!error) throw new Error(`expected ${message}`)
  if (error.message !== message) {
    throw new Error(`expected ${message}, got ${error.message} (${error.code})`)
  }
  if (code && error.code !== code) {
    throw new Error(`expected code ${code}, got ${error.code}`)
  }
  return error
}

export type World = {
  venue: string
  venueName: string
  admin: TestIdentity
  /** Manager account (role manager) with a grant for the venue. */
  manager: TestIdentity
  /** Staff account holding a transitional grant (legacy /staff/manage). */
  staffManager: TestIdentity
  staffA: TestIdentity
  staffB: TestIdentity
  checks: Record<string, string>
}

let sharedAdmin: TestIdentity | null = null
export async function admin() {
  sharedAdmin ??= await createIdentity(service, {
    label: "knowledge-admin",
    role: "admin",
  })
  return sharedAdmin
}

/**
 * A venue with Amenities enabled, the four pilot keys plus `extra` checks, and
 * the pilot keys (plus `inScope` extras) on the working list.
 */
export async function world(
  label: string,
  opts: { extra?: string[]; inScope?: string[]; enable?: boolean } = {}
): Promise<World> {
  const a = await admin()
  const v = await createVenue(service, label)
  const [manager, staffManager, staffA, staffB] = await Promise.all([
    createIdentity(service, {
      label: `${label}-mgr`,
      role: "manager",
      venueId: v.id,
    }),
    createIdentity(service, {
      label: `${label}-smgr`,
      role: "staff",
      venueId: v.id,
    }),
    createIdentity(service, {
      label: `${label}-a`,
      role: "staff",
      venueId: v.id,
    }),
    createIdentity(service, {
      label: `${label}-b`,
      role: "staff",
      venueId: v.id,
    }),
  ])
  await grantManager(a, manager.id, v.id)
  await legacyStaffGrant(service, a, staffManager.id, v.id)
  await ok(
    service
      .from("profiles")
      .update({ department: "boh" })
      .in("id", [staffManager.id, staffA.id, staffB.id])
  )
  await ok(a.client.rpc("amenity_enable_venue", { p_venue_id: v.id }))
  if (opts.extra?.length) {
    await ok(
      a.client.rpc("amenity_add_checks", {
        p_venue_id: v.id,
        p_keys: opts.extra,
      })
    )
  }
  const { data, error } = await service
    .from("venue_amenity_checks")
    .select("id, template_key")
    .eq("venue_id", v.id)
  if (error) throw error
  const checks = Object.fromEntries(data.map((c) => [c.template_key, c.id]))
  if (opts.enable !== false) {
    await json(a, "knowledge_set_working_list", {
      p_venue_id: v.id,
      p_keys: [...PILOT_KEYS, ...(opts.inScope ?? [])],
      p_enabled: true,
      p_reason: "TEST pilot",
    })
  }
  const name = (await ok(
    service.from("venues").select("name").eq("id", v.id).single()
  )) as {
    name: string
  }
  return {
    venue: v.id,
    venueName: name.name,
    admin: a,
    manager,
    staffManager,
    staffA,
    staffB,
    checks,
  }
}

export function slotRevision(venue: string, key: string): number {
  return Number(
    psql(`select private.knowledge_slot_revision('${venue}', '${key}')`)
  )
}

export type Slot = {
  status: string
  reason: string | null
  detail: string | null
  revision: number
  value: string | null
  current_answer: string | null
  current_submission_id: string | null
  current_contribution_id: string | null
  contribution_kind: string | null
  source_basis: string | null
  finding: string | null
  limitations: string | null
  confirmation_state: string | null
  confirmation_basis: string | null
  confirmation_self: boolean | null
  evidence_state: string | null
  evidence_photos: number | null
  evidence_videos: number | null
  redaction_proof: string | null
  saved_at: string | null
  sent_at: string | null
  observed_at: string | null
  open_dispute: boolean
  pending_count: number
  in_scope: boolean
}

export function slot(venue: string, key: string): Slot {
  const out = psql(
    `select row_to_json(s) from private.knowledge_slot_state('${venue}', array['${key}']) s`
  )
  return JSON.parse(out) as Slot
}

export async function photo(uploader: string, venue: string) {
  return (await insertAsset(service, { uploader, venue })).id
}
export async function video(uploader: string, venue: string) {
  return (await insertAsset(service, { uploader, venue, mediaType: "video" }))
    .id
}

export const londonToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(
    new Date()
  )

export const wifiNotes = () => ({
  testSpot: "Back bar",
  testedOn: londonToday(),
  downloadMbps: 50,
  uploadMbps: 10,
})

export type SubmitOpts = {
  kind?: "finding" | "change_report" | "detail"
  answer?: "yes" | "no" | "not_applicable" | "unknown"
  finding?: string | null
  limitations?: string | null
  reason?: string | null
  preset?: string | null
  tried?: string | null
  change?: string | null
  respondsTo?: string | null
  assets?: string[]
  metadata?: object | null
  redaction?: boolean | null
  confirmOwn?: boolean
  key?: string
  revision?: number
}

export function submitArgs(w: World, key: string, o: SubmitOpts = {}) {
  const answer = o.answer ?? "yes"
  return {
    p_check_id: w.checks[key],
    p_slot_revision: o.revision ?? slotRevision(w.venue, key),
    p_idempotency_key: o.key ?? randomUUID(),
    p_kind: o.kind ?? "finding",
    p_answer: answer,
    p_finding: o.finding ?? null,
    p_limitations: o.limitations ?? null,
    p_reason:
      o.reason !== undefined
        ? o.reason
        : answer === "no" || answer === "not_applicable"
          ? "TEST checked on site"
          : null,
    p_unknown_preset:
      o.preset !== undefined
        ? o.preset
        : answer === "unknown"
          ? "no_one_sure"
          : null,
    p_tried_text:
      o.tried !== undefined
        ? o.tried
        : answer === "unknown"
          ? "TEST asked the duty manager"
          : null,
    p_change_reason:
      o.change !== undefined
        ? o.change
        : o.kind === "change_report"
          ? "TEST it changed"
          : null,
    p_responds_to: o.respondsTo ?? null,
    p_asset_ids: o.assets ?? [],
    p_internal_metadata: o.metadata ?? null,
    p_redaction_confirmed: o.redaction ?? null,
    p_confirm_own: o.confirmOwn ?? false,
  }
}

export type SubmitResult = {
  contributionId: string
  submissionId: string | null
  outcome: "current" | "awaiting_confirmation" | "recorded"
  replacedOwn: string | null
  slotRevision: number
  replayed: boolean
  recognition: { kind: string; period?: string }
}

export function submit(
  who: TestIdentity,
  w: World,
  key: string,
  o: SubmitOpts = {}
) {
  return json<SubmitResult>(who, "knowledge_submit", submitArgs(w, key, o))
}

/** A Yes with the evidence the key's rule needs (and Wi-Fi notes and tick). */
export async function yes(
  who: TestIdentity,
  w: World,
  key: string,
  o: SubmitOpts = {}
) {
  const assets: string[] = []
  if (key === "step_free_entrance") assets.push(await video(who.id, w.venue))
  else if (key === "guest_wifi") {
    assets.push(await photo(who.id, w.venue), await video(who.id, w.venue))
  } else assets.push(await photo(who.id, w.venue))
  return submit(who, w, key, {
    assets,
    ...(key === "guest_wifi" ? { metadata: wifiNotes(), redaction: true } : {}),
    ...o,
  })
}

export function decide(
  who: TestIdentity,
  w: World,
  key: string,
  target: { type: "contribution" | "submission"; id: string },
  decision: string,
  note: string | null = null,
  o: { revision?: number; idempotencyKey?: string } = {}
) {
  return call(who, "knowledge_decide", {
    p_target_type: target.type,
    p_target_id: target.id,
    p_decision: decision,
    p_slot_revision: o.revision ?? slotRevision(w.venue, key),
    p_idempotency_key: o.idempotencyKey ?? randomUUID(),
    p_note: note,
  })
}

export function resolve(
  who: TestIdentity,
  w: World,
  key: string,
  choose: string | null,
  reason = "TEST settled"
) {
  return call(who, "knowledge_resolve_conflict", {
    p_check_id: w.checks[key],
    p_slot_revision: slotRevision(w.venue, key),
    p_idempotency_key: randomUUID(),
    p_choose: choose,
    p_reason: reason,
  })
}

export function count(sql: string): number {
  return Number(psql(sql))
}

/**
 * Runs SQL in its own psql session as a signed-in user (role authenticated,
 * JWT claims for `userId`), for holding a transaction open while another
 * session acts. Resolves with the exit code, stdout and stderr.
 */
export function sessionAs(
  userId: string,
  body: string
): Promise<{ code: number; out: string; err: string }> {
  const url = process.env.NABALENS_TEST_DB_URL!
  const claims = JSON.stringify({ sub: userId, role: "authenticated" })
  const sql = `begin;
set local role authenticated;
select set_config('request.jwt.claims', '${claims}', true);
${body}
commit;`
  return new Promise((resolveRun) => {
    const child = spawn("psql", [url, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
      stdio: ["pipe", "pipe", "pipe"],
    })
    let out = ""
    let err = ""
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (err += d))
    child.on("close", (code) => resolveRun({ code: code ?? 1, out, err }))
    child.stdin.end(sql)
  })
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** SQL literal for a uuid array. */
export const uuids = (ids: string[]) =>
  ids.length ? `array['${ids.join("','")}']::uuid[]` : "'{}'::uuid[]"
