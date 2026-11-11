// B08-a (S1): scoring policy registry, assignment command, closed-month
// protection, and month close with drift (C-B08-2, C-B08-3, C-B08-5).
// Fixture months are synthetic past London months; each scenario uses its
// own month and venues, so a global close never meets another scenario's
// venue before that scenario has finished.
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"

import { beforeAll, describe, expect, it } from "vitest"

import {
  anonClient,
  createIdentity,
  createVenue,
  serviceClient,
  type Db,
  type TestIdentity,
} from "../support/identities"
import {
  accept,
  currentMonth,
  fails,
  grantManager,
  insertAsset,
  insertSubmittedItem,
  itemRevision,
  midMonth,
  monthOffset,
  ok,
  psql,
  requestKey,
  staffProgress,
} from "./coverage-fixtures"

const CREDIT_HASH = "b78b9daeb8ede1fec0b7224d99348659"
const COUNTS_FN = "private.monthly_venue_completion_counts(uuid,uuid,date)"
const ASSIGN_FN =
  "public.scoring_assign_policy(uuid,date,text,integer,integer,text,text)"
const MIGRATION = new URL(
  "../../supabase/migrations/20261110210000_b08a_scoring_policies.sql",
  import.meta.url
)

const service = serviceClient()
let admin: TestIdentity

type RpcError = { code: string; message: string; details?: string }
type Assignment = {
  venue_id: string
  starts_on: string
  policy_key: string
  policy_version: number
  target_count: number | null
  reason: string
  approved_by: string
  approved_at: string
  first_enrolment: boolean
  replayed: boolean
}
type Snapshot = {
  venue_id: string
  staff_id: string
  period_month: string
  kind: string
  policy_key: string
  policy_version: number
  target_basis: string
  menu_units: number
  amenity_units: number
  photo_units: number
  late_photo_units: number
  photo_asset_ids: string[]
  total: number
  target_count: number | null
  function_hash: string
  computed_at: string
}
type Drift = {
  venue_id: string
  staff_id: string
  snapshot_kind: string
  reason: string
  expected: boolean
  snapshot_function_hash: string | null
  live_function_hash: string
  snapshot_menu_units: number | null
  live_menu_units: number
  snapshot_amenity_units: number | null
  live_amenity_units: number
  snapshot_total: number
  live_total: number
  snapshot_target: number | null
  live_target: number | null
  added_since_snapshot: number
  late_since_snapshot: number
  removed_since_snapshot: number
}

beforeAll(async () => {
  admin = await createIdentity(service, {
    label: "scoring-policy-admin",
    role: "admin",
  })
})

// The RPC is not in lib/db/types.ts until types are regenerated.
function assign(
  client: Db,
  args: {
    venue: string
    startsOn: string
    policyKey?: string
    version?: number
    target?: number | null
    reason?: string | null
    key?: string
  }
) {
  const rpc = client.rpc.bind(client) as unknown as (
    fn: string,
    params: Record<string, unknown>
  ) => PromiseLike<{ data: Assignment[] | null; error: RpcError | null }>
  return rpc("scoring_assign_policy", {
    p_venue: args.venue,
    p_starts_on: args.startsOn,
    p_policy_key: args.policyKey ?? "combined",
    p_version: args.version ?? 1,
    p_target_count: args.target === undefined ? 5 : args.target,
    p_reason: args.reason === undefined ? "TEST assignment" : args.reason,
    p_request_key: args.key ?? requestKey(),
  })
}

async function world(label: string) {
  const venue = (await createVenue(service, label)).id
  const [staffA, staffB, manager] = await Promise.all([
    createIdentity(service, {
      label: `${label}-a`,
      role: "staff",
      venueId: venue,
    }),
    createIdentity(service, {
      label: `${label}-b`,
      role: "staff",
      venueId: venue,
    }),
    createIdentity(service, {
      label: `${label}-manager`,
      role: "manager",
      venueId: venue,
    }),
  ])
  await grantManager(admin, manager.id, venue)
  await ok(
    service
      .from("profiles")
      .update({ department: "boh" })
      .in("id", [staffA.id, staffB.id])
  )
  return { venue, staffA, staffB, manager }
}

/** Fixture: memberships at the venue started in `month` (stored history). */
function memberSince(venue: string, month: string) {
  psql(`update private.completion_staff_venue_memberships set started_at = '${midMonth(month)}'
    where venue_id = '${venue}' and ended_at is null`)
}

/** Fixture: a direct operator row, as completion-targets.test.ts writes them. */
function directRow(venue: string, month: string, target: number | null) {
  psql(`insert into private.venue_monthly_completion_targets(venue_id, starts_on, target_count)
    values ('${venue}', '${month}', ${target ?? "null"})`)
}

function closeMonth(month: string) {
  return JSON.parse(
    psql(`select coalesce(json_agg(c order by c.venue_id), '[]')
      from private.scoring_close_month('${month}'::date) c`)
  ) as { venue_id: string; outcome: string; participants: number }[]
}

const closedFor = (rows: ReturnType<typeof closeMonth>, venue: string) =>
  rows.filter((r) => r.venue_id === venue)

function snapshots(venue: string, month: string): Snapshot[] {
  return JSON.parse(
    psql(`select coalesce(json_agg(s order by s.kind, s.staff_id), '[]')
      from private.scoring_month_snapshots s
      where s.venue_id = '${venue}' and s.period_month = '${month}'`)
  )
}

function drift(venue: string, month: string): Drift[] {
  return JSON.parse(
    psql(`select coalesce(json_agg(d order by d.staff_id), '[]')
      from private.scoring_month_drift('${month}'::date) d
      where d.venue_id = '${venue}'`)
  )
}

function assignmentRows(venue: string) {
  return JSON.parse(
    psql(`select coalesce(json_agg(t order by t.starts_on), '[]')
      from private.venue_monthly_completion_targets t where t.venue_id = '${venue}'`)
  ) as {
    starts_on: string
    target_count: number | null
    policy_key: string
    policy_version: number
    approved_by: string | null
    assigned_by: string | null
    reason: string | null
    request_key: string | null
  }[]
}

function provisionApproval(opts: {
  key: string
  venue: string
  month: string
  target: number
  reason: string
  owner: string
  version?: number
}) {
  psql(`insert into private.scoring_first_enrolment_approvals
      (request_key, venue_id, starts_on, policy_key, policy_version, target_count, reason,
        approved_by, approved_at, approval_ref)
    values ('${opts.key}', '${opts.venue}', '${opts.month}', 'combined', ${opts.version ?? 1},
      ${opts.target}, '${opts.reason}', '${opts.owner}', '2026-11-10T09:00:00Z',
      'TEST-receipt-${opts.key}')`)
}

