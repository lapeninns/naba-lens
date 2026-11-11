// B10-m1 database checks (b10-design §14.2 T-B10-04, T-B10-05, T-B10-07 SQL
// part) for the coordinator's isolated stack: `pnpm test:security <workdir>`.
// Real ACLs, the service-only writer through PostgREST, append-only
// enforcement, and private.ops_metrics on known rows at a fixed as-of clock.
//
// The known-row fixture is built and read inside one psql transaction that is
// rolled back, so the append-only ledger and the shared stack keep nothing
// from it and a rerun gives the same numbers. Triggers are off for that
// transaction only (session_replication_role = replica, as other suites do)
// so timestamps can be set exactly; CHECK constraints still apply.
import { randomUUID } from "node:crypto"

import { afterAll, describe, expect, it } from "vitest"

import {
  OpsMetricsContractError,
  parseOpsMetrics,
} from "../../lib/ops/metrics-snapshot"
import { METRICS } from "../../lib/ops/metrics"
import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
} from "../support/identities"
import { psql } from "./coverage-fixtures"

// The fields these tests read. The real PostgREST response also carries
// success, count, status and statusText, so exact checks compare
// `outcome(...)`, not the whole response.
type RpcResult = {
  data: unknown
  error: { code: string; message: string } | null
}
type RpcClient = { rpc(fn: string, args?: object): PromiseLike<RpcResult> }
const rpc = (client: unknown, fn: string, args: object) =>
  (client as RpcClient).rpc(fn, args)
const outcome = ({ data, error }: RpcResult) => ({ data, error })

const service = serviceClient()
const lit = (value: string) => `'${value.replace(/'/g, "''")}'`
const WRITER =
  "public.ops_record_job_run(uuid,text,timestamptz,timestamptz,text,jsonb,text)"
const READER = "private.ops_metrics(timestamptz,uuid)"
const PRIVATE_HELPERS = [
  "private.ops_jobs()",
  "private.ops_job_error_codes(text)",
  "private.ops_job_count_fields(text)",
  "private.ops_job_outcome_valid(text,text,text)",
  "private.ops_job_counts_valid(text,jsonb)",
  "private.ops_record_job_run(uuid,text,timestamptz,timestamptz,text,jsonb,text)",
  "private.ops_utc(timestamptz)",
  "private.ops_age_seconds(timestamptz,timestamptz)",
]

const SENSITIVE = [
  "Jamie Example",
  "jamie@example.com",
  "note: the cellar door code",
  "wifi-ssid NabaGuest / password hunter2",
  "https://fixture.supabase.co/storage/v1/object/sign/media/x?token=eyJfake",
  "permission denied for table media_assets: secret detail",
]

function receipt(overrides: Record<string, unknown> = {}) {
  const now = Date.now()
  return {
    p_run_id: randomUUID(),
    p_job: "cleanup",
    p_started_at: new Date(now - 5_000).toISOString(),
    p_finished_at: new Date(now).toISOString(),
    p_outcome: "ok",
    p_counts: { removed_assets: 2 },
    p_error_code: null,
    ...overrides,
  }
}
const stored = (runId: string) =>
  Number(
    psql(
      `select count(*) from private.ops_job_runs where run_id = ${lit(runId)}`
    )
  )