/** SQL as a signed-in user inside a rolled-back transaction. */
function asUser(userId: string, body: string, setup = "") {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" })
  return psql(`begin;
${setup}
set local role authenticated;
select set_config('request.jwt.claims', '${claims}', true);
${body}
rollback;`)
}

/** A separate privileged psql session, for holding a transaction open. */
function session(sql: string): Promise<{ code: number; err: string }> {
  const url = process.env.NABALENS_TEST_DB_URL!
  return new Promise((resolve) => {
    const child = spawn("psql", [url, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
      stdio: ["pipe", "ignore", "pipe"],
    })
    let err = ""
    child.stderr.on("data", (d) => (err += d))
    child.on("close", (code) => resolve({ code: code ?? 1, err }))
    child.stdin.end(sql)
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const GATE_CLASS = 80_801

/**
 * Orders two sessions on observable lock state, not on timing. The holder
 * takes an advisory lock and waits until the other session queues behind it;
 * the passer waits until the lock is held, then queues. Whatever the passer
 * ran before `pass` happened before anything the holder runs after `hold`,
 * and the passer resumes only after the holder's transaction ends.
 */
function gate() {
  const id = 1 + Math.floor(Math.random() * 2_000_000_000)
  const lock = `${GATE_CLASS}, ${id}`
  const seen = (granted: boolean) => `exists (select 1 from pg_locks l
      where l.locktype = 'advisory' and l.classid = ${GATE_CLASS} and l.objid = ${id}
        and l.objsubid = 2 and l.granted = ${granted})`
  const until = (condition: string) => `do $gate$
    begin
      for i in 1..400 loop
        exit when ${condition};
        perform pg_sleep(0.025);
      end loop;
      if not ${condition} then
        raise exception 'fixture_gate_timeout';
      end if;
    end $gate$;`
  return {
    hold: `select pg_advisory_xact_lock(${lock});\n${until(seen(false))}`,
    pass: `${until(seen(true))}\nselect pg_advisory_xact_lock_shared(${lock});`,
  }
}

/** A close snapshot recorded from the live result, with chosen fields altered. */
function recordAltered(
  venue: string,
  staff: string,
  month: string,
  alter: { swapMenuAmenity?: boolean; functionHash?: string }
) {
  const [menu, amenity] = alter.swapMenuAmenity
    ? ["x.amenity_units", "x.menu_units"]
    : ["x.menu_units", "x.amenity_units"]
  const hash = alter.functionHash ? `'${alter.functionHash}'` : "x.function_hash"
  psql(`insert into private.scoring_month_snapshots
      (venue_id, staff_id, period_month, kind, policy_key, policy_version, target_basis,
        menu_units, amenity_units, photo_units, late_photo_units, photo_asset_ids, total,
        target_count, function_hash, computed_at)
    select '${venue}', '${staff}', '${month}', 'close', x.policy_key, x.policy_version,
      x.target_basis, ${menu}, ${amenity}, x.photo_units, x.late_photo_units,
      x.photo_asset_ids, x.total, x.target_count, ${hash}, clock_timestamp()
    from private.scoring_participant_result('${venue}', '${staff}', '${month}') x`)
}

/** One backdated amenity unit for `author` in `month` (completion-targets pattern). */
function amenityUnit(venue: string, author: string, month: string) {
  const instant = midMonth(month)
  const check = randomUUID()
  const submission = randomUUID()
  psql(`
    begin;
    insert into public.venue_amenity_settings(venue_id) values ('${venue}');
    insert into public.venue_amenity_checks(id, venue_id, template_key, created_at)
    values ('${check}', '${venue}', 'darts', '${instant}');
    insert into public.amenity_submissions
      (id, check_id, venue_id, submitted_by, answer, reason, template_version,
        evidence_rule, idempotency_key, result_revision, created_at)
    values ('${submission}', '${check}', '${venue}', '${author}', 'not_applicable',
      'Checked with venue manager', 1, 'photo', '${randomUUID()}', 2, '${instant}');
    update public.venue_amenity_checks
    set current_submission_id = '${submission}', answered_by = '${author}', answered_at = '${instant}',
      answer = 'not_applicable', progress = 'complete', revision = 2
    where id = '${check}';
    insert into public.amenity_check_events(check_id, venue_id, kind, actor_id, detail, created_at)
    values ('${check}', '${venue}', 'submitted', '${author}',
      jsonb_build_object('submissionId', '${submission}', 'answer', 'not_applicable'), '${instant}');
    commit;
  `)
}

function progress(who: TestIdentity, venue: string, month: string) {
  return ok(
    who.client.rpc("coverage_staff_progress_v2", {
      p_venue_id: venue,
      p_period_month: month,
    })
  )
}

describe("scoring policy registry and access (C-B08-3)", () => {
  it("seeds exactly combined v1 and accepted_photos v1 with today's flags", () => {
    const rows = JSON.parse(
      psql(`select json_agg(json_build_object('key', p.policy_key, 'version', p.version,
          'rules', p.rules, 'approvedBy', p.approved_by) order by p.policy_key, p.version)
        from private.scoring_policies p`)
    )
    expect(rows).toEqual([
      {
        key: "accepted_photos",
        version: 1,
        approvedBy: null,
        rules: {
          unit: "accepted_photo_asset",
          target_scope: "person",
          credit_month: "upload_and_submit_month",
          late_acceptance_changes_closed_month: true,
        },
      },
      {
        key: "combined",
        version: 1,
        approvedBy: null,
        rules: {
          unit_scope: "author",
          require_gap_or_refresh: false,
          first_completer_keeps: false,
          system_recheck_keeps: false,
          photo_scores_once: false,
          self_review_scores: true,
          archive_keeps: false,
          credit_month: "decision",
          grace_days: 0,
        },
      },
    ])
    // An incomplete flag set is refused; nothing is left behind.
    expect(() =>
      psql(`begin;
        insert into private.scoring_policies(policy_key, version, rules, description)
        values ('combined', 99, '{"unit_scope": "subject"}', 'TEST incomplete');
        rollback;`)
    ).toThrow(/scoring_policies_rules_valid/)
    // A complete-looking flag set with a required enum set to JSON null reads
    // as SQL NULL, which a bare CHECK would pass. Each is refused.
    for (const [key, flag] of [
      ["combined", "unit_scope"],
      ["combined", "credit_month"],
      ["accepted_photos", "unit"],
      ["accepted_photos", "target_scope"],
      ["accepted_photos", "credit_month"],
    ] as const) {
      expect(
        () =>
          psql(`begin;
          insert into private.scoring_policies(policy_key, version, rules, description)
          select policy_key, 97, rules || jsonb_build_object('${flag}', null), 'TEST null enum'
          from private.scoring_policies where policy_key = '${key}' and version = 1;
          rollback;`),
        `${key}.${flag}`
      ).toThrow(/scoring_policies_rules_valid/)
    }
    expect(
      psql(`select count(*) from private.scoring_policies where version > 1`)
    ).toBe("0")
  })

  it("keeps every registered version append-only, referenced or not", async () => {
    // Before any reference exists: a fresh version is fixed once inserted, so
    // no edit can race a concurrent first reference.
    const draft = `insert into private.scoring_policies(policy_key, version, rules, description)
      select 'combined', 98, rules, 'TEST draft' from private.scoring_policies
      where policy_key = 'combined' and version = 1;`
    for (const change of [
      `update private.scoring_policies set description = 'TEST draft edited'
        where policy_key = 'combined' and version = 98;`,
      `update private.scoring_policies set rules = rules || '{"grace_days": 0}'
        where policy_key = 'combined' and version = 98;`,
      `delete from private.scoring_policies where policy_key = 'combined' and version = 98;`,
    ]) {
      expect(() => psql(`begin; ${draft} ${change} rollback;`), change).toThrow(
        /scoring_policy_immutable/
      )
    }
    expect(
      psql(`select count(*) from private.scoring_policies where version > 1`)
    ).toBe("0")

    // Referenced: the same refusals.
    const venue = (await createVenue(service, "scoring-policy-ref")).id
    await ok(
      assign(admin.client, { venue, startsOn: monthOffset(1), target: 3 })
    )
    expect(() =>
      psql(`update private.scoring_policies set rules = rules || '{"grace_days": 0}'
        where policy_key = 'combined' and version = 1`)
    ).toThrow(/scoring_policy_immutable/)
    expect(() =>
      psql(`update private.scoring_policies set description = 'TEST changed'
        where policy_key = 'combined' and version = 1`)
    ).toThrow(/scoring_policy_immutable/)
    expect(() =>
      psql(
        `delete from private.scoring_policies where policy_key = 'combined' and version = 1`
      )
    ).toThrow(/scoring_policy_immutable/)
    expect(() =>
      psql(`begin; truncate private.scoring_policies; rollback;`)
    ).toThrow(/scoring_policy_immutable|referenced in a foreign key/)
  })

  it("keeps private tables and functions closed and the command admin-only", async () => {
    const tables = [
      "private.scoring_policies",
      "private.scoring_first_enrolment_approvals",
      "private.scoring_month_snapshots",
      "private.venue_monthly_completion_targets",
    ]
    const access = JSON.parse(
      psql(`select json_agg(json_build_object('role', r.role, 'table', t.name,
          'any', has_table_privilege(r.role, t.name, 'select,insert,update,delete,truncate'),
          'rls', c.relrowsecurity))
        from (values ('anon'), ('authenticated'), ('service_role')) r(role)
        cross join unnest(array[${tables.map((t) => `'${t}'`).join(",")}]) t(name)
        join pg_class c on c.oid = t.name::regclass`)
    ) as { any: boolean; rls: boolean }[]
    expect(access).toHaveLength(12)
    for (const row of access)
      expect(row).toMatchObject({ any: false, rls: true })

    const functions = JSON.parse(
      psql(`select json_object_agg(n.nspname || '.' || p.proname || '('
          || replace(oidvectortypes(p.proargtypes), ' ', '') || ')', json_build_object(
          'anon', has_function_privilege('anon', p.oid, 'execute'),
          'authenticated', has_function_privilege('authenticated', p.oid, 'execute'),
          'service', has_function_privilege('service_role', p.oid, 'execute'),
          'public', exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0),
          'searchPath', p.proconfig @> array['search_path=""'],
          'definer', p.prosecdef))
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where (n.nspname = 'private' and (p.proname like 'scoring\\_%'
            or p.proname in ('lock_scoring_venue', 'assert_scoring_read_committed')))
          or (n.nspname = 'public' and p.proname like 'scoring\\_%')`)
    ) as Record<
      string,
      {
        anon: boolean
        authenticated: boolean
        service: boolean
        public: boolean
        searchPath: boolean
        definer: boolean
      }
    >
    expect(Object.keys(functions).sort()).toEqual(
      [
        "private.assert_scoring_read_committed()",
        "private.lock_scoring_venue(uuid)",
        "private.scoring_close_month(date)",
        "private.scoring_month_drift(date)",
        "private.scoring_month_roster(date)",
        "private.scoring_participant_result(uuid,uuid,date)",
        "private.scoring_policies_guard()",
        "private.scoring_policy_in_force(uuid,date)",
        "private.scoring_rules_valid(text,jsonb)",
        "private.scoring_targets_closed_month_guard()",
        ASSIGN_FN,
      ].sort()
    )
    for (const [name, fn] of Object.entries(functions)) {
      expect(fn.searchPath, name).toBe(true)
      expect(fn.anon || fn.service || fn.public, name).toBe(false)
      expect(fn.authenticated, name).toBe(name === ASSIGN_FN)
    }
    expect(functions[ASSIGN_FN]?.definer).toBe(true)

    const { venue, staffA, manager } = await world("scoring-access")
    await fails(
      assign(staffA.client, { venue, startsOn: monthOffset(1) }),
      "not_active_admin",
      "42501"
    )
    await fails(
      assign(manager.client, { venue, startsOn: monthOffset(1) }),
      "not_active_admin",
      "42501"
    )
    const { error } = await assign(anonClient(), {
      venue,
      startsOn: monthOffset(1),
    })
    expect(error?.code).toBe("42501")
    expect(assignmentRows(venue)).toEqual([])
  })

  it("pins the credit function and never redefines protected functions", () => {
    expect(
      psql(`select md5(pg_get_functiondef('${COUNTS_FN}'::regprocedure))`)
    ).toBe(CREDIT_HASH)
    const sql = readFileSync(MIGRATION, "utf8")
    expect(sql).not.toMatch(/create\s+or\s+replace/i)
    expect(sql).not.toMatch(/\b(drop|alter)\s+function\b/i)
    const created = [...sql.matchAll(/create\s+function\s+([\w.]+)/gi)].map(
      (m) => m[1]
    )
    expect(created).toHaveLength(11)
    for (const name of created) expect(name).toMatch(/scoring/)
    const triggerTables = [
      ...sql.matchAll(
        /create\s+trigger\s+\w+\s+before\s+[\w\s]+?\s+on\s+([\w.]+)/gi
      ),
    ].map((m) => m[1])
    expect(new Set(triggerTables)).toEqual(
      new Set([
        "private.scoring_first_enrolment_approvals",
        "private.scoring_month_snapshots",
        "private.scoring_policies",
        "private.venue_monthly_completion_targets",
      ])
    )
    // The approval table has no write path in the public API.
    expect(
      psql(`select coalesce(string_agg(p.proname, ',' order by p.proname), '')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosrc like '%scoring_first_enrolment_approvals%'`)
    ).toBe("scoring_assign_policy")
    expect(
      psql(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'scoring_assign_policy'`)
    ).toBe("1")
  })
})

describe("policy assignment command (C-B08-2)", () => {
  it("assigns a future month, replays, and leaves current and past results byte-identical", async () => {
    const combined = await world("scoring-future")
    const legacy = await world("scoring-future-legacy")
    directRow(combined.venue, currentMonth(), 5)
    const read = async () =>
      JSON.stringify({
        combinedNow: await progress(admin, combined.venue, currentMonth()),
        combinedPast: await progress(admin, combined.venue, monthOffset(-1)),
        legacyNow: await progress(admin, legacy.venue, currentMonth()),
        legacyPast: await progress(admin, legacy.venue, monthOffset(-1)),
        legacyRpc: await staffProgress(admin, legacy.venue, currentMonth()),
      })
    const before = await read()

    const key = requestKey()
    const [row] = await ok(
      assign(admin.client, {
        venue: combined.venue,
        startsOn: monthOffset(1),
        target: 4,
        reason: "  TEST next month  ",
        key,
      })
    )
    expect(row).toMatchObject({
      venue_id: combined.venue,
      starts_on: monthOffset(1),
      policy_key: "combined",
      policy_version: 1,
      target_count: 4,
      reason: "TEST next month",
      approved_by: admin.id,
      first_enrolment: false,
      replayed: false,
    })
    // The same key and normalised input returns the recorded result.
    const [again] = await ok(
      assign(admin.client, {
        venue: combined.venue,
        startsOn: monthOffset(1),
        target: 4,
        reason: "TEST next month",
        key,
      })
    )
    expect(again).toEqual({ ...row, replayed: true })
    await fails(
      assign(admin.client, {
        venue: combined.venue,
        startsOn: monthOffset(1),
        target: 6,
        key,
      }),
      "idempotency_key_reused"
    )
    await fails(
      assign(admin.client, {
        venue: combined.venue,
        startsOn: monthOffset(1),
        target: 4,
      }),
      "scoring_assignment_exists"
    )
    await ok(
      assign(admin.client, {
        venue: legacy.venue,
        startsOn: monthOffset(2),
        target: 6,
      })
    )
    await ok(
      assign(admin.client, {
        venue: combined.venue,
        startsOn: monthOffset(3),
        policyKey: "accepted_photos",
        target: null,
      })
    )

    expect(await read()).toBe(before)
    expect(assignmentRows(combined.venue)).toMatchObject([
      {
        starts_on: currentMonth(),
        target_count: 5,
        policy_key: "combined",
        request_key: null,
      },
      {
        starts_on: monthOffset(1),
        target_count: 4,
        approved_by: admin.id,
        assigned_by: admin.id,
        request_key: key,
      },
      {
        starts_on: monthOffset(3),
        target_count: null,
        policy_key: "accepted_photos",
      },
    ])
    const [next] = await progress(admin, combined.venue, monthOffset(1))
    expect(next).toMatchObject({
      target_basis: "menu_items_and_amenities",
      target_count: 4,
    })
  })

  it("refuses past months, malformed input and unregistered policies", async () => {
    const { venue } = await world("scoring-refusals")
    const refuse = (
      args: Partial<Parameters<typeof assign>[1]>,
      message: string
    ) =>
      fails(
        assign(admin.client, { venue, startsOn: monthOffset(1), ...args }),
        message
      )
    await refuse({ startsOn: monthOffset(-1) }, "scoring_month_not_assignable")
    await refuse(
      { startsOn: `${monthOffset(1).slice(0, 8)}15` },
      "invalid_period"
    )
    await refuse({ version: 2 }, "scoring_policy_not_found")
    await refuse(
      { policyKey: "accepted_photos", version: 2, target: null },
      "scoring_policy_not_found"
    )
    await refuse({ target: null }, "invalid_target_count")
    await refuse({ target: 501 }, "invalid_target_count")
    await refuse(
      { policyKey: "accepted_photos", target: 5 },
      "invalid_target_count"
    )
    await refuse({ reason: "  " }, "reason_required")
    await refuse({ key: "short" }, "invalid_request_key")
    await refuse({ venue: randomUUID() }, "venue_not_found")
    expect(assignmentRows(venue)).toEqual([])
  })

  it("enrols a first current month only with a matching owner approval record", async () => {
    const { venue } = await world("scoring-first-enrolment")
    const owner = randomUUID()
    const month = currentMonth()
    const reason = "TEST owner approved first enrolment"
    const pastBefore = JSON.stringify(
      await progress(admin, venue, monthOffset(-1))
    )

    // No record for the key.
    await fails(
      assign(admin.client, { venue, startsOn: month, target: 3, reason }),
      "scoring_approval_required",
      "42501"
    )
    // A record whose scope differs in any bound field.
    const other = (await createVenue(service, "scoring-approval-other")).id
    for (const scope of [
      { target: 4 },
      { reason: "TEST a different reason" },
      { venue: other },
    ]) {
      const key = requestKey()
      provisionApproval({
        key,
        venue,
        month,
        target: 3,
        reason,
        owner,
        ...scope,
      })
      await fails(
        assign(admin.client, {
          venue,
          startsOn: month,
          target: 3,
          reason,
          key,
        }),
        "scoring_approval_mismatch",
        "42501"
      )
    }
    // A record for next month does not cover this month.
    const nextKey = requestKey()
    provisionApproval({
      key: nextKey,
      venue,
      month: monthOffset(1),
      target: 3,
      reason,
      owner,
    })
    await fails(
      assign(admin.client, {
        venue,
        startsOn: month,
        target: 3,
        reason,
        key: nextKey,
      }),
      "scoring_approval_mismatch"
    )
    // An admin session cannot provision or read approvals, nor can the service role.
    const insertApproval = `insert into private.scoring_first_enrolment_approvals
        (request_key, venue_id, starts_on, policy_key, policy_version, target_count, reason,
          approved_by, approved_at, approval_ref)
      values ('${requestKey()}', '${venue}', '${month}', 'combined', 1, 3, '${reason}',
        '${admin.id}', now(), 'TEST-self');`
    expect(() => asUser(admin.id, insertApproval)).toThrow(/permission denied/)
    expect(() =>
      asUser(
        admin.id,
        "select count(*) from private.scoring_first_enrolment_approvals;"
      )
    ).toThrow(/permission denied/)
    expect(() =>
      psql(`begin; set local role service_role; ${insertApproval} rollback;`)
    ).toThrow(/permission denied/)

    // A current-month v2 request is refused even with a matching record.
    expect(() =>
      asUser(
        admin.id,
        `select * from public.scoring_assign_policy('${venue}', '${month}', 'combined', 2, 3,
          '${reason}', 'test-v2-current-month');`,
        `insert into private.scoring_policies(policy_key, version, rules, description)
          select 'combined', 2, rules || '{"unit_scope": "subject"}', 'TEST v2'
          from private.scoring_policies where policy_key = 'combined' and version = 1;
        insert into private.scoring_first_enrolment_approvals
          (request_key, venue_id, starts_on, policy_key, policy_version, target_count, reason,
            approved_by, approved_at, approval_ref)
        values ('test-v2-current-month', '${venue}', '${month}', 'combined', 2, 3, '${reason}',
          '${owner}', now(), 'TEST-v2');`
      )
    ).toThrow(/scoring_month_not_assignable/)
    expect(assignmentRows(venue)).toEqual([])

    // The matching record: the owner's attribution, not the executing admin's.
    const key = requestKey()
    provisionApproval({ key, venue, month, target: 3, reason, owner })
    const [row] = await ok(
      assign(admin.client, {
        venue,
        startsOn: month,
        target: 3,
        reason: ` ${reason} `,
        key,
      })
    )
    expect(row).toMatchObject({
      starts_on: month,
      policy_key: "combined",
      policy_version: 1,
      target_count: 3,
      approved_by: owner,
      first_enrolment: true,
      replayed: false,
    })
    expect(new Date(row!.approved_at).toISOString()).toBe(
      "2026-11-10T09:00:00.000Z"
    )
    const [replay] = await ok(
      assign(admin.client, { venue, startsOn: month, target: 3, reason, key })
    )
    expect(replay).toEqual({ ...row, replayed: true })
    await fails(
      assign(admin.client, { venue, startsOn: month, target: 2, reason, key }),
      "idempotency_key_reused"
    )
    expect(assignmentRows(venue)).toMatchObject([
      {
        starts_on: month,
        approved_by: owner,
        assigned_by: admin.id,
        request_key: key,
      },
    ])
    // The intended change is this month only; the previous month is unchanged.
    const [now] = await progress(admin, venue, month)
    expect(now).toMatchObject({
      target_basis: "menu_items_and_amenities",
      target_count: 3,
    })
    expect(JSON.stringify(await progress(admin, venue, monthOffset(-1)))).toBe(
      pastBefore
    )

    // A second request for the occupied slot is refused, even with a record.
    const second = requestKey()
    provisionApproval({ key: second, venue, month, target: 3, reason, owner })
    await fails(
      assign(admin.client, {
        venue,
        startsOn: month,
        target: 3,
        reason,
        key: second,
      }),
      "scoring_assignment_exists"
    )
  })

  it("never overrides an explicit current-month row or a prior combined enrolment", async () => {
    const month = currentMonth()
    const owner = randomUUID()
    const reason = "TEST first enrolment"

    const explicit = (await createVenue(service, "scoring-explicit-legacy")).id
    directRow(explicit, month, null)
    const k1 = requestKey()
    provisionApproval({
      key: k1,
      venue: explicit,
      month,
      target: 3,
      reason,
      owner,
    })
    await fails(
      assign(admin.client, {
        venue: explicit,
        startsOn: month,
        target: 3,
        reason,
        key: k1,
      }),
      "scoring_assignment_exists"
    )

    // Combined from an earlier month, then legacy again: not a first enrolment.
    const prior = (await createVenue(service, "scoring-prior-combined")).id
    directRow(prior, monthOffset(-3), 5)
    directRow(prior, monthOffset(-1), null)
    const k2 = requestKey()
    provisionApproval({
      key: k2,
      venue: prior,
      month,
      target: 3,
      reason,
      owner,
    })
    await fails(
      assign(admin.client, {
        venue: prior,
        startsOn: month,
        target: 3,
        reason,
        key: k2,
      }),
      "scoring_month_not_assignable"
    )

    // Legacy is never assigned for the current month.
    const legacy = (await createVenue(service, "scoring-current-legacy")).id
    await fails(
      assign(admin.client, {
        venue: legacy,
        startsOn: month,
        policyKey: "accepted_photos",
        target: null,
        reason,
      }),
      "scoring_month_not_assignable"
    )
    expect(assignmentRows(legacy)).toEqual([])
  })

  it("enrols a first current month beside a future combined assignment", async () => {
    const { venue } = await world("scoring-first-beside-future")
    const owner = randomUUID()
    const month = currentMonth()
    const reason = "TEST first enrolment beside a future row"
    // A combined row scheduled for next month is not a prior enrolment.
    await ok(
      assign(admin.client, { venue, startsOn: monthOffset(1), target: 4 })
    )
    const futureRow = () =>
      psql(`select row_to_json(t)::text from private.venue_monthly_completion_targets t
        where t.venue_id = '${venue}' and t.starts_on = '${monthOffset(1)}'`)
    const future = futureRow()
    expect(future).not.toBe("")
    const pastBefore = JSON.stringify(
      await progress(admin, venue, monthOffset(-1))
    )

    const key = requestKey()
    provisionApproval({ key, venue, month, target: 3, reason, owner })
    const [row] = await ok(
      assign(admin.client, { venue, startsOn: month, target: 3, reason, key })
    )
    expect(row).toMatchObject({
      starts_on: month,
      policy_key: "combined",
      policy_version: 1,
      target_count: 3,
      approved_by: owner,
      first_enrolment: true,
      replayed: false,
    })
    expect(new Date(row!.approved_at).toISOString()).toBe(
      "2026-11-10T09:00:00.000Z"
    )
    const [replay] = await ok(
      assign(admin.client, { venue, startsOn: month, target: 3, reason, key })
    )
    expect(replay).toEqual({ ...row, replayed: true })

    expect(futureRow()).toBe(future)
    expect(JSON.stringify(await progress(admin, venue, monthOffset(-1)))).toBe(
      pastBefore
    )
    expect(
      assignmentRows(venue).map((r) => [
        r.starts_on,
        r.target_count,
        r.approved_by,
        r.assigned_by,
      ])
    ).toEqual([
      [month, 3, owner, admin.id],
      [monthOffset(1), 4, admin.id, admin.id],
    ])
  })
})

describe("closed-month protection (C-B08-2)", () => {
  const closed = monthOffset(-2)

  it("refuses inserts, updates and deletes that change a closed month, including earlier rows", async () => {
    const { venue, staffA } = await world("scoring-protect")
    memberSince(venue, monthOffset(-3))
    directRow(venue, monthOffset(-3), 5)

    expect(() => closeMonth(currentMonth())).toThrow(
      /scoring_month_not_complete/
    )
    expect(() =>
      psql(
        `select private.scoring_close_month('${closed.slice(0, 8)}15'::date)`
      )
    ).toThrow(/invalid_period/)
    expect(closedFor(closeMonth(closed), venue)).toEqual([
      { venue_id: venue, outcome: "closed", participants: 2 },
    ])
    const [snapshot] = snapshots(venue, closed).filter(
      (s) => s.staff_id === staffA.id
    )
    expect(snapshot).toMatchObject({
      kind: "close",
      policy_key: "combined",
      policy_version: 1,
      target_basis: "menu_items_and_amenities",
      target_count: 5,
      total: 0,
      function_hash: CREDIT_HASH,
    })

    const refused = (sql: string) =>
      expect(() => psql(sql)).toThrow(/scoring_month_closed/)
    refused(`insert into private.venue_monthly_completion_targets(venue_id, starts_on, target_count)
      values ('${venue}', '${closed}', 6)`)
    refused(`update private.venue_monthly_completion_targets set target_count = 7
      where venue_id = '${venue}' and starts_on = '${monthOffset(-3)}'`)
    refused(`update private.venue_monthly_completion_targets set target_count = null
      where venue_id = '${venue}' and starts_on = '${monthOffset(-3)}'`)
    refused(`update private.venue_monthly_completion_targets set starts_on = '${monthOffset(-1)}'
      where venue_id = '${venue}' and starts_on = '${monthOffset(-3)}'`)
    refused(`delete from private.venue_monthly_completion_targets
      where venue_id = '${venue}' and starts_on = '${monthOffset(-3)}'`)
    refused(
      `begin; truncate private.venue_monthly_completion_targets; rollback;`
    )

    // Writes that leave the closed month's policy and target alone still work.
    psql(`update private.venue_monthly_completion_targets set reason = 'TEST note'
      where venue_id = '${venue}' and starts_on = '${monthOffset(-3)}'`)
    directRow(venue, monthOffset(-1), 8)
    psql(`delete from private.venue_monthly_completion_targets
      where venue_id = '${venue}' and starts_on = '${monthOffset(-1)}'`)
    await ok(
      assign(admin.client, { venue, startsOn: monthOffset(1), target: 9 })
    )
    expect(
      assignmentRows(venue).map((r) => [r.starts_on, r.target_count])
    ).toEqual([
      [monthOffset(-3), 5],
      [monthOffset(1), 9],
    ])
    expect(snapshots(venue, closed)).toHaveLength(2)
  })

  it("never treats a baseline as a close", async () => {
    const month = monthOffset(-8)
    const { venue, staffA } = await world("scoring-baseline")
    memberSince(venue, month)
    psql(`insert into private.scoring_month_snapshots
        (venue_id, staff_id, period_month, kind, policy_key, policy_version, target_basis,
          menu_units, amenity_units, photo_units, late_photo_units, photo_asset_ids, total,
          target_count, function_hash, computed_at)
      values ('${venue}', '${staffA.id}', '${month}', 'baseline', 'accepted_photos', 1,
        'accepted_photos', 0, 0, 3, 0,
        array['${randomUUID()}', '${randomUUID()}', '${randomUUID()}']::uuid[], 3, null,
        '${CREDIT_HASH}', now())`)
    // Unprotected: the month's policy may still be set directly.
    directRow(venue, month, 5)
    expect(closedFor(closeMonth(month), venue)).toEqual([
      { venue_id: venue, outcome: "baseline_only", participants: 1 },
    ])
    expect(snapshots(venue, month).map((s) => s.kind)).toEqual(["baseline"])
    psql(`update private.venue_monthly_completion_targets set target_count = 6
      where venue_id = '${venue}' and starts_on = '${month}'`)
    const found = drift(venue, month)
    expect(found).toHaveLength(2)
    expect(found.find((d) => d.staff_id === staffA.id)).toMatchObject({
      snapshot_kind: "baseline",
      reason: "policy_changed",
      expected: false,
      snapshot_total: 3,
      live_target: 6,
    })
    expect(found.find((d) => d.staff_id !== staffA.id)).toMatchObject({
      snapshot_kind: "baseline",
      reason: "participant_added",
      expected: false,
    })
    // Baselines from installation never cover the current or a later month.
    expect(
      psql(`select count(*) from private.scoring_month_snapshots
        where kind = 'baseline' and period_month >= '${currentMonth()}'`)
    ).toBe("0")
  })

  it("serialises a close with an assignment for the same venue", async () => {
    // An assignment committing while the close waits is read by the close.
    const first = monthOffset(-10)
    const a = await world("scoring-race-assign")
    memberSince(a.venue, first)
    const writer = session(`begin;
      insert into private.venue_monthly_completion_targets(venue_id, starts_on, target_count)
      values ('${a.venue}', '${first}', 9);
      select pg_sleep(3);
      commit;`)
    await sleep(800)
    const closer = session(
      `select count(*) from private.scoring_close_month('${first}'::date);`
    )
    expect(await writer).toMatchObject({ code: 0 })
    expect(await closer).toMatchObject({ code: 0 })
    expect(snapshots(a.venue, first).map((s) => s.target_count)).toEqual([9, 9])

    // A close committing while the assignment waits refuses the assignment.
    const second = monthOffset(-11)
    const b = await world("scoring-race-close")
    memberSince(b.venue, second)
    const closing = session(`begin;
      select count(*) from private.scoring_close_month('${second}'::date);
      select pg_sleep(3);
      commit;`)
    await sleep(800)
    const late =
      session(`insert into private.venue_monthly_completion_targets(venue_id, starts_on, target_count)
      values ('${b.venue}', '${second}', 4);`)
    expect(await closing).toMatchObject({ code: 0 })
    const result = await late
    expect(result.code).not.toBe(0)
    expect(result.err).toMatch(/scoring_month_closed/)
    expect(snapshots(b.venue, second).map((s) => s.target_count)).toEqual([
      null,
      null,
    ])
    expect(assignmentRows(b.venue)).toEqual([])
  })

  it("refuses a truncate whose snapshot predates a concurrent close", async () => {
    const month = monthOffset(-12)
    const { venue } = await world("scoring-truncate-race")
    memberSince(venue, month)
    directRow(venue, month, 5)
    const before = assignmentRows(venue)
    const g = gate()
    // The truncating transaction reads the snapshot table under REPEATABLE
    // READ first, so its snapshot cannot see the close committed afterwards.
    const truncating = session(`begin isolation level repeatable read;
      select count(*) from private.scoring_month_snapshots;
      ${g.pass}
      truncate private.venue_monthly_completion_targets;
      rollback;`)
    const closing = session(`begin;
      ${g.hold}
      select count(*) from private.scoring_close_month('${month}'::date);
      commit;`)
    expect(await closing).toMatchObject({ code: 0 })
    const result = await truncating
    expect(result.code).not.toBe(0)
    expect(result.err).toMatch(/scoring_requires_read_committed/)
    expect(assignmentRows(venue)).toEqual(before)
    expect(
      snapshots(venue, month).map((s) => [s.kind, s.target_count])
    ).toEqual([
      ["close", 5],
      ["close", 5],
    ])
  })
})

// Legacy photos here are accepted by the admin, as in design E30: B01's
// deny_manager_coverage_writes trigger refuses coverage writes from a manager
// account, so world()'s manager cannot review them.
describe("month close and drift (C-B08-5)", () => {
  it("closes once per participant, keeps snapshots after a profile deletion, and reports drift", async () => {
    const month = monthOffset(-4)
    const { venue, staffA, staffB } = await world("scoring-close")
    memberSince(venue, month)
    directRow(venue, month, 5)
    amenityUnit(venue, staffA.id, month)
    const live = (await progress(admin, venue, month)).find(
      (r) => r.staff_id === staffA.id
    )
    expect(live).toMatchObject({
      amenity_checks_completed: 1,
      completion_count: 1,
      target_count: 5,
    })

    expect(closedFor(closeMonth(month), venue)).toEqual([
      { venue_id: venue, outcome: "closed", participants: 2 },
    ])
    expect(closedFor(closeMonth(month), venue)).toEqual([
      { venue_id: venue, outcome: "already_closed", participants: 2 },
    ])
    const recorded = snapshots(venue, month)
    expect(recorded).toHaveLength(2)
    expect(recorded.find((s) => s.staff_id === staffA.id)).toMatchObject({
      kind: "close",
      policy_key: "combined",
      policy_version: 1,
      menu_units: 0,
      amenity_units: 1,
      photo_units: 0,
      total: live!.completion_count,
      target_count: 5,
      function_hash: CREDIT_HASH,
    })
    expect(drift(venue, month)).toEqual([])

    expect(() =>
      psql(`update private.scoring_month_snapshots set total = 9
        where venue_id = '${venue}' and period_month = '${month}'`)
    ).toThrow(/audit_append_only/)
    expect(() =>
      psql(`delete from private.scoring_month_snapshots
        where venue_id = '${venue}' and period_month = '${month}'`)
    ).toThrow(/audit_append_only/)

    const { error } = await service.auth.admin.deleteUser(staffB.id)
    expect(error).toBeNull()
    expect(snapshots(venue, month)).toEqual(recorded)
    expect(drift(venue, month)).toEqual([
      expect.objectContaining({
        staff_id: staffB.id,
        snapshot_kind: "close",
        reason: "profile_deleted",
        expected: false,
        snapshot_total: 0,
        live_total: 0,
      }),
    ])
    // Drift is a report: another close adds nothing and counts are unchanged.
    expect(closedFor(closeMonth(month), venue)).toEqual([
      { venue_id: venue, outcome: "already_closed", participants: 2 },
    ])
    expect(snapshots(venue, month)).toEqual(recorded)
    expect(
      (await progress(admin, venue, month)).find(
        (r) => r.staff_id === staffA.id
      )
    ).toEqual(live)
  })

  it("labels a legacy late acceptance after close as expected drift", async () => {
    const month = monthOffset(-6)
    const { venue, staffA } = await world("scoring-legacy-close")
    memberSince(venue, month)
    const asset = await insertAsset(service, {
      venue,
      uploader: staffA.id,
      createdAt: midMonth(month),
    })
    const item = await insertSubmittedItem(service, {
      asset,
      venue,
      author: staffA.id,
      submittedAt: midMonth(month),
    })

    expect(closedFor(closeMonth(month), venue)).toEqual([
      { venue_id: venue, outcome: "closed", participants: 2 },
    ])
    const recorded = snapshots(venue, month)
    expect(recorded.find((s) => s.staff_id === staffA.id)).toMatchObject({
      policy_key: "accepted_photos",
      policy_version: 1,
      target_basis: "accepted_photos",
      photo_units: 0,
      total: 0,
      target_count: null,
      function_hash: psql(
        `select md5(pg_get_functiondef('private.monthly_credit_items(date)'::regprocedure))`
      ),
    })

    await accept(service, admin, item)
    const row = (await progress(admin, venue, month)).find(
      (r) => r.staff_id === staffA.id
    )
    expect(row).toMatchObject({
      target_basis: "accepted_photos",
      accepted_count: 1,
      late_accepted_count: 1,
      completion_count: 0,
    })
    expect(drift(venue, month)).toEqual([
      expect.objectContaining({
        staff_id: staffA.id,
        snapshot_kind: "close",
        reason: "legacy_late_acceptance",
        expected: true,
        snapshot_total: 0,
        live_total: 1,
        added_since_snapshot: 1,
        late_since_snapshot: 1,
        removed_since_snapshot: 0,
      }),
    ])
    expect(snapshots(venue, month)).toEqual(recorded)
  })

  it("reports a same-total breakdown change and a definition change as unexpected drift", async () => {
    const month = monthOffset(-13)
    const { venue, staffA, staffB } = await world("scoring-drift-identity")
    memberSince(venue, month)
    directRow(venue, month, 5)
    amenityUnit(venue, staffA.id, month)
    const live = JSON.stringify(await progress(admin, venue, month))
    // Recorded closes that differ from the live result only in the breakdown
    // (menu and amenity swapped, same total) or only in the function hash.
    recordAltered(venue, staffA.id, month, { swapMenuAmenity: true })
    const otherHash = psql(`select md5('TEST another definition')`)
    recordAltered(venue, staffB.id, month, { functionHash: otherHash })
    const recorded = snapshots(venue, month)
    expect(
      recorded.map((s) => [s.staff_id, s.menu_units, s.amenity_units, s.total])
    ).toEqual(
      expect.arrayContaining([
        [staffA.id, 1, 0, 1],
        [staffB.id, 0, 0, 0],
      ])
    )

    const found = drift(venue, month)
    expect(found).toHaveLength(2)
    expect(found.find((d) => d.staff_id === staffA.id)).toMatchObject({
      snapshot_kind: "close",
      reason: "count_changed",
      expected: false,
      snapshot_menu_units: 1,
      live_menu_units: 0,
      snapshot_amenity_units: 0,
      live_amenity_units: 1,
      snapshot_total: 1,
      live_total: 1,
    })
    expect(found.find((d) => d.staff_id === staffB.id)).toMatchObject({
      snapshot_kind: "close",
      reason: "definition_changed",
      expected: false,
      snapshot_function_hash: otherHash,
      live_function_hash: CREDIT_HASH,
      snapshot_total: 0,
      live_total: 0,
    })
    // Read-only: snapshots and progress are unchanged.
    expect(snapshots(venue, month)).toEqual(recorded)
    expect(JSON.stringify(await progress(admin, venue, month))).toBe(live)
  })

  it("labels an acceptance decided before the close but committed after it as expected", async () => {
    const month = monthOffset(-15)
    const { venue, staffA } = await world("scoring-legacy-straddle")
    memberSince(venue, month)
    const asset = await insertAsset(service, {
      venue,
      uploader: staffA.id,
      createdAt: midMonth(month),
    })
    const item = await insertSubmittedItem(service, {
      asset,
      venue,
      author: staffA.id,
      submittedAt: midMonth(month),
    })
    const { revision } = await itemRevision(service, item)
    const g = gate()
    const claims = JSON.stringify({ sub: admin.id, role: "authenticated" })
    // The released writer stamps decided_at = now(), its transaction start,
    // which precedes the close; the commit follows it.
    const accepting = session(`begin;
      set local role authenticated;
      select set_config('request.jwt.claims', '${claims}', true);
      select count(*) from public.review_coverage_item('${item}', ${revision}, 'accepted');
      reset role;
      ${g.pass}
      commit;`)
    const closing = session(`begin;
      ${g.hold}
      select count(*) from private.scoring_close_month('${month}'::date);
      commit;`)
    expect(await closing).toMatchObject({ code: 0 })
    expect(await accepting).toMatchObject({ code: 0 })

    const recorded = snapshots(venue, month)
    expect(recorded.find((s) => s.staff_id === staffA.id)).toMatchObject({
      kind: "close",
      policy_key: "accepted_photos",
      photo_units: 0,
      photo_asset_ids: [],
      total: 0,
    })
    expect(
      psql(`select i.decided_at < s.computed_at
        from public.coverage_submission_items i, private.scoring_month_snapshots s
        where i.id = '${item}' and i.state = 'accepted' and s.venue_id = '${venue}'
          and s.staff_id = '${staffA.id}' and s.period_month = '${month}'`)
    ).toBe("t")
    expect(drift(venue, month)).toEqual([
      expect.objectContaining({
        staff_id: staffA.id,
        snapshot_kind: "close",
        reason: "legacy_late_acceptance",
        expected: true,
        snapshot_total: 0,
        live_total: 1,
        added_since_snapshot: 1,
        late_since_snapshot: 1,
        removed_since_snapshot: 0,
      }),
    ])
    expect(snapshots(venue, month)).toEqual(recorded)
  })

  it("reports a lost counted asset beside late additions as unexpected", async () => {
    const month = monthOffset(-16)
    const { venue, staffA } = await world("scoring-legacy-mixed")
    memberSince(venue, month)
    const assets: string[] = []
    const items: string[] = []
    for (let i = 0; i < 3; i++) {
      const asset = await insertAsset(service, {
        venue,
        uploader: staffA.id,
        createdAt: midMonth(month),
      })
      assets.push(asset.id)
      items.push(
        await insertSubmittedItem(service, {
          asset,
          venue,
          author: staffA.id,
          submittedAt: midMonth(month),
        })
      )
    }
    await accept(service, admin, items[0]!)
    expect(closedFor(closeMonth(month), venue)).toEqual([
      { venue_id: venue, outcome: "closed", participants: 2 },
    ])
    const recorded = snapshots(venue, month)
    expect(recorded.find((s) => s.staff_id === staffA.id)).toMatchObject({
      photo_units: 1,
      photo_asset_ids: [assets[0]],
      total: 1,
    })

    // The counted asset leaves the month (a tombstone dated inside it) and
    // two late acceptances arrive: a net increase, but not only additions.
    psql(`update public.media_assets set deleted_at = '${month.slice(0, 8)}20T12:00:00Z'
      where id = '${assets[0]}'`)
    await accept(service, admin, items[1]!)
    await accept(service, admin, items[2]!)
    expect(
      (await progress(admin, venue, month)).find(
        (r) => r.staff_id === staffA.id
      )
    ).toMatchObject({ accepted_count: 2, late_accepted_count: 2 })
    expect(drift(venue, month)).toEqual([
      expect.objectContaining({
        staff_id: staffA.id,
        snapshot_kind: "close",
        reason: "count_changed",
        expected: false,
        snapshot_total: 1,
        live_total: 2,
        added_since_snapshot: 2,
        late_since_snapshot: 2,
        removed_since_snapshot: 1,
      }),
    ])
    expect(snapshots(venue, month)).toEqual(recorded)
  })
})