describe("B10-m1 access control", () => {
  it("gives no API role any privilege on the receipt table", () => {
    const privileges = [
      "select",
      "insert",
      "update",
      "delete",
      "truncate",
      "references",
      "trigger",
    ]
    for (const role of ["anon", "authenticated", "service_role"])
      for (const privilege of privileges)
        expect(
          psql(
            `select has_table_privilege(${lit(role)}, 'private.ops_job_runs', ${lit(privilege)})`
          ),
          `${role} ${privilege}`
        ).toBe("f")
    const acl = psql(
      "select coalesce(relacl::text, '') || '|' || relrowsecurity::text from pg_class where oid = 'private.ops_job_runs'::regclass"
    )
    expect(acl.split("|")[0]).not.toMatch(/(^|[{,])=/)
    expect(acl.split("|")[1]).toBe("true")
  })

  it("lets only service_role execute the writer and the reading", () => {
    const can = (role: string, fn: string) =>
      psql(`select has_function_privilege(${lit(role)}, ${lit(fn)}, 'execute')`)
    for (const fn of [WRITER, READER]) {
      expect(can("service_role", fn), fn).toBe("t")
      expect(can("anon", fn), fn).toBe("f")
      expect(can("authenticated", fn), fn).toBe("f")
      expect(
        psql(
          `select coalesce(proacl::text, '') from pg_proc where oid = ${lit(fn)}::regprocedure`
        ),
        fn
      ).not.toMatch(/(^|[{,])=X/)
    }
    for (const fn of PRIVATE_HELPERS)
      for (const role of ["anon", "authenticated", "service_role"])
        expect(can(role, fn), `${role} ${fn}`).toBe("f")
    expect(
      psql(
        `select prosecdef::text || '|' || array_to_string(proconfig, ',') from pg_proc where oid = ${lit(WRITER)}::regprocedure`
      )
    ).toBe('true|search_path=""')
  })

  it("keeps the private schema off the Data API", async () => {
    const { data, error } = await (
      service.schema("private" as never) as unknown as RpcClient
    ).rpc("ops_metrics", { p_now: new Date().toISOString() })
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it("refuses the writer to anonymous and signed-in callers", async () => {
    const venue = await createVenue(service, "ops-acl")
    const staff = await createIdentity(service, {
      label: "ops-acl",
      role: "staff",
      venueId: venue.id,
    })
    for (const client of [anonClient(), staff.client]) {
      const args = receipt()
      const { data, error } = await rpc(client, "ops_record_job_run", args)
      expect(data).toBeNull()
      expect(error).not.toBeNull()
      expect(stored(args.p_run_id)).toBe(0)
    }
  })
})

describe("B10-m1 writer", () => {
  it("records once, replays harmlessly and refuses a conflicting replay", async () => {
    const args = receipt()
    expect(outcome(await rpc(service, "ops_record_job_run", args))).toEqual({
      data: "recorded",
      error: null,
    })
    expect(outcome(await rpc(service, "ops_record_job_run", args))).toEqual({
      data: "replayed",
      error: null,
    })
    const conflict = await rpc(service, "ops_record_job_run", {
      ...args,
      p_outcome: "failed",
      p_error_code: "cleanup_failed",
    })
    expect(conflict.error?.code).toBe("23505")
    expect(stored(args.p_run_id)).toBe(1)
    expect(
      psql(
        `select outcome || '|' || counts::text from private.ops_job_runs where run_id = ${lit(args.p_run_id)}`
      )
    ).toBe('ok|{"removed_assets": 2}')
  })

  it("accepts each job's allowed outcomes and codes", async () => {
    const cases = [
      {
        p_job: "media_archive",
        p_outcome: "failed",
        p_error_code: "archive_lease_lost",
        p_counts: { checked: 1, bytes_verified: 9007199254740991 },
      },
      {
        p_job: "archive_watchdog",
        p_outcome: "failed",
        p_error_code: "watchdog_unavailable",
        p_counts: { delivered: 0 },
      },
      {
        p_job: "monthly_preparation",
        p_outcome: "partial",
        p_error_code: "preparation_failed",
        p_counts: { succeeded_runs: 1, failed_runs: 1 },
      },
      { p_job: "cleanup", p_outcome: "ok", p_error_code: null, p_counts: {} },
    ]
    for (const overrides of cases)
      expect(
        (await rpc(service, "ops_record_job_run", receipt(overrides))).data,
        overrides.p_job
      ).toBe("recorded")
  })

  it.each<[string, Record<string, unknown>]>([
    ["an unknown job", { p_job: "media_use_sweep" }],
    ["an unknown outcome", { p_outcome: "skipped" }],
    ["an ok run with a code", { p_error_code: "cleanup_failed" }],
    ["a failure without a code", { p_outcome: "failed" }],
    [
      "another job's code",
      { p_outcome: "failed", p_error_code: "watchdog_failed" },
    ],
    ["a raw SQLSTATE", { p_outcome: "failed", p_error_code: "23505" }],
    [
      "error text as a code",
      { p_outcome: "failed", p_error_code: SENSITIVE[5] },
    ],
    [
      "partial for cleanup",
      { p_outcome: "partial", p_error_code: "cleanup_failed" },
    ],
    ["an unknown count key", { p_counts: { email: 1 } }],
    ["a nested count", { p_counts: { removed_assets: { n: 1 } } }],
    ["a string count", { p_counts: { removed_assets: "2" } }],
    ["a negative count", { p_counts: { removed_assets: -1 } }],
    ["a fractional count", { p_counts: { removed_assets: 1.5 } }],
    ["an out-of-range count", { p_counts: { removed_assets: 2147483648 } }],
    ["a list of counts", { p_counts: [1] }],
    [
      "a reversed time",
      {
        p_started_at: "2026-11-10T12:00:05Z",
        p_finished_at: "2026-11-10T12:00:00Z",
      },
    ],
    [
      "a receipt from the future",
      {
        p_started_at: "2099-01-01T00:00:00Z",
        p_finished_at: "2099-01-01T00:00:01Z",
      },
    ],
    ["a missing job", { p_job: null }],
  ])("refuses %s without echoing the input", async (_label, overrides) => {
    const args = receipt(overrides)
    const { data, error } = await rpc(service, "ops_record_job_run", args)
    expect(data).toBeNull()
    expect(error?.code).toBe("22023")
    expect(error?.message).toBe("invalid_ops_job_run")
    expect(stored(args.p_run_id)).toBe(0)
  })

  it("is append-only for every role, including the owner", async () => {
    const args = receipt()
    await rpc(service, "ops_record_job_run", args)
    const id = lit(args.p_run_id)
    expect(() =>
      psql(
        `update private.ops_job_runs set outcome = 'failed' where run_id = ${id}`
      )
    ).toThrow(/audit_append_only/)
    expect(() =>
      psql(`delete from private.ops_job_runs where run_id = ${id}`)
    ).toThrow(/audit_append_only/)
    expect(() =>
      psql("begin; truncate private.ops_job_runs; rollback;")
    ).toThrow(/audit_append_only/)
    expect(stored(args.p_run_id)).toBe(1)
  })
})

// --- Known rows at a fixed clock ---------------------------------------------

const P_NOW = "2040-01-15 12:00:00+00"
const A = randomUUID()
const B = randomUUID()
const EMPTY = randomUUID()
// R holds one asset that fails and is retried; D holds the rows for the
// seven-day windows across the London autumn DST change.
const R = randomUUID()
const D = randomUUID()
const STAFF = {
  a1: randomUUID(),
  a2: randomUUID(),
  b1: randomUUID(),
  r1: randomUUID(),
  d1: randomUUID(),
}
const asset = (key: string) => ({ key, id: randomUUID() })
const ASSETS = {
  a1: asset("a1"),
  a2: asset("a2"),
  a3: asset("a3"),
  a4: asset("a4"),
  a5: asset("a5"),
  a6: asset("a6"),
  a7: asset("a7"),
  a8: asset("a8"),
  b1: asset("b1"),
  b2: asset("b2"),
  b3: asset("b3"),
  r1: asset("r1"),
  d1: asset("d1"),
  d2: asset("d2"),
  d3: asset("d3"),
}
const CHECK = randomUUID()
const DST_CHECKS = [randomUUID(), randomUUID()]
// Monthly preparation receipts that all finish at the ok receipt's time, with
// run IDs in a known order (uuid order is the order of the lowercase text).
const TIE_IDS = [randomUUID(), randomUUID(), randomUUID(), randomUUID()].sort()

/** `P_NOW - interval` as SQL. */
const ago = (interval: string) =>
  `(${lit(P_NOW)}::timestamptz - interval ${lit(interval)})`

// Four days after the London clocks went back (2026-10-25 01:00 UTC), so
// "7 days" by the London calendar would be 169 h and by UTC 168 h. The
// elapsed cutoff is 2026-10-22T12:00:00Z in every session time zone.
const DST_NOW = "2026-10-29T12:00:00Z"
const at = (instant: string) => `${lit(instant)}::timestamptz`

function fixtureSql(reads: string[]) {
  const mediaRow = (
    key: keyof typeof ASSETS,
    venue: string,
    uploader: string,
    state: string,
    updated: string,
    deleted = "null"
  ) => {
    const { id } = ASSETS[key]
    const ready = state === "ready"
    return `(${lit(id)}, ${lit(uploader)}, ${lit(venue)}, ${lit(`${uploader}/${id}/original.jpg`)},
      ${lit(`${SENSITIVE[0]} private ${key}.jpg`)}, 'image', ${lit(state)},
      ${ready ? "'image/jpeg'" : "null"}, ${ready ? 4 : "null"},
      ${ago("40 days")}, ${updated}, ${deleted})`
  }
  const job = (
    jobId: string,
    outcome: string,
    finished: string,
    code: string | null,
    counts = "{}",
    { runId = randomUUID(), startedBefore = "5 seconds" } = {}
  ) =>
    `(${lit(runId)}, ${lit(jobId)}, ${finished} - interval ${lit(startedBefore)}, ${finished}, ${lit(outcome)}, ${lit(counts)}::jsonb, ${code ? lit(code) : "null"})`
  const PREP_OK = ago("53 minutes")
  const prepTie = (outcome: string, opts: Parameters<typeof job>[5]) =>
    job(
      "monthly_preparation",
      outcome,
      PREP_OK,
      "preparation_failed",
      "{}",
      opts
    )
  const label = (
    key: keyof typeof ASSETS,
    updated: string
  ) => `(${lit(ASSETS[key].id)}, ${lit(STAFF.d1)}, ${lit(D)}, '{}'::jsonb,
        'needs_attention', 'conflict', ${lit(SENSITIVE[5])}, ${updated} - interval '1 day', ${updated})`
  const submission = (
    key: keyof typeof ASSETS,
    venue: string,
    author: string,
    at: string
  ) => {
    const sid = randomUUID()
    return `
    insert into public.coverage_submissions (id, venue_id, submitted_by, kind, client_request_key, asset_ids, created_at)
      values (${lit(sid)}, ${lit(venue)}, ${lit(author)}, 'staff_submit', ${lit(`test-${randomUUID()}`)}, array[${lit(ASSETS[key].id)}]::uuid[], ${at});
    insert into public.coverage_submission_items (submission_id, venue_id, asset_id, author_id, origin, submitted_by,
        submitted_at, submitted_month, uploaded_at, uploaded_month)
      values (${lit(sid)}, ${lit(venue)}, ${lit(ASSETS[key].id)}, ${lit(author)}, 'submitted', ${lit(author)},
        ${at}, private.london_month(${at}), ${ago("40 days")}, private.london_month(${ago("40 days")}));`
  }
  return `
    begin;
    set local session_replication_role = replica;
    insert into public.venues (id, name, slug, active) values
      (${lit(A)}, ${lit(`${SENSITIVE[0]} Arms ${A.slice(0, 8)}`)}, ${lit(`ops-a-${A.slice(0, 8)}`)}, true),
      (${lit(B)}, ${lit(`Wifi ${SENSITIVE[3]} ${B.slice(0, 8)}`)}, ${lit(`ops-b-${B.slice(0, 8)}`)}, true),
      (${lit(R)}, ${lit(`Retry ${R.slice(0, 8)}`)}, ${lit(`ops-r-${R.slice(0, 8)}`)}, true),
      (${lit(D)}, ${lit(`Clocks ${D.slice(0, 8)}`)}, ${lit(`ops-d-${D.slice(0, 8)}`)}, true);
    insert into public.profiles (id, display_name, role, venue_id, active) values
      (${lit(STAFF.a1)}, ${lit(SENSITIVE[0])}, 'staff', ${lit(A)}, true),
      (${lit(STAFF.a2)}, ${lit(SENSITIVE[1])}, 'staff', ${lit(A)}, true),
      (${lit(STAFF.b1)}, ${lit(SENSITIVE[0])}, 'staff', ${lit(B)}, true),
      (${lit(STAFF.r1)}, ${lit(SENSITIVE[0])}, 'staff', ${lit(R)}, false),
      (${lit(STAFF.d1)}, ${lit(SENSITIVE[0])}, 'staff', ${lit(D)}, false);
    insert into public.monthly_targets (staff_id, venue_id, period_month, target_count, due_on, source) values
      (${lit(STAFF.b1)}, ${lit(B)}, '2040-01-01', null, '2040-01-31', 'placeholder');
    insert into public.coverage_preparation_runs (period_month, run_trigger, started_at, finished_at, status, error_code, error_message) values
      ('2040-01-01', 'scheduled', '2040-01-02 07:00:00+00', '2040-01-02 07:00:01+00', 'succeeded', null, null),
      ('2040-01-01', 'scheduled', '2040-01-15 11:07:00+00', '2040-01-15 11:07:01+00', 'failed', 'P0001', ${lit(SENSITIVE[5])}),
      ('2040-01-01', 'scheduled', '2040-01-16 07:00:00+00', '2040-01-16 07:00:01+00', 'succeeded', null, null);
    insert into public.media_assets (id, uploader_id, venue_id, original_path, original_filename, media_type,
        upload_state, validated_mime_type, size_bytes, created_at, updated_at, deleted_at) values
      ${mediaRow("a1", A, STAFF.a1, "ready", ago("2 days"))},
      ${mediaRow("a2", A, STAFF.a1, "uploading", ago("27 hours"))},
      ${mediaRow("a3", A, STAFF.a2, "uploading", ago("25 hours"))},
      ${mediaRow("a4", A, STAFF.a2, "processing", ago("40 minutes"))},
      ${mediaRow("a5", A, STAFF.a2, "processing", ago("10 minutes"))},
      ${mediaRow("a6", A, STAFF.a1, "failed", ago("1 hour"))},
      ${mediaRow("a7", A, STAFF.a1, "ready", ago("30 hours"), ago("30 hours"))},
      ${mediaRow("a8", A, STAFF.a1, "ready", ago("2 hours"), ago("2 hours"))},
      ${mediaRow("b1", B, STAFF.b1, "ready", ago("10 days"))},
      ${mediaRow("b2", B, STAFF.b1, "ready", ago("10 days"))},
      ${mediaRow("b3", B, STAFF.b1, "ready", ago("3 hours"), ago("3 hours"))},
      ${mediaRow("r1", R, STAFF.r1, "failed", ago("2 hours"))},
      ${mediaRow("d1", D, STAFF.d1, "ready", at("2026-10-20T09:00:00Z"))},
      ${mediaRow("d2", D, STAFF.d1, "ready", at("2026-10-20T09:00:00Z"))},
      ${mediaRow("d3", D, STAFF.d1, "ready", at("2026-10-20T09:00:00Z"))};
    insert into storage.objects (bucket_id, name) values
      ('media', ${lit(`${STAFF.a1}/${ASSETS.a7.id}/preview.webp`)}),
      ('media', ${lit(`${STAFF.b1}/${ASSETS.b3.id}/original.jpg`)});
    insert into public.media_pending_labels (asset_id, uploader_id, venue_id, input, status, code, message, created_at, updated_at) values
      (${lit(ASSETS.a1.id)}, ${lit(STAFF.a1)}, ${lit(A)}, ${lit(JSON.stringify({ note: SENSITIVE[2] }))}::jsonb,
        'needs_attention', 'conflict', ${lit(SENSITIVE[5])}, ${ago("9 days")}, ${ago("8 days")}),
      (${lit(ASSETS.a6.id)}, ${lit(STAFF.a1)}, ${lit(A)}, ${lit(JSON.stringify({ note: SENSITIVE[4] }))}::jsonb,
        'pending', null, null, ${ago("1 hour")}, ${ago("1 hour")}),
      (${lit(ASSETS.a3.id)}, ${lit(STAFF.a2)}, ${lit(A)}, '{}'::jsonb, 'pending', null, null, ${ago("5 minutes")}, ${ago("5 minutes")}),
      -- D: older than the elapsed cutoff (inside the London-calendar one), at
      -- the cutoff, and inside the window.
      ${label("d1", at("2026-10-22T11:30:00Z"))},
      ${label("d2", at("2026-10-22T12:00:00Z"))},
      ${label("d3", at("2026-10-22T12:30:00Z"))};
    ${submission("a1", A, STAFF.a1, ago("1 day"))}
    ${submission("b1", B, STAFF.b1, ago("9 days"))}
    ${submission("a7", A, STAFF.a1, ago("1 day"))}
    insert into public.amenity_check_events (check_id, venue_id, kind, reason, detail, created_at) values
      (${lit(CHECK)}, ${lit(A)}, 'evidence_lost', ${lit(SENSITIVE[2])}, ${lit(JSON.stringify({ wifi: SENSITIVE[3] }))}::jsonb, ${ago("1 day")}),
      (${lit(CHECK)}, ${lit(A)}, 'evidence_lost', null, '{}'::jsonb, ${ago("2 days")}),
      (${lit(CHECK)}, ${lit(A)}, 'evidence_lost', null, '{}'::jsonb, ${ago("8 days")}),
      (${lit(CHECK)}, ${lit(A)}, 'notes_updated', ${lit(SENSITIVE[1])}, '{}'::jsonb, ${ago("1 hour")}),
      (${lit(DST_CHECKS[0])}, ${lit(D)}, 'evidence_lost', null, '{}'::jsonb, ${at("2026-10-22T11:30:00Z")}),
      (${lit(DST_CHECKS[0])}, ${lit(D)}, 'evidence_lost', null, '{}'::jsonb, ${at("2026-10-22T12:00:00Z")}),
      (${lit(DST_CHECKS[0])}, ${lit(D)}, 'evidence_lost', null, '{}'::jsonb, ${at("2026-10-22T12:30:00Z")}),
      (${lit(DST_CHECKS[1])}, ${lit(D)}, 'evidence_lost', null, '{}'::jsonb, ${at("2026-10-28T09:00:00Z")});
    insert into private.ops_job_runs (run_id, job, started_at, finished_at, outcome, counts, error_code) values
      ${job("cleanup", "ok", ago("50 minutes"), null, '{"removed_assets": 3}')},
      ${job("cleanup", "failed", ago("30 hours"), "cleanup_failed")},
      ${job("cleanup", "failed", `(${lit(P_NOW)}::timestamptz + interval '10 minutes')`, "cleanup_failed")},
      ${job("media_archive", "ok", ago("30 minutes"), null)},
      ${job("media_archive", "failed", ago("20 minutes"), "archive_audit_timeout")},
      ${job("media_archive", "failed", ago("10 minutes"), "archive_lease_lost")},
      ${job("monthly_preparation", "partial", ago("2 hours"), "preparation_failed", '{"succeeded_runs": 1, "failed_runs": 1}')},
      ${job("monthly_preparation", "ok", PREP_OK, null, "{}", { runId: TIE_IDS[1] })},
      -- Same finish as the ok receipt. Before it: an earlier start, and the
      -- same start with a lower run ID. After it: the same start with higher
      -- run IDs, and a later start (the latest receipt).
      ${prepTie("failed", { startedBefore: "10 seconds" })},
      ${prepTie("failed", { runId: TIE_IDS[0] })},
      ${prepTie("failed", { runId: TIE_IDS[2] })},
      ${prepTie("partial", { runId: TIE_IDS[3] })},
      ${prepTie("failed", { startedBefore: "1 second" })};
    set local session_replication_role = origin;
    ${reads.join("\n")}
    rollback;`
}

type Json = Record<string, unknown>
let readings: Json[] = []
// R before and after its retry; D with the session in UTC, then London.
let retryReadings: Json[] = []
let dstReadings: Json[] = []
let watchdogRowsBefore = 0

function readFixture(): Json[] {
  if (readings.length) return readings
  watchdogRowsBefore = Number(
    psql(
      `select count(*) from private.ops_job_runs where job = 'archive_watchdog' and outcome = 'ok' and finished_at <= ${lit(P_NOW)}`
    )
  )
  const r1 = lit(ASSETS.r1.id)
  const out = psql(
    fixtureSql([
      `select private.ops_metrics(${lit(P_NOW)}, ${lit(A)})::text;`,
      `select private.ops_metrics(${lit(P_NOW)}, ${lit(B)})::text;`,
      `select private.ops_metrics(${lit(P_NOW)}, ${lit(EMPTY)})::text;`,
      `select private.ops_metrics(${lit(P_NOW)}, null)::text;`,
      `select private.ops_metrics(${lit(P_NOW)}, ${lit(R)})::text;`,
      // The failed asset is retried and finalised under the same ID, through
      // the supported states failed -> uploading -> processing -> ready. No
      // history of the failure or the finalisation is kept anywhere.
      `set local session_replication_role = replica;
      update public.media_assets set upload_state = 'uploading', updated_at = ${ago("90 minutes")} where id = ${r1};
      update public.media_assets set upload_state = 'processing', updated_at = ${ago("80 minutes")} where id = ${r1};
      update public.media_assets set upload_state = 'ready', validated_mime_type = 'image/jpeg', size_bytes = 4,
        updated_at = ${ago("70 minutes")} where id = ${r1};
      set local session_replication_role = origin;`,
      `select private.ops_metrics(${lit(P_NOW)}, ${lit(R)})::text;`,
      `set local time zone 'UTC';`,
      `select private.ops_metrics(${at(DST_NOW)}, ${lit(D)})::text;`,
      `set local time zone 'Europe/London';`,
      `select private.ops_metrics(${at(DST_NOW)}, ${lit(D)})::text;`,
    ])
  )
  const all = out.split("\n").map((line) => JSON.parse(line) as Json)
  expect(all).toHaveLength(8)
  readings = all.slice(0, 4)
  retryReadings = all.slice(4, 6)
  dstReadings = all.slice(6)
  return readings
}
const metricsOf = (reading: Json) => reading.metrics as Record<string, Json>

afterAll(() => {
  // The fixture transaction left nothing behind.
  expect(
    psql(
      `select count(*) from public.venues where id in (${[A, B, R, D].map(lit).join(", ")})`
    )
  ).toBe("0")
})

describe("T-B10-05 ops_metrics on known rows", () => {
  it("returns the exact contract for each venue, an empty venue and all venues", () => {
    for (const reading of readFixture()) {
      expect(() => parseOpsMetrics(reading)).not.toThrow()
      expect(Object.keys(metricsOf(reading)).sort()).toEqual(
        METRICS.map((m) => m.id).sort()
      )
      expect(reading.asOf).toBe("2040-01-15T12:00:00.000000Z")
    }
    const [a, b, empty, all] = readFixture()
    expect([a.venueId, b.venueId, empty.venueId, all.venueId]).toEqual([
      A,
      B,
      EMPTY,
      null,
    ])
  })

  it("reports job heartbeats and failures globally at the as-of clock", () => {
    const [a, b] = readFixture()
    // Job health is global: the same for every venue filter.
    expect(metricsOf(a)["M-JB-1"]).toEqual(metricsOf(b)["M-JB-1"])
    expect(metricsOf(a)["M-JB-2"]).toEqual(metricsOf(b)["M-JB-2"])
    const heartbeats = metricsOf(a)["M-JB-1"].jobs as Json[]
    expect(heartbeats[0]).toEqual({
      job: "cleanup",
      intervalMinutes: 60,
      lastOkAt: "2040-01-15T11:10:00.000000Z",
      secondsSinceOk: 3000,
      state: "ok",
    })
    expect(heartbeats[1]).toEqual({
      job: "media_archive",
      intervalMinutes: 10,
      lastOkAt: "2040-01-15T11:30:00.000000Z",
      secondsSinceOk: 1800,
      state: "breach",
    })
    // No ok receipt claims neither health nor a missed run. A retained stack
    // may already hold real ok watchdog receipts from 2026, 14 years before
    // the fixture clock, which then read as a breach.
    expect(heartbeats[2]).toMatchObject(
      watchdogRowsBefore === 0
        ? {
            job: "archive_watchdog",
            lastOkAt: null,
            secondsSinceOk: null,
            state: "no_evidence",
          }
        : { job: "archive_watchdog", state: "breach" }
    )
    expect(heartbeats[3]).toEqual({
      job: "monthly_preparation",
      intervalMinutes: 60,
      lastOkAt: "2040-01-15T11:07:00.000000Z",
      secondsSinceOk: 3180,
      state: "ok",
    })
    const failures = metricsOf(a)["M-JB-2"].jobs as Json[]
    expect(failures[0]).toEqual({
      job: "cleanup",
      failed24h: 0,
      partial24h: 0,
      consecutiveFailures: 0,
      lastOutcome: "ok",
      lastErrorCode: null,
      lastFinishedAt: "2040-01-15T11:10:00.000000Z",
    })
    expect(failures[1]).toEqual({
      job: "media_archive",
      failed24h: 2,
      partial24h: 0,
      consecutiveFailures: 2,
      lastOutcome: "failed",
      lastErrorCode: "archive_lease_lost",
      lastFinishedAt: "2040-01-15T11:50:00.000000Z",
    })
    // Six receipts finish with the ok one at 11:07:00. By (finished_at,
    // started_at, run_id) two come before it and three after; the latest is
    // the one that started last. The partial run two hours earlier is reset
    // by the ok receipt, as cleanup's failure 30 h ago is by its later ok.
    expect(failures[3]).toEqual({
      job: "monthly_preparation",
      failed24h: 4,
      partial24h: 2,
      consecutiveFailures: 3,
      lastOutcome: "failed",
      lastErrorCode: "preparation_failed",
      lastFinishedAt: "2040-01-15T11:07:00.000000Z",
    })
  })

  it("keeps the venue metrics of the two fixture venues apart", () => {
    const [a, b, , all] = readFixture()
    const ma = metricsOf(a)
    const mb = metricsOf(b)
    expect(ma["M-JB-3"]).toEqual({
      availability: "available",
      scope: "venue",
      period: "2040-01-01",
      successDueAt: "2040-01-03T00:00:00.000000Z",
      lastSuccessAt: "2040-01-02T07:00:01.000000Z",
      venuesMissingTargets: 1,
      venues: [{ venueId: A, staffWithoutTarget: 2 }],
    })
    expect(mb["M-JB-3"]).toMatchObject({ venuesMissingTargets: 0, venues: [] })
    expect(ma["M-UP-1"]).toEqual({
      availability: "available",
      scope: "venue",
      totals: { uploading: 2, processing: 2, ready: 1, failed: 1 },
      venues: [
        { venueId: A, uploading: 2, processing: 2, ready: 1, failed: 1 },
      ],
    })
    expect(mb["M-UP-1"]).toMatchObject({
      totals: { uploading: 0, processing: 0, ready: 2, failed: 0 },
    })
    expect(ma["M-UP-2"]).toEqual({
      availability: "available",
      scope: "venue",
      total: 1,
      venues: [{ venueId: A, count: 1, oldestAgeSeconds: 2400 }],
    })
    expect(ma["M-UP-3"]).toEqual({
      availability: "available",
      scope: "venue",
      total: 1,
      venues: [{ venueId: A, count: 1, oldestAgeSeconds: 97200 }],
    })
    expect(mb["M-UP-3"]).toMatchObject({ total: 0, venues: [] })
    expect(ma["M-UP-5"]).toEqual({
      availability: "available",
      scope: "venue",
      totals: { count: 1, olderThan24h: 1 },
      venues: [
        { venueId: A, count: 1, olderThan24h: 1, oldestAgeSeconds: 108000 },
      ],
    })
    expect(mb["M-UP-5"]).toEqual({
      availability: "available",
      scope: "venue",
      totals: { count: 1, olderThan24h: 0 },
      venues: [
        { venueId: B, count: 1, olderThan24h: 0, oldestAgeSeconds: 10800 },
      ],
    })
    expect(ma["M-UP-6"]).toEqual({
      availability: "available",
      scope: "venue",
      totals: {
        needsAttention: 1,
        needsAttentionOlderThan7d: 1,
        stalePending: 1,
      },
      venues: [
        {
          venueId: A,
          needsAttention: 1,
          needsAttentionOlderThan7d: 1,
          oldestNeedsAttentionAgeSeconds: 691200,
          stalePending: 1,
          oldestStalePendingAgeSeconds: 3600,
        },
      ],
    })
    expect(mb["M-UP-6"]).toMatchObject({ venues: [] })
    expect(ma["M-RV-3"]).toEqual({
      availability: "available",
      scope: "venue",
      total: 1,
      venues: [{ venueId: A, count: 1, oldestAgeSeconds: 86400 }],
    })
    expect(mb["M-RV-3"]).toEqual({
      availability: "available",
      scope: "venue",
      total: 1,
      venues: [{ venueId: B, count: 1, oldestAgeSeconds: 777600 }],
    })
    expect(ma["M-WD-4"]).toEqual({
      availability: "partial",
      scope: "venue",
      parts: {
        amenity_evidence_lost: {
          availability: "available",
          totals: { events: 2, checks: 1 },
          venues: [{ venueId: A, events: 2, checks: 1 }],
        },
        knowledge_evidence_withdrawn: {
          availability: "not_available",
          reason: "not_in_slice",
        },
      },
    })
    // The all-venue reading holds each fixture venue's row unchanged.
    for (const id of ["M-UP-1", "M-UP-2", "M-UP-5", "M-UP-6", "M-RV-3"]) {
      const rows = (metricsOf(all)[id].venues as Json[]).filter(
        (row) => row.venueId === A || row.venueId === B
      )
      const expected = [
        ...(ma[id].venues as Json[]),
        ...(mb[id].venues as Json[]),
      ].sort((x, y) => String(x.venueId).localeCompare(String(y.venueId)))
      expect(rows, id).toEqual(expected)
    }
  })

  it("returns a real zero for an empty, supported source", () => {
    const empty = metricsOf(readFixture()[2])
    expect(empty["M-UP-1"]).toEqual({
      availability: "available",
      scope: "venue",
      totals: { uploading: 0, processing: 0, ready: 0, failed: 0 },
      venues: [],
    })
    for (const id of ["M-UP-2", "M-UP-3", "M-RV-3"])
      expect(empty[id], id).toEqual({
        availability: "available",
        scope: "venue",
        total: 0,
        venues: [],
      })
    expect(empty["M-JB-3"]).toMatchObject({
      venuesMissingTargets: 0,
      venues: [],
    })
  })

  it("reports missing sources without a number, and log-only metrics as not measured", () => {
    for (const reading of readFixture()) {
      const m = metricsOf(reading)
      expect(m["M-UP-4"]).toEqual({
        availability: "not_available",
        reason: "missing_history",
        missing: ["failed_transition_history", "finalisation_history"],
      })
      expect(m["M-UP-7"]).toEqual({
        availability: "not_measured",
        reason: "log_source_missing",
      })
      expect(m["M-DL-6"]).toEqual({
        availability: "not_measured",
        reason: "log_source_missing",
      })
      expect(m["M-JB-4"]).toEqual({
        availability: "not_available",
        reason: "external_checker",
      })
      for (const [id, entry] of Object.entries(m))
        if (
          entry.availability !== "available" &&
          entry.availability !== "partial"
        )
          expect(JSON.stringify(entry), id).not.toMatch(/\d/)
    }
  })

  it("follows a failed asset through its retry and still derives no failure rate", () => {
    readFixture()
    for (const reading of retryReadings)
      expect(() => parseOpsMetrics(reading)).not.toThrow()
    const [failed, ready] = retryReadings.map(metricsOf)
    expect(failed["M-UP-1"]).toEqual({
      availability: "available",
      scope: "venue",
      totals: { uploading: 0, processing: 0, ready: 0, failed: 1 },
      venues: [
        { venueId: R, uploading: 0, processing: 0, ready: 0, failed: 1 },
      ],
    })
    expect(ready["M-UP-1"]).toEqual({
      availability: "available",
      scope: "venue",
      totals: { uploading: 0, processing: 0, ready: 1, failed: 0 },
      venues: [
        { venueId: R, uploading: 0, processing: 0, ready: 1, failed: 0 },
      ],
    })
    // Neither the failure nor the finalisation left a trusted record, before
    // or after the retry: no count, denominator or rate.
    for (const m of [failed, ready])
      expect(m["M-UP-4"]).toEqual({
        availability: "not_available",
        reason: "missing_history",
        missing: ["failed_transition_history", "finalisation_history"],
      })
  })

  it("measures the seven-day windows the same in any session time zone", () => {
    readFixture()
    const [utc, london] = dstReadings
    expect(london).toEqual(utc)
    for (const reading of [utc, london]) {
      expect(() => parseOpsMetrics(reading)).not.toThrow()
      expect(reading.asOf).toBe("2026-10-29T12:00:00.000000Z")
      const m = metricsOf(reading)
      // Cutoff 2026-10-22T12:00:00Z, exclusive: only the 11:30 label is older.
      expect(m["M-UP-6"]).toEqual({
        availability: "available",
        scope: "venue",
        totals: {
          needsAttention: 3,
          needsAttentionOlderThan7d: 1,
          stalePending: 0,
        },
        venues: [
          {
            venueId: D,
            needsAttention: 3,
            needsAttentionOlderThan7d: 1,
            oldestNeedsAttentionAgeSeconds: 606600,
            stalePending: 0,
            oldestStalePendingAgeSeconds: null,
          },
        ],
      })
      // The events at 11:30 and at the cutoff are outside the window.
      expect(m["M-WD-4"]).toEqual({
        availability: "partial",
        scope: "venue",
        parts: {
          amenity_evidence_lost: {
            availability: "available",
            totals: { events: 2, checks: 2 },
            venues: [{ venueId: D, events: 2, checks: 2 }],
          },
          knowledge_evidence_withdrawn: {
            availability: "not_available",
            reason: "not_in_slice",
          },
        },
      })
      // M-JB-3 keeps the London calendar month.
      expect(m["M-JB-3"]).toMatchObject({
        period: "2026-10-01",
        successDueAt: "2026-10-02T23:00:00.000000Z",
      })
    }
  })

  it("T-B10-04: holds no upstream names, emails, notes, Wi-Fi data, paths, URLs or error text", () => {
    const text = JSON.stringify([
      ...readFixture(),
      ...retryReadings,
      ...dstReadings,
    ])
    for (const value of SENSITIVE) expect(text).not.toContain(value)
    expect(text).not.toMatch(
      /@|https?:|original\.jpg|preview\.webp|P0001|conflict/
    )
    for (const id of Object.values(ASSETS).map((a) => a.id))
      expect(text).not.toContain(id)
    for (const id of [...Object.values(STAFF), CHECK, ...DST_CHECKS])
      expect(text).not.toContain(id)
  })

  it("refuses an as-of clock that is missing or infinite", () => {
    expect(() => psql("select private.ops_metrics(null)")).toThrow(
      /invalid_as_of/
    )
    expect(() => psql("select private.ops_metrics('infinity')")).toThrow(
      /invalid_as_of/
    )
  })

  it("parses through the adapter and rejects a tampered reading", () => {
    const [a] = readFixture()
    const tampered = structuredClone(a)
    ;(metricsOf(tampered)["M-UP-2"] as Json).note = SENSITIVE[2]
    expect(() => parseOpsMetrics(tampered)).toThrow(OpsMetricsContractError)
  })
})
