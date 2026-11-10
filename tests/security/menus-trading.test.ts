// B04-b1 database contract (b04-design §5, §10, A1-4, A1-5, §18 L2/L4, §19.2
// S2): trading lines, assertions, decisions, availability schedules and
// exceptions, temporary unavailability and the b1 recheck foundation.
// Parser and value-schema parity with lib/menus/trading (the same fixtures),
// structural venue scope, the role matrix (V01), venue isolation (V02),
// privacy (V11), one-winner decisions and request-key replay, the
// local-midnight cutover and history through the read path, withdrawn and
// conflicting values, schedules over the shared B03 occurrence fixtures, a
// linked B03 service read as of one instant (with a deliberate stop),
// rechecks with the job stopped and run twice, authority and catalogue
// re-read under the venue menu lock (demotion, inactive targets, activation
// and job races), source snapshot provenance, and the T9b catalogue
// assertions. Every command runs as a real signed-in identity through
// PostgREST, or as one in a psql transaction that always rolls back; psql
// (postgres, local only) reads state back and sets up history rows.
//
// Fixture safety: every row is in this suite's synthetic venues. Direct
// writes against the guards name exact fixture ids and run inside a block
// that always raises, so nothing commits even if a guard regressed
// (including TRUNCATE). The private job runs bounded to this suite's venues
// or inside a rolled-back transaction, never across the retained baseline.
// Temporary `until` deadlines are an hour ahead and read with an explicit
// as-of instant, never by waiting for the clock.
import { execFileSync, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { beforeAll, describe, expect, it } from "vitest"

import {
  scheduleStateAt,
  type LocalMenuSchedule,
} from "../../lib/menus/trading/availability"
import { PRICE_PARSE_FIXTURES } from "../../lib/menus/trading/price"
import { resolveField, type LineRecords } from "../../lib/menus/trading/resolve"
import {
  PRICE_MAX_MINOR,
  tradingValueProblem,
  type TradingField,
} from "../../lib/menus/trading/types"
import {
  localInstant,
  scheduleProblems,
  type Occurrence,
} from "../../lib/server/knowledge/schedules"
import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { legacyStaffGrant, makeManager, psql } from "./coverage-fixtures"
import { photo, world, type World } from "./knowledge-fixtures"
import {
  createDraft,
  item,
  menu,
  publishMenu,
  readDocument,
  section,
} from "./menus-fixtures"

type RpcError = { code: string; message: string; details?: string }
type Rpc = {
  rpc(
    fn: string,
    args?: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: RpcError | null }>
}
const service = serviceClient()
const rpc = (
  who: TestIdentity,
  fn: string,
  args: Record<string, unknown> = {}
) => (who.client as unknown as Rpc).rpc(fn, args)

async function ok<T = Record<string, unknown>>(
  call: PromiseLike<{ data: unknown; error: RpcError | null }>
): Promise<T> {
  const { data, error } = await call
  if (error)
    throw new Error(`${error.message} (${error.code}) ${error.details ?? ""}`)
  return data as T
}
async function fails(
  call: PromiseLike<{ data: unknown; error: RpcError | null }>,
  message: string,
  code?: string
) {
  const { error } = await call
  expect(error, `expected ${message}`).not.toBeNull()
  expect(error!.message).toBe(message)
  if (code) expect(error!.code).toBe(code)
  return error!
}
function rows<T = Record<string, unknown>>(sql: string): T[] {
  return JSON.parse(
    psql(`select coalesce(json_agg(t), '[]') from (${sql}) t`)
  ) as T[]
}
const literal = (text: string) => `'${text.replace(/'/g, "''")}'`
const sqlJson = (value: unknown) => `${literal(JSON.stringify(value))}::jsonb`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function localDbUrl(): string {
  const url = process.env.NABALENS_TEST_DB_URL
  if (!url || !/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error("Run through `pnpm test:security <workdir>` (local DB).")
  }
  return url
}

/**
 * Tries one direct write against a guard and returns the error message it
 * raised ("allowed" if none). The write runs inside a block that always
 * raises afterwards, so the transaction rolls back whatever the guard did:
 * a regressed guard (even on TRUNCATE) never changes a row.
 */
function denial(sql: string): string {
  try {
    psql(`do $probe$
declare v_message text;
begin
  begin
    ${sql};
  exception when others then
    v_message := sqlerrm;
  end;
  raise exception 'probe_result:%', coalesce(v_message, 'allowed');
end $probe$`)
  } catch (e) {
    const text = `${(e as { stderr?: unknown }).stderr ?? ""} ${(e as Error).message}`
    const m = /probe_result:(\S+)/.exec(text)
    if (m) return m[1]!
    throw e
  }
  throw new Error("probe block did not raise")
}

/** One psql script in one session; returns its printed lines. */
function psqlScript(sql: string): string[] {
  return execFileSync("psql", [localDbUrl(), "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    encoding: "utf8",
    input: sql,
  })
    .split("\n")
    .filter((line) => line.length > 0)
}

/** Switches a psql transaction to a signed-in caller (role authenticated). */
const as = (who: { id: string }) => `reset role;
set local "request.jwt.claims" to ${literal(JSON.stringify({ sub: who.id, role: "authenticated" }))};
set local role authenticated;`

/**
 * Runs a psql script in a background session named `name` (its
 * application_name); resolves with its output when the session ends.
 */
function psqlBackground(name: string, sql: string): Promise<string> {
  const url = localDbUrl()
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [url, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
      env: { ...process.env, PGAPPNAME: name },
    })
    let out = ""
    let err = ""
    child.stdout.on("data", (d: Buffer) => (out += d.toString()))
    child.stderr.on("data", (d: Buffer) => (err += d.toString()))
    child.on("error", reject)
    child.on("close", (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(err || `psql ${code}`))
    )
    child.stdin.end(sql)
  })
}

/** Waits (bounded) until the background session is inside pg_sleep. */
async function untilSleeping(name: string) {
  for (let i = 0; i < 200; i++) {
    if (
      psql(`select exists (select 1 from pg_stat_activity
        where application_name = ${literal(name)} and wait_event = 'PgSleep')`) === "t"
    )
      return
    await sleep(25)
  }
  throw new Error(`background session ${name} never reached its sleep`)
}

/** The private job, bounded to the given synthetic venues. */
const runJob = (atSql: string, venues: string[]) =>
  psql(
    `select private.menu_open_rechecks(${atSql}, ${literal(`{${venues.join(",")}}`)}::uuid[])`
  )

const today = () =>
  psql(`select ((now() at time zone 'Europe/London')::date)::text`)
const dayOffset = (n: number) =>
  psql(`select ((now() at time zone 'Europe/London')::date + ${n})::text`)
const localMidnightIso = (date: string) =>
  psql(
    `select to_json((${literal(date)}::date)::timestamp at time zone 'Europe/London') #>> '{}'`
  )
const lineRevision = (line: string) =>
  Number(
    psql(
      `select revision from public.menu_trading_lines where id = ${literal(line)}`
    )
  )

type ProposeArgs = {
  line?: string
  item?: string
  variant?: string | null
  portion?: Record<string, unknown> | null
  channel?: string | null
  field: TradingField | string
  value?: unknown
  from?: string | null
  to?: string | null
  observedOn?: string | null
  reason?: string | null
  source?: Record<string, unknown> | null
  key?: string
}
const propose = (who: TestIdentity, a: ProposeArgs) =>
  rpc(who, "menu_trading_propose", {
    p_line: a.line ?? null,
    p_item: a.item ?? null,
    p_variant: a.variant ?? null,
    p_portion: a.portion ?? null,
    p_channel: a.channel ?? null,
    p_field: a.field,
    p_value: a.value ?? null,
    p_effective_from: a.from ?? null,
    p_effective_to: a.to ?? null,
    p_observed_on: a.observedOn ?? null,
    p_reason: a.reason ?? null,
    p_source: a.source ?? null,
    p_request_key: a.key ?? randomUUID(),
  })
type Proposed = {
  assertionId: string
  lineId: string
  lineRevision: number
  state: string
  value: Record<string, unknown>
  current: Record<string, unknown>
  replayed: boolean
}
const decide = (
  who: TestIdentity,
  assertion: string,
  expected: number,
  decision: string,
  o: { statedOn?: string | null; reason?: string | null; key?: string } = {}
) =>
  rpc(who, "menu_trading_decide", {
    p_assertion: assertion,
    p_expected_line_revision: expected,
    p_decision: decision,
    p_reason: o.reason ?? null,
    p_stated_on: o.statedOn ?? null,
    p_request_key: o.key ?? randomUUID(),
  })
type Decided = {
  decisionId: string
  lineId: string
  lineRevision: number
  statedOn: string | null
  statedOnSource: string | null
  current: Record<string, unknown>
  replayed: boolean
}
const confirm = async (
  who: TestIdentity,
  p: { assertionId: string; lineId: string }
) =>
  ok<Decided>(decide(who, p.assertionId, lineRevision(p.lineId), "confirmed"))
const history = (who: TestIdentity, line: string, at: string | null = null) =>
  rpc(who, "menu_trading_history", { p_line: line, p_at: at })
const linesFor = (who: TestIdentity, itemId: string) =>
  rpc(who, "menu_trading_lines_for_item", { p_item: itemId })
const gbp = (amount: string | number) => ({ amount })

let venueA: string
let venueB: string
let admin: TestIdentity
let managerA: TestIdentity
let legacyA: TestIdentity
let staffA: TestIdentity
let staffA2: TestIdentity
let staffB: TestIdentity
let managerB: TestIdentity
let inactiveStaff: TestIdentity
let anon: TestIdentity
let docA: Awaited<ReturnType<typeof readDocument>>
let docB: Awaited<ReturnType<typeof readDocument>>
let offMenuItem: string

const MENU_A = (ids: Record<string, string | null> = {}) =>
  menu("TEST trading A", [
    section("mains", "Mains", [
      item("mains--pie", "Pie", { itemId: ids.pie ?? null }),
      item("mains--curry", "Curry", {
        itemId: ids.curry ?? null,
        variants: ["Chicken", "Lamb"],
      }),
      item("mains--fish", "Fish", { itemId: ids.fish ?? null }),
      item("mains--roast", "Roast", { itemId: ids.roast ?? null }),
    ]),
    section(
      "drinks",
      "Drinks",
      [item("drinks--cider", "Cider", { itemId: ids.cider ?? null })],
      "drinks"
    ),
  ])

beforeAll(async () => {
  venueA = (await createVenue(service, "trading-a")).id
  venueB = (await createVenue(service, "trading-b")).id
  admin = await createIdentity(service, { label: "tr-admin", role: "admin" })
  ;[managerA, legacyA, staffA, staffA2, staffB, managerB, inactiveStaff, anon] =
    await Promise.all([
      createIdentity(service, {
        label: "tr-mgr-a",
        role: "staff",
        venueId: venueA,
      }),
      createIdentity(service, {
        label: "tr-legacy-a",
        role: "staff",
        venueId: venueA,
      }),
      createIdentity(service, {
        label: "tr-staff-a",
        role: "staff",
        venueId: venueA,
      }),
      createIdentity(service, {
        label: "tr-staff-a2",
        role: "staff",
        venueId: venueA,
      }),
      createIdentity(service, {
        label: "tr-staff-b",
        role: "staff",
        venueId: venueB,
      }),
      createIdentity(service, {
        label: "tr-mgr-b",
        role: "staff",
        venueId: venueB,
      }),
      createIdentity(service, {
        label: "tr-staff-off",
        role: "staff",
        venueId: venueA,
        active: false,
      }),
      createIdentity(service, {
        label: "tr-anon",
        role: "staff",
        profile: false,
      }),
    ])
  await makeManager(admin, managerA, venueA)
  await makeManager(admin, managerB, venueB)
  // OD-B4-17: a legacy grant holder acts as manager for trading writes.
  await legacyStaffGrant(service, admin, legacyA.id, venueA)

  // v1 lists an item v2 drops: it exists but is not on the active menu.
  const v1 = await publishMenu(
    admin,
    venueA,
    menu("TEST trading A v1", [
      ...MENU_A().sections,
      section("old", "Old", [item("old--stew", "Stew")]),
    ])
  )
  const d1 = await readDocument(service, v1)
  offMenuItem = d1.byKey["old--stew"]!.itemId
  const ids = {
    pie: d1.byKey["mains--pie"]!.itemId,
    curry: d1.byKey["mains--curry"]!.itemId,
    fish: d1.byKey["mains--fish"]!.itemId,
    roast: d1.byKey["mains--roast"]!.itemId,
    cider: d1.byKey["drinks--cider"]!.itemId,
  }
  const doc = MENU_A(ids)
  doc.sections[0]!.items[1]!.variants = d1.byKey["mains--curry"]!.variants
  docA = await readDocument(service, await publishMenu(admin, venueA, doc, v1))
  docB = await readDocument(
    service,
    await publishMenu(
      admin,
      venueB,
      menu("TEST trading B", [
        section("mains", "Mains", [item("mains--pie", "Pie")]),
      ])
    )
  )
})

const pie = () => docA.byKey["mains--pie"]!.itemId
const curry = () => docA.byKey["mains--curry"]!
const fish = () => docA.byKey["mains--fish"]!.itemId
const cider = () => docA.byKey["drinks--cider"]!.itemId

// ---------------------------------------------------------------------------
// Parity with lib/menus/trading (B04-02e, §5.3)
// ---------------------------------------------------------------------------

describe("TS/SQL parity of the price parser and value schema", () => {
  it("parses every shared fixture exactly as parsePrice does", () => {
    for (const f of PRICE_PARSE_FIXTURES) {
      const out = JSON.parse(
        psql(`select private.menu_parse_price(${sqlJson(f.input)},
          ${f.currency ? literal(f.currency) : "'GBP'"})::text`)
      )
      expect(out, JSON.stringify(f)).toEqual(f.expect)
    }
  })

  it("reads a JSON number by its jsonb text: 10.5 and 10.50 are both 1,050", () => {
    for (const text of ["10.5", "10.50", "1.05e1"])
      expect(
        psql(
          `select private.menu_parse_price('${text}'::jsonb, 'GBP') ->> 'amountMinor'`
        )
      ).toBe("1050")
    expect(
      psql(
        `select private.menu_parse_price('10.505'::jsonb, 'GBP') ->> 'error'`
      )
    ).toBe("invalid_price")
  })

  it("agrees on the stored value schema", () => {
    const SCHEDULE = randomUUID()
    const cases: [TradingField, unknown][] = [
      ["price", { kind: "fixed", amountMinor: 1050, currency: "GBP" }],
      [
        "price",
        { kind: "fixed", amountMinor: PRICE_MAX_MINOR, currency: "GBP" },
      ],
      [
        "price",
        { kind: "fixed", amountMinor: PRICE_MAX_MINOR + 1, currency: "GBP" },
      ],
      ["price", { kind: "fixed", amountMinor: -1, currency: "GBP" }],
      ["price", { kind: "fixed", amountMinor: 10.5, currency: "GBP" }],
      ["price", { kind: "fixed", amountMinor: "1050", currency: "GBP" }],
      ["price", { kind: "fixed", amountMinor: 1050, currency: "EUR" }],
      ["price", { kind: "fixed", amountMinor: 1050 }],
      ["price", { kind: "ambiguous", form: "multiple" }],
      ["price", { kind: "ambiguous", form: "guess" }],
      ["price", { kind: "market" }],
      ["availability", { state: "always" }],
      ["availability", { state: "scheduled", scheduleId: SCHEDULE }],
      ["availability", { state: "scheduled", scheduleId: "x" }],
      ["availability", { state: "never" }],
      [
        "temporary_unavailability",
        { state: "temporarily_unavailable", until: null },
      ],
      [
        "temporary_unavailability",
        { state: "temporarily_unavailable", until: "2026-11-10T18:00:00Z" },
      ],
      [
        "temporary_unavailability",
        {
          state: "temporarily_unavailable",
          until: "2026-11-10T18:00:00+00:00",
        },
      ],
      ["temporary_unavailability", { state: "back_in_service", until: null }],
    ]
    for (const [field, value] of cases) {
      const sql = psql(`select coalesce(private.menu_trading_value_problem(
        ${literal(field)}, ${sqlJson(value)}), 'null')`)
      expect(sql, `${field} ${JSON.stringify(value)}`).toBe(
        tradingValueProblem(field, value) ?? "null"
      )
    }
  })
})

// ---------------------------------------------------------------------------
// Structure (§3, B04-02a)
// ---------------------------------------------------------------------------

describe("structural venue scope and stable identity (B04-02a)", () => {
  let base: Proposed
  let baseKey: string
  let decision: Decided
  let scheduleId: string
  let exceptionId: string

  beforeAll(async () => {
    baseKey = randomUUID()
    base = await ok<Proposed>(
      propose(managerA, {
        item: fish(),
        field: "price",
        value: gbp("12.00"),
        key: baseKey,
      })
    )
    decision = await confirm(managerA, base)
    scheduleId = (
      await ok<{ scheduleId: string }>(
        rpc(managerA, "menu_availability_schedule_add", {
          p_venue: venueA,
          p_schedule: {
            effectiveFrom: today(),
            recurrence: { kind: "weekly", days: ["mon"] },
            windows: [{ start: "09:00", end: "10:00" }],
          },
          p_timezone: null,
          p_knowledge_check_id: null,
          p_supersedes: null,
          p_request_key: randomUUID(),
        })
      )
    ).scheduleId
    exceptionId = (
      await ok<{ exceptionId: string }>(
        rpc(managerA, "menu_availability_exception_add", {
          p_schedule: scheduleId,
          p_local_date: dayOffset(14),
          p_kind: "cancelled",
          p_windows: null,
          p_note: null,
          p_request_key: randomUUID(),
        })
      )
    ).exceptionId
  })

  const insertLine = (venue: string, itemId: string, extra = "") =>
    psql(
      `insert into public.menu_trading_lines (venue_id, item_id, channel, created_by${
        extra ? ", " + extra.split("=")[0] : ""
      }) values (${literal(venue)}, ${literal(itemId)}, 'takeaway', ${literal(admin.id)}${
        extra ? ", " + extra.split("=")[1] : ""
      })`
    )

  it("refuses a cross-venue item and another item's variant", () => {
    expect(() => insertLine(venueA, docB.byKey["mains--pie"]!.itemId)).toThrow(
      /menu_trading_lines_item_fkey/
    )
    const lamb = curry().variants[1]!.variantId
    expect(() =>
      psql(`insert into public.menu_trading_lines (venue_id, item_id, variant_id, created_by)
        values (${literal(venueA)}, ${literal(pie())}, ${literal(lamb)}, ${literal(admin.id)})`)
    ).toThrow(/menu_trading_lines_variant_fkey/)
  })

  it("refuses a modifier option in b1 and a duplicate identity (nulls not distinct)", () => {
    expect(() =>
      insertLine(venueA, fish(), `modifier_option_id=gen_random_uuid()`)
    ).toThrow(/menu_trading_lines_modifier_reserved/)
    expect(() =>
      psql(`insert into public.menu_trading_lines (venue_id, item_id, created_by)
        values (${literal(venueA)}, ${literal(fish())}, ${literal(admin.id)})`)
    ).toThrow(/menu_trading_lines_identity_key/)
  })

  it("keeps a line's identity, never deletes it, and moves its revision by one", () => {
    const line = literal(base.lineId)
    const revision = lineRevision(base.lineId)
    for (const [sql, message] of [
      [
        `update public.menu_trading_lines set channel = 'takeaway' where id = ${line}`,
        "menu_trading_line_immutable",
      ],
      [
        `update public.menu_trading_lines set revision = revision + 2 where id = ${line}`,
        "menu_trading_line_immutable",
      ],
      [
        `delete from public.menu_trading_lines where id = ${line}`,
        "menu_trading_line_immutable",
      ],
      // Contained: the probe block always rolls back.
      [`truncate public.menu_trading_lines cascade`, "audit_append_only"],
    ] as const)
      expect(denial(sql), sql).toBe(message)
    expect(lineRevision(base.lineId)).toBe(revision)
  })

  it("keeps history append-only for every role", () => {
    // The fixture rows, exactly as written.
    const counts = () =>
      psql(`select md5(concat_ws('|',
        (select to_jsonb(a)::text from public.menu_trading_assertions a where a.id = ${literal(base.assertionId)}),
        (select to_jsonb(d)::text from public.menu_trading_decisions d where d.id = ${literal(decision.decisionId)}),
        (select to_jsonb(s)::text from public.menu_availability_schedules s where s.id = ${literal(scheduleId)}),
        (select to_jsonb(e)::text from public.menu_availability_exceptions e where e.id = ${literal(exceptionId)}),
        (select to_jsonb(c)::text from public.menu_trading_commands c where c.request_key = ${literal(baseKey)})))`)
    const before = counts()
    expect(before).not.toBe(psql(`select md5('')`))
    for (const sql of [
      `update public.menu_trading_assertions set reason = 'x' where id = ${literal(base.assertionId)}`,
      `delete from public.menu_trading_assertions where id = ${literal(base.assertionId)}`,
      `update public.menu_trading_decisions set reason = 'x' where id = ${literal(decision.decisionId)}`,
      `delete from public.menu_trading_decisions where id = ${literal(decision.decisionId)}`,
      `update public.menu_availability_schedules set timezone = 'UTC' where id = ${literal(scheduleId)}`,
      `delete from public.menu_availability_schedules where id = ${literal(scheduleId)}`,
      `update public.menu_availability_exceptions set note = 'x' where id = ${literal(exceptionId)}`,
      `delete from public.menu_availability_exceptions where id = ${literal(exceptionId)}`,
      `update public.menu_trading_commands set result = '{}' where request_key = ${literal(baseKey)}`,
      `delete from public.menu_trading_commands where request_key = ${literal(baseKey)}`,
      // Contained: the probe block always rolls back.
      `truncate public.menu_trading_assertions cascade`,
      `truncate public.menu_trading_decisions`,
      `truncate public.menu_trading_commands`,
    ])
      expect(denial(sql), sql).toBe("audit_append_only")
    expect(counts()).toBe(before)
  })

  it("gives clients no table access: RLS on, no policies, no grants", () => {
    const tables = [
      "menu_trading_lines",
      "menu_trading_assertions",
      "menu_trading_decisions",
      "menu_availability_schedules",
      "menu_availability_exceptions",
      "menu_trading_recheck_tasks",
      "menu_trading_commands",
    ]
    expect(
      rows<{
        relname: string
        rls: boolean
      }>(`select c.relname, c.relrowsecurity as rls
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any (${literal(`{${tables.join(",")}}`)}::text[])
        order by 1`)
    ).toEqual([...tables].sort().map((relname) => ({ relname, rls: true })))
    expect(
      psql(`select count(*) from pg_policies where schemaname = 'public'
        and tablename = any (${literal(`{${tables.join(",")}}`)}::text[])`)
    ).toBe("0")
    for (const t of tables)
      for (const role of ["anon", "authenticated"])
        expect(
          psql(
            `select has_table_privilege('${role}', 'public.${t}', 'select,insert,update,delete')`
          ),
          `${role} ${t}`
        ).toBe("f")
  })

  it("keeps a source-mapped snapshot in the same venue (S1 key added)", () => {
    expect(
      psql(`select count(*) from pg_constraint
        where conname = 'menu_source_snapshots_id_venue_key'`)
    ).toBe("1")
  })
})

// ---------------------------------------------------------------------------
// Roles, venue scope and privacy (§5.4, §10)
// ---------------------------------------------------------------------------

describe("roles, venue scope and privacy (V01, V02, V11)", () => {
  it("lets staff report a price that stays proposed, with the confirmed value separate (L4)", async () => {
    const p = await ok<Proposed>(
      propose(staffA, {
        item: pie(),
        field: "price",
        value: gbp("10.50"),
        observedOn: today(),
        reason: "TEST seen on the board",
      })
    )
    expect(p).toMatchObject({
      state: "proposed",
      value: { kind: "fixed", amountMinor: 1050, currency: "GBP" },
      current: {
        status: "unavailable",
        reason: "unknown",
        detail: "not_recorded",
      },
      replayed: false,
    })
    expect(
      psql(
        `select basis from public.menu_trading_assertions where id = ${literal(p.assertionId)}`
      )
    ).toBe("staff_report")
    const view = await ok<{ view: string; lines: Record<string, unknown>[] }>(
      linesFor(staffA, pie())
    )
    expect(view.view).toBe("staff")
    const mine = view.lines.find((l) => l.lineId === p.lineId)!
    expect(mine.price).toMatchObject({
      status: "unavailable",
      detail: "not_recorded",
    })
    expect(mine.myPending).toEqual([
      expect.objectContaining({ assertionId: p.assertionId, field: "price" }),
    ])
    // Another staff member does not see the report.
    const other = await ok<{ lines: Record<string, unknown>[] }>(
      linesFor(staffA2, pie())
    )
    expect(other.lines.find((l) => l.lineId === p.lineId)!.myPending).toEqual(
      []
    )
  })

  it("limits staff to price and temporary unavailability reports on the plain line", async () => {
    await fails(
      propose(staffA, {
        item: pie(),
        field: "availability",
        value: { state: "always" },
      }),
      "staff_field_not_allowed",
      "42501"
    )
    await fails(
      propose(staffA, {
        item: cider(),
        portion: { label: "Pint" },
        field: "price",
        value: gbp("4.30"),
      }),
      "menu_trading_line_not_found",
      "P0002"
    )
    const snapshotless = {
      snapshotId: randomUUID(),
      locator: "x",
      rawText: "1.00",
    }
    await fails(
      propose(staffA, { item: pie(), field: "price", source: snapshotless }),
      "source_mapping_admin_only",
      "42501"
    )
  })

  it("refuses staff decisions, other venues, inactive and anonymous callers", async () => {
    const p = await ok<Proposed>(
      propose(staffA, { item: pie(), field: "price", value: gbp(11) })
    )
    await fails(
      decide(staffA, p.assertionId, lineRevision(p.lineId), "confirmed"),
      "not_venue_manager",
      "42501"
    )
    await fails(
      decide(managerB, p.assertionId, lineRevision(p.lineId), "confirmed"),
      "not_venue_manager",
      "42501"
    )
    await fails(
      propose(staffB, { item: pie(), field: "price", value: gbp(1) }),
      "not_venue_member",
      "42501"
    )
    await fails(
      propose(managerB, { item: pie(), field: "price", value: gbp(1) }),
      "not_venue_member",
      "42501"
    )
    await fails(
      propose(inactiveStaff, { item: pie(), field: "price", value: gbp(1) }),
      "not_active_user",
      "42501"
    )
    await fails(
      propose(anon, { item: pie(), field: "price", value: gbp(1) }),
      "not_active_user",
      "42501"
    )
    await fails(linesFor(staffB, pie()), "menu_item_not_found", "P0002")
    await fails(linesFor(managerB, pie()), "menu_item_not_found", "P0002")
    await fails(history(staffA, p.lineId), "not_venue_manager", "42501")
    await fails(history(managerB, p.lineId), "not_venue_manager", "42501")
  })

  it("accepts only items and variants on the active menu", async () => {
    await fails(
      propose(managerA, { item: offMenuItem, field: "price", value: gbp(5) }),
      "menu_item_not_on_active_menu",
      "P0001"
    )
    await fails(linesFor(staffA, offMenuItem), "menu_item_not_found", "P0002")
    await fails(
      propose(managerA, {
        item: pie(),
        variant: curry().variants[0]!.variantId,
        field: "price",
        value: gbp(5),
      }),
      "menu_variant_not_found",
      "P0002"
    )
  })

  it("lets a manager, a legacy grant holder and an admin confirm; one person may self-confirm", async () => {
    for (const who of [managerA, legacyA, admin]) {
      const p = await ok<Proposed>(
        propose(who, {
          item: curry().itemId,
          variant: curry().variants[0]!.variantId,
          field: "price",
          value: gbp("13.95"),
        })
      )
      const d = await confirm(who, p)
      expect(d).toMatchObject({
        statedOnSource: "form_default",
        statedOn: today(),
      })
      expect(d.current).toMatchObject({
        status: "available",
        assertionId: p.assertionId,
        value: { amountMinor: 1395 },
        updatedBy: "manager",
      })
      expect(
        psql(
          `select self_confirmed from public.menu_trading_decisions where id = ${literal(d.decisionId)}`
        )
      ).toBe("t")
    }
  })

  it("keeps notes, actor ids, source text and locators out of the staff read", async () => {
    const view = JSON.stringify(await ok(linesFor(staffA, pie())))
    for (const forbidden of [
      '"statedBy"',
      '"decidedBy"',
      '"reason"',
      '"rawText"',
      '"sourceLocator"',
      '"snapshotId"',
      '"pending"',
      '"rechecks"',
      staffA2.id,
      managerA.id,
    ])
      expect(view).not.toContain(forbidden)
    const manager = await ok<{
      lines: { pending: Record<string, unknown>[] }[]
    }>(linesFor(managerA, pie()))
    const pending = manager.lines.flatMap((l) => l.pending)
    expect(pending.length).toBeGreaterThan(0)
    expect(pending[0]).toHaveProperty("statedBy")
    expect(pending[0]).not.toHaveProperty("rawText")
  })
})

// ---------------------------------------------------------------------------
// Decisions: one winner, replay, supersession, stated_on (B04-02d)
// ---------------------------------------------------------------------------

describe("decisions (B04-02d)", () => {
  it("gives one winner to concurrent decisions; the other gets menu_trading_conflict", async () => {
    const p = await ok<Proposed>(
      propose(managerA, {
        item: cider(),
        portion: { label: "Half", quantity: 284, unit: "ml" },
        field: "price",
        value: gbp("2.40"),
      })
    )
    const q = await ok<Proposed>(
      propose(legacyA, { line: p.lineId, field: "price", value: gbp("2.50") })
    )
    const revision = lineRevision(p.lineId)
    const [a, b] = await Promise.all([
      decide(managerA, p.assertionId, revision, "confirmed"),
      decide(legacyA, q.assertionId, revision, "confirmed"),
    ])
    const errors = [a.error, b.error].filter(Boolean)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      message: "menu_trading_conflict",
      code: "40001",
    })
    expect(JSON.parse(errors[0]!.details!)).toEqual({ revision: revision + 1 })
    expect(
      psql(
        `select count(*) from public.menu_trading_decisions where line_id = ${literal(p.lineId)}`
      )
    ).toBe("1")
  })

  it("replays a request key once, within the caller's re-read scope", async () => {
    const key = randomUUID()
    const p = await ok<Proposed>(
      propose(managerA, {
        item: pie(),
        channel: "takeaway",
        field: "price",
        value: gbp(9),
        key,
      })
    )
    const again = await ok<Proposed>(
      propose(managerA, {
        item: pie(),
        channel: "takeaway",
        field: "price",
        value: gbp(9),
        key,
      })
    )
    expect(again).toEqual({ ...p, replayed: true })
    await fails(
      propose(managerA, {
        item: pie(),
        channel: "takeaway",
        field: "price",
        value: gbp(8),
        key,
      }),
      "idempotency_key_reused",
      "22023"
    )
    await fails(
      propose(legacyA, {
        item: pie(),
        channel: "takeaway",
        field: "price",
        value: gbp(9),
        key,
      }),
      "idempotency_key_reused",
      "22023"
    )
    const dkey = randomUUID()
    const revision = lineRevision(p.lineId)
    const d = await ok<Decided>(
      decide(managerA, p.assertionId, revision, "confirmed", { key: dkey })
    )
    expect(
      await ok<Decided>(
        decide(managerA, p.assertionId, revision, "confirmed", { key: dkey })
      )
    ).toEqual({
      ...d,
      replayed: true,
    })
    expect(
      psql(
        `select count(*) from public.menu_trading_decisions where assertion_id = ${literal(p.assertionId)}`
      )
    ).toBe("1")

    // A staff member moved to another venue cannot replay a key from the old one.
    const mover = await createIdentity(service, {
      label: "tr-mover",
      role: "staff",
      venueId: venueA,
    })
    const mkey = randomUUID()
    await ok(
      propose(mover, { item: pie(), field: "price", value: gbp(7), key: mkey })
    )
    psql(
      `update public.profiles set venue_id = ${literal(venueB)} where id = ${literal(mover.id)}`
    )
    await fails(
      propose(mover, { item: pie(), field: "price", value: gbp(7), key: mkey }),
      "not_venue_member",
      "42501"
    )
  })

  it("refuses a confirmation whose superseded value changed after it was proposed", async () => {
    const h = await ok<Proposed>(
      propose(managerA, {
        item: pie(),
        channel: "dine_in",
        field: "price",
        value: gbp(10),
      })
    )
    await confirm(managerA, h)
    const p = await ok<Proposed>(
      propose(managerA, { line: h.lineId, field: "price", value: gbp(11) })
    )
    const q = await ok<Proposed>(
      propose(legacyA, { line: h.lineId, field: "price", value: gbp(12) })
    )
    for (const x of [p, q])
      expect(
        psql(
          `select supersedes from public.menu_trading_assertions where id = ${literal(x.assertionId)}`
        )
      ).toBe(h.assertionId)
    await confirm(managerA, q)
    await fails(
      decide(managerA, p.assertionId, lineRevision(h.lineId), "confirmed"),
      "menu_trading_proposal_outdated",
      "P0001"
    )
  })

  it("declines and withdraws only from the right state", async () => {
    const p = await ok<Proposed>(
      propose(managerA, {
        item: fish(),
        channel: "dine_in",
        field: "price",
        value: gbp(15),
      })
    )
    await fails(
      decide(managerA, p.assertionId, lineRevision(p.lineId), "withdrawn"),
      "menu_trading_not_confirmed",
      "P0001"
    )
    await ok(
      decide(managerA, p.assertionId, lineRevision(p.lineId), "declined", {
        reason: "TEST wrong dish",
      })
    )
    await fails(
      decide(managerA, p.assertionId, lineRevision(p.lineId), "confirmed"),
      "menu_trading_not_proposed",
      "P0001"
    )
    await fails(
      decide(managerA, p.assertionId, lineRevision(p.lineId), "declined"),
      "menu_trading_not_proposed",
      "P0001"
    )
  })

  it("records stated_on as the form default or a chosen date within 30 days (A1-2, L2)", async () => {
    const mk = async () =>
      ok<Proposed>(
        propose(managerA, {
          item: cider(),
          portion: { label: "Pint" },
          field: "price",
          value: gbp("4.30"),
        })
      )
    const a = await mk()
    expect(
      await ok<Decided>(
        decide(managerA, a.assertionId, lineRevision(a.lineId), "confirmed", {
          statedOn: dayOffset(-5),
        })
      )
    ).toMatchObject({ statedOn: dayOffset(-5), statedOnSource: "chosen" })
    const b = await mk()
    for (const bad of [dayOffset(-31), dayOffset(1)])
      await fails(
        decide(managerA, b.assertionId, lineRevision(b.lineId), "confirmed", {
          statedOn: bad,
        }),
        "invalid_stated_on",
        "22023"
      )
    await fails(
      decide(managerA, b.assertionId, lineRevision(b.lineId), "declined", {
        statedOn: today(),
      }),
      "invalid_stated_on",
      "22023"
    )
    expect(
      psql(`select count(*) from public.menu_trading_decisions where decision = 'confirmed'
        and (stated_on is null or stated_on_source is null)`)
    ).toBe("0")
  })

  it("refuses direct ambiguous, over-precise, negative and foreign prices with invalid_price", async () => {
    for (const value of [
      gbp("MP"),
      gbp("from 9.95"),
      gbp("4.30 / 2.40"),
      gbp("10.505"),
      gbp("-1"),
      { amount: "10.50", currency: "EUR" },
    ])
      await fails(
        propose(managerA, { item: pie(), field: "price", value }),
        "invalid_price",
        "22023"
      )
    const e = await fails(
      propose(managerA, {
        item: pie(),
        field: "price",
        value: gbp("from 9.95"),
      }),
      "invalid_price"
    )
    expect(JSON.parse(e.details!)).toEqual({ form: "from" })
  })

  it("refuses past effective dates and dates on temporary unavailability", async () => {
    await fails(
      propose(managerA, {
        item: pie(),
        field: "price",
        value: gbp(1),
        from: dayOffset(-1),
      }),
      "invalid_effective_dates",
      "22023"
    )
    await fails(
      propose(managerA, {
        item: pie(),
        field: "price",
        value: gbp(1),
        from: dayOffset(3),
        to: dayOffset(2),
      }),
      "invalid_effective_dates",
      "22023"
    )
    await fails(
      propose(managerA, {
        item: pie(),
        field: "temporary_unavailability",
        value: { state: "back_in_service" },
        from: today(),
      }),
      "invalid_effective_dates",
      "22023"
    )
    await fails(
      propose(staffA, {
        item: pie(),
        field: "price",
        value: gbp(1),
        observedOn: dayOffset(-31),
      }),
      "invalid_observed_on",
      "22023"
    )
  })
})

// ---------------------------------------------------------------------------
// Source snapshot provenance (§5.2 #2, §4.3 crosswalk)
// ---------------------------------------------------------------------------

describe("source snapshot provenance (§5.2 #2)", () => {
  let snapshotId: string
  const FISH = "menu.json#Fish"
  const CHICKEN = "menu.json#Curry#variant=Chicken"

  const head = (sourceId: string, locator: string) =>
    rows<{ row_id: string; revision: number }>(`select h.row_id, h.revision
      from public.menu_crosswalk_heads h
      where h.source_id = ${literal(sourceId)} and h.locator = ${literal(locator)}`)[0]!
  const review = (
    sourceId: string,
    locator: string,
    itemId: string,
    variantId: string | null = null
  ) => {
    const h = head(sourceId, locator)
    return ok(
      rpc(admin, "menu_crosswalk_decide", {
        p_row: h.row_id,
        p_expected: h.revision,
        p_status: "confirmed",
        p_item: itemId,
        p_variant: variantId,
        p_channel: "all",
        p_reason: null,
        p_request_key: randomUUID(),
      })
    )
  }
  const cite = (
    a: Omit<ProposeArgs, "field" | "source">,
    locator: string,
    rawText?: string
  ) =>
    propose(admin, {
      ...a,
      field: "price",
      source: rawText === undefined ? { snapshotId, locator } : { snapshotId, locator, rawText },
    })
  const chicken = () => curry().variants.find((v) => v.name === "Chicken")!.variantId
  const lamb = () => curry().variants.find((v) => v.name === "Lamb")!.variantId

  beforeAll(async () => {
    const source = await ok<{ sourceId: string }>(
      rpc(admin, "menu_declare_source", {
        p_venue: venueA,
        p_kind: "venue_website",
        p_label: `TEST trading site ${randomUUID()}`,
        p_locator: null,
        p_request_key: randomUUID(),
      })
    )
    const document = [
      { locator: FISH, name: "Fish", priceText: "£14.50" },
      { locator: "menu.json#Pie", name: "Pie", priceText: "from 9.95" },
      {
        locator: "menu.json#Curry",
        name: "Curry",
        variants: ["Chicken", "Lamb"],
        priceText: "13.95",
      },
      { locator: "menu.json#Cider", name: "Cider", priceText: "4.30" },
      { locator: "menu.json#Roast", name: "Roast" },
    ]
    snapshotId = (
      await ok<{ snapshotId: string }>(
        rpc(admin, "menu_record_snapshot", {
          p_source: source.sourceId,
          p_revision: "r1",
          p_sha256: "c".repeat(64),
          p_captured_at: null,
          p_document: document,
          p_request_key: randomUUID(),
        })
      )
    ).snapshotId
    await ok(
      rpc(admin, "menu_crosswalk_propose", {
        p_snapshot: snapshotId,
        p_request_key: randomUUID(),
      })
    )
    // Reviewed: Fish, Pie, Curry (and its Chicken variant), Roast. Cider
    // stays unreviewed.
    await review(source.sourceId, FISH, fish())
    await review(source.sourceId, "menu.json#Pie", pie())
    await review(source.sourceId, "menu.json#Curry", curry().itemId)
    await review(source.sourceId, CHICKEN, curry().itemId, chicken())
    await review(source.sourceId, "menu.json#Roast", docA.byKey["mains--roast"]!.itemId)
  })

  it("takes the price text from the cited entry, not the caller, and records it", async () => {
    const fixed = await ok<Proposed>(
      cite({ item: fish(), portion: { label: "Large" } }, FISH)
    )
    expect(fixed.value).toEqual({ kind: "fixed", amountMinor: 1450, currency: "GBP" })
    expect(fixed.current).toMatchObject({ detail: "not_recorded" })
    expect(
      rows(`select basis, snapshot_id as "snapshotId", source_locator as "locator", raw_text as "rawText"
        from public.menu_trading_assertions where id = ${literal(fixed.assertionId)}`)
    ).toEqual([{ basis: "source_mapping", snapshotId, locator: FISH, rawText: "£14.50" }])
    // The same text, given byte for byte, is accepted.
    await ok(cite({ item: fish(), portion: { label: "Large" } }, FISH, "£14.50"))
    // Only admins see the source text.
    const lineA = await ok<{
      lines: { lineId: string; pending: Record<string, unknown>[] }[]
    }>(linesFor(admin, fish()))
    expect(lineA.lines.find((l) => l.lineId === fixed.lineId)!.pending[0]).toMatchObject({
      rawText: "£14.50",
      sourceLocator: FISH,
    })
  })

  it("refuses a valid locator with other text: caller text is never evidence", async () => {
    for (const text of ["£1.00", "14.50", "£14.50 ", "£14.5"])
      await fails(
        cite({ item: fish(), portion: { label: "Large" } }, FISH, text),
        "menu_source_text_mismatch",
        "22023"
      )
    await fails(
      cite({ item: fish() }, "menu.json#Nope"),
      "menu_source_locator_not_found",
      "22023"
    )
    await fails(
      cite({ item: docA.byKey["mains--roast"]!.itemId }, "menu.json#Roast"),
      "menu_source_price_missing",
      "22023"
    )
  })

  it("refuses an entry reviewed for another item, variant or channel", async () => {
    // Fish's entry cited for the pie.
    await fails(cite({ item: pie() }, FISH), "menu_source_mapping_mismatch", "P0001")
    // Fish's entry (channel all) cited for a takeaway line.
    await fails(
      cite({ item: fish(), channel: "takeaway" }, FISH),
      "menu_source_mapping_mismatch",
      "P0001"
    )
    // Chicken's variant row cited for the lamb line, and the curry entry
    // (no variant) cited for the chicken line.
    await fails(
      cite({ item: curry().itemId, variant: lamb() }, CHICKEN),
      "menu_source_mapping_mismatch",
      "P0001"
    )
    await fails(
      cite({ item: curry().itemId, variant: chicken() }, "menu.json#Curry"),
      "menu_source_mapping_mismatch",
      "P0001"
    )
    // The variant row for its own line is accepted, with the entry's text.
    expect(
      (await ok<Proposed>(cite({ item: curry().itemId, variant: chicken() }, CHICKEN))).value
    ).toEqual({ kind: "fixed", amountMinor: 1395, currency: "GBP" })
  })

  it("fails closed on an unreviewed entry, and keeps an ambiguous text unconfirmable", async () => {
    await fails(
      cite({ item: cider() }, "menu.json#Cider"),
      "menu_source_mapping_unverified",
      "P0001"
    )
    const ambiguous = await ok<Proposed>(
      cite({ item: pie(), portion: { label: "Small" } }, "menu.json#Pie")
    )
    expect(ambiguous.value).toEqual({ kind: "ambiguous", form: "from" })
    await fails(
      decide(admin, ambiguous.assertionId, lineRevision(ambiguous.lineId), "confirmed"),
      "invalid_price",
      "22023"
    )
    await ok(
      decide(admin, ambiguous.assertionId, lineRevision(ambiguous.lineId), "declined")
    )
    // A manual proposal keeps exact GBP minor units.
    expect(
      (
        await ok<Proposed>(
          propose(managerA, { item: pie(), portion: { label: "Small" }, field: "price", value: gbp("9.95") })
        )
      ).value
    ).toEqual({ kind: "fixed", amountMinor: 995, currency: "GBP" })
  })
})

// ---------------------------------------------------------------------------
// Resolution through the read path (B04-02b, §5.5)
// ---------------------------------------------------------------------------

type HistoryView = {
  price: Record<string, unknown>
  availability: Record<string, unknown>
  assertions: {
    assertionId: string
    resolution: string
    decisions: unknown[]
    rawText?: unknown
  }[]
}

function lineRecords(line: string): LineRecords {
  const assertions = rows<
    LineRecords["assertions"][number]
  >(`select a.id, a.field, a.value, a.basis,
      a.supersedes, a.effective_from::text as "effectiveFrom", a.effective_to::text as "effectiveTo"
    from public.menu_trading_assertions a where a.line_id = ${literal(line)} order by a.seq`)
  const decisions = rows<
    LineRecords["decisions"][number]
  >(`select d.assertion_id as "assertionId",
      d.decision, to_json(d.decided_at) #>> '{}' as "decidedAt", d.seq,
      d.stated_on::text as "statedOn", d.stated_on_source as "statedOnSource"
    from public.menu_trading_decisions d where d.line_id = ${literal(line)} order by d.seq`)
  return { assertions, decisions, timeZone: "Europe/London" }
}

function sameState(
  sql: Record<string, unknown>,
  ts: ReturnType<typeof resolveField>
) {
  expect({
    status: sql.status,
    assertionId: sql.assertionId,
    reason: sql.reason,
    detail: sql.detail,
    value: sql.value,
  }).toEqual({
    status: ts.status,
    assertionId: "assertionId" in ts ? ts.assertionId : undefined,
    reason: "reason" in ts ? ts.reason : undefined,
    detail: "detail" in ts ? ts.detail : undefined,
    value: "value" in ts ? ts.value : undefined,
  })
}

describe("resolution through the read path (§5.5, §5.2 #6–7)", () => {
  it("changes a future confirmed price at venue-local midnight, and keeps the old one in history", async () => {
    const h = await ok<Proposed>(
      propose(managerA, {
        item: curry().itemId,
        variant: curry().variants[1]!.variantId,
        field: "price",
        value: gbp("14.00"),
      })
    )
    await confirm(managerA, h)
    const p = await ok<Proposed>(
      propose(managerA, {
        line: h.lineId,
        field: "price",
        value: gbp("14.50"),
        from: dayOffset(1),
      })
    )
    await confirm(managerA, p)
    const midnight = localMidnightIso(dayOffset(1))
    const before = new Date(Date.parse(midnight) - 1000).toISOString()

    const now = await ok<HistoryView>(history(managerA, h.lineId))
    expect(now.price).toMatchObject({
      status: "available",
      assertionId: h.assertionId,
      value: { amountMinor: 1400 },
    })
    expect(
      await ok<HistoryView>(history(managerA, h.lineId, before))
    ).toMatchObject({
      price: { assertionId: h.assertionId },
    })
    const after = await ok<HistoryView>(history(managerA, h.lineId, midnight))
    expect(after.price).toMatchObject({
      status: "available",
      assertionId: p.assertionId,
      value: { amountMinor: 1450 },
    })
    expect(after.assertions.map((a) => [a.assertionId, a.resolution])).toEqual([
      [h.assertionId, "superseded"],
      [p.assertionId, "current"],
    ])
    expect(now.assertions.map((a) => [a.assertionId, a.resolution])).toEqual([
      [h.assertionId, "current"],
      [p.assertionId, "confirmed"],
    ])
    // The staff read changes with the clock too, with no job.
    const records = lineRecords(h.lineId)
    for (const at of [before, midnight, new Date().toISOString()])
      sameState(
        (await ok<HistoryView>(history(managerA, h.lineId, at))).price,
        resolveField(records, "price", at)
      )
    // History before either value was confirmed has neither.
    const early = await ok<HistoryView>(
      history(managerA, h.lineId, "2020-01-01T00:00:00Z")
    )
    expect(early.price).toMatchObject({ detail: "not_recorded" })
    expect(early.assertions).toEqual([])
  })

  it("reads a withdrawal with no replacement as withdrawn, never the older value", async () => {
    const g = await ok<Proposed>(
      propose(managerA, {
        item: fish(),
        portion: { label: "Small" },
        field: "price",
        value: gbp(8),
      })
    )
    await confirm(managerA, g)
    const h = await ok<Proposed>(
      propose(managerA, { line: g.lineId, field: "price", value: gbp(9) })
    )
    await confirm(managerA, h)
    const w = await ok<Decided>(
      decide(managerA, h.assertionId, lineRevision(g.lineId), "withdrawn", {
        reason: "TEST off",
      })
    )
    expect(w.current).toEqual({
      status: "unavailable",
      reason: "withdrawn",
      detail: "value_withdrawn",
    })
    const view = await ok<HistoryView>(history(managerA, g.lineId))
    expect(view.assertions.map((a) => a.resolution)).toEqual([
      "superseded",
      "withdrawn",
    ])
    sameState(
      view.price,
      resolveField(lineRecords(g.lineId), "price", new Date().toISOString())
    )
  })

  it("reads two confirmed values on the same dates as disputed / conflict, never an arbitrary price", async () => {
    const base = await ok<Proposed>(
      propose(managerA, {
        item: fish(),
        portion: { label: "Conflict" },
        field: "price",
        value: gbp(1),
      })
    )
    // Possible only by concurrent writes outside the commands; set up directly.
    const ids = [randomUUID(), randomUUID()]
    for (const [i, id] of ids.entries())
      psql(`insert into public.menu_trading_assertions (id, line_id, venue_id, field, value, basis, stated_by, command_key)
        values (${literal(id)}, ${literal(base.lineId)}, ${literal(venueA)}, 'price',
          ${sqlJson({ kind: "fixed", amountMinor: 2000 + i, currency: "GBP" })}, 'manager_statement',
          ${literal(managerA.id)}, gen_random_uuid());
        insert into public.menu_trading_decisions (assertion_id, line_id, venue_id, field, decision, decided_by,
          decided_at, stated_on, stated_on_source, line_revision, command_key)
        values (${literal(id)}, ${literal(base.lineId)}, ${literal(venueA)}, 'price', 'confirmed',
          ${literal(managerA.id)}, now() - interval '1 hour', current_date, 'form_default', 1, gen_random_uuid())`)
    const view = await ok<HistoryView>(history(managerA, base.lineId))
    expect(view.price).toMatchObject({
      status: "unavailable",
      reason: "disputed",
      detail: "conflict",
    })
    expect([...((view.price.assertionIds as string[]) ?? [])].sort()).toEqual(
      [...ids].sort()
    )
    sameState(
      view.price,
      resolveField(lineRecords(base.lineId), "price", new Date().toISOString())
    )
    // Withdrawing one resolves it.
    await ok(decide(managerA, ids[1]!, lineRevision(base.lineId), "withdrawn"))
    expect(
      (await ok<HistoryView>(history(managerA, base.lineId))).price
    ).toMatchObject({
      status: "available",
      assertionId: ids[0],
    })
  })

  it("never reads menu_entries.source_meta in a trading function", () => {
    expect(
      rows(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where (p.proname like 'menu\\_trading%' or p.proname like 'menu\\_availability%'
          or p.proname like 'menu\\_service%'
          or p.proname in ('menu_set_temporarily_unavailable', 'menu_open_rechecks', 'menu_open_recheck_rows',
            'menu_close_rechecks', 'menu_parse_price'))
          and p.prosrc ilike '%source_meta%'`)
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Availability schedules (B04-02c)
// ---------------------------------------------------------------------------

type FixtureCase = {
  name: string
  input: {
    timezone: string
    effectiveFrom: string
    effectiveTo?: string
    recurrence: unknown
    windows: unknown
    exceptions?: { localDate: string; kind: string; windows?: unknown }[]
    from: string
    to: string
  }
  expect: { occurrences?: Occurrence[] }
}
const { cases } = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/knowledge/occurrences.json"),
    "utf8"
  )
) as { cases: FixtureCase[] }

describe("availability schedules (B04-02c)", () => {
  it("expands the shared B03 fixtures the same way in SQL and TS (DST, past midnight, exceptions)", () => {
    for (const c of cases.filter((x) => x.expect.occurrences?.length)) {
      const id = randomUUID()
      // History rows dated before the fixtures, so every exception applies.
      psql(`insert into public.menu_availability_schedules (id, venue_id, timezone, recurrence, windows,
          effective_from, effective_to, created_by, created_at, command_key)
        values (${literal(id)}, ${literal(venueA)}, ${literal(c.input.timezone)}, ${sqlJson(c.input.recurrence)},
          ${sqlJson(c.input.windows)}, ${literal(c.input.effectiveFrom)},
          ${c.input.effectiveTo ? literal(c.input.effectiveTo) : "null"}, ${literal(admin.id)},
          '2025-01-01T00:00:00Z', gen_random_uuid())`)
      for (const e of c.input.exceptions ?? [])
        psql(`insert into public.menu_availability_exceptions (schedule_id, venue_id, local_date, kind, windows,
            created_by, created_at, command_key)
          values (${literal(id)}, ${literal(venueA)}, ${literal(e.localDate)}, ${literal(e.kind)},
            ${e.windows ? sqlJson(e.windows) : "null"}, ${literal(admin.id)}, '2025-01-01T00:00:00Z',
            gen_random_uuid())`)
      const schedule: LocalMenuSchedule = {
        id,
        timezone: c.input.timezone,
        effectiveFrom: c.input.effectiveFrom,
        effectiveTo: c.input.effectiveTo ?? null,
        recurrence: c.input.recurrence,
        windows: c.input.windows,
        exceptions: (c.input.exceptions ??
          []) as LocalMenuSchedule["exceptions"],
      }
      const instants = c.expect.occurrences!.flatMap((o) => {
        const s = Date.parse(o.startsAt)
        const e = Date.parse(o.endsAt)
        return [s - 60_000, s, (s + e) / 2, e - 1000, e]
      })
      for (const at of instants) {
        const iso = new Date(at).toISOString()
        const sql = JSON.parse(
          psql(
            `select private.menu_trading_schedule_state(${literal(id)}, ${literal(iso)}::timestamptz)::text`
          )
        )
        const ts = scheduleStateAt(schedule, iso)
        expect(
          {
            state: sql.state,
            localDate: sql.occurrence?.localDate,
            startsAt:
              sql.occurrence && new Date(sql.occurrence.startsAt).toISOString(),
          },
          `${c.name} @ ${iso}`
        ).toEqual({
          state: ts.state,
          localDate: "occurrence" in ts ? ts.occurrence.localDate : undefined,
          startsAt: "occurrence" in ts ? ts.occurrence.startsAt : undefined,
        })
      }
    }
  })

  it("lets a manager add schedules and exceptions with B03 validation; staff and other venues cannot", async () => {
    const shape = {
      effectiveFrom: today(),
      recurrence: { kind: "weekly", days: ["sun"] },
      windows: [{ start: "12:00", end: "15:00" }],
    }
    const add = (
      who: TestIdentity,
      schedule: unknown,
      extra: Record<string, unknown> = {}
    ) =>
      rpc(who, "menu_availability_schedule_add", {
        p_venue: venueA,
        p_schedule: schedule,
        p_timezone: null,
        p_knowledge_check_id: null,
        p_supersedes: null,
        p_request_key: randomUUID(),
        ...extra,
      })
    const s = await ok<{ scheduleId: string }>(add(managerA, shape))
    expect(
      psql(
        `select timezone from public.menu_availability_schedules where id = ${literal(s.scheduleId)}`
      )
    ).toBe("Europe/London")
    await fails(add(staffA, shape), "not_venue_manager", "42501")
    await fails(add(managerB, shape), "not_venue_manager", "42501")
    const bad = {
      effectiveFrom: today(),
      recurrence: { kind: "weekly", days: ["sun", "sun"] },
      windows: [{ start: "12:00", end: "12:00" }],
    }
    const e = await fails(add(managerA, bad), "invalid_value", "22023")
    expect(JSON.parse(e.details!).fields).toEqual(
      scheduleProblems("schedule", bad)
    )
    await fails(
      add(managerA, shape, { p_timezone: "Mars/Base" }),
      "invalid_timezone",
      "22023"
    )

    const exception = (
      who: TestIdentity,
      date: string,
      kind: string,
      windows: unknown = null
    ) =>
      rpc(who, "menu_availability_exception_add", {
        p_schedule: s.scheduleId,
        p_local_date: date,
        p_kind: kind,
        p_windows: windows,
        p_note: "TEST closed for a party",
        p_request_key: randomUUID(),
      })
    await ok(exception(managerA, dayOffset(7), "cancelled"))
    await fails(
      exception(managerA, dayOffset(7), "extra", [
        { start: "18:00", end: "20:00" },
      ]),
      "menu_schedule_exception_exists",
      "P0001"
    )
    await fails(
      exception(managerA, dayOffset(-1), "cancelled"),
      "invalid_value",
      "22023"
    )
    await fails(
      exception(staffA, dayOffset(8), "cancelled"),
      "not_venue_manager",
      "42501"
    )

    // An availability assertion names a schedule of its own venue only.
    const otherVenue = randomUUID()
    psql(`insert into public.menu_availability_schedules (id, venue_id, recurrence, windows, effective_from,
        created_by, command_key) values (${literal(otherVenue)}, ${literal(venueB)}, ${sqlJson(shape.recurrence)},
        ${sqlJson(shape.windows)}, current_date, ${literal(admin.id)}, gen_random_uuid())`)
    await fails(
      propose(managerA, {
        item: fish(),
        field: "availability",
        value: { state: "scheduled", scheduleId: otherVenue },
      }),
      "menu_schedule_not_found",
      "P0002"
    )
    const a = await ok<Proposed>(
      propose(managerA, {
        item: fish(),
        field: "availability",
        value: { state: "scheduled", scheduleId: s.scheduleId },
      })
    )
    await confirm(managerA, a)
    const view = await ok<{
      lines: { lineId: string; availability: Record<string, unknown> }[]
    }>(linesFor(staffA, fish()))
    expect(
      view.lines.find((l) => l.lineId === a.lineId)!.availability
    ).toMatchObject({
      scheduleId: s.scheduleId,
      source: "menu_schedule",
    })
  })
})

// ---------------------------------------------------------------------------
// Temporary unavailability and rechecks (B04-02c, A1-4, A1-5)
// ---------------------------------------------------------------------------

const openTasks = (line: string) =>
  rows<{
    id: string
    cause: string
    state: string
    dueAt: string
  }>(`select id, cause, state, to_json(due_at) #>> '{}' as "dueAt"
    from public.menu_trading_recheck_tasks where line_id = ${literal(line)} order by created_at, id`)

/** An `until` an hour ahead: never passed by the time the test reads it. */
const untilAhead = () =>
  psql(
    `select to_json(date_trunc('second', now()) + interval '1 hour') #>> '{}'`
  )
const plusSeconds = (instant: string, seconds: number) =>
  new Date(Date.parse(instant) + seconds * 1000).toISOString()

describe("temporary unavailability and the b1 recheck foundation (A1-4, A1-5)", () => {
  let venueR: string
  let managerR: TestIdentity
  let staffR: TestIdentity
  let docR: Awaited<ReturnType<typeof readDocument>>
  const R = (key: string) => docR.byKey[key]!.itemId
  /** The job as of one minute past `until`, bounded to this block's venue. */
  const jobAfter = (until: string) =>
    runJob(`${literal(until)}::timestamptz + interval '1 minute'`, [venueR])
  const availabilityAt = async (line: string, at: string | null) =>
    (await ok<HistoryView>(history(managerR, line, at))).availability
  const setUntil = (itemId: string, until: string | null) =>
    ok<{ lines: { lineId: string; assertionId: string }[] }>(
      rpc(managerR, "menu_set_temporarily_unavailable", {
        p_item: itemId,
        p_variant: null,
        p_until: until,
        p_reason: null,
        p_request_key: randomUUID(),
      })
    )

  beforeAll(async () => {
    venueR = (await createVenue(service, "trading-r")).id
    ;[managerR, staffR] = await Promise.all([
      createIdentity(service, {
        label: "tr-mgr-r",
        role: "staff",
        venueId: venueR,
      }),
      createIdentity(service, {
        label: "tr-staff-r",
        role: "staff",
        venueId: venueR,
      }),
    ])
    await legacyStaffGrant(service, admin, managerR.id, venueR)
    docR = await readDocument(
      service,
      await publishMenu(
        admin,
        venueR,
        menu("TEST trading R", [
          section("mains", "Mains", [
            item("mains--pie", "Pie"),
            item("mains--fish", "Fish"),
            item("mains--soup", "Soup"),
            item("mains--stew", "Stew"),
          ]),
        ])
      )
    )
  })

  it("is a manager's statement, current at once, on every live line of the item", async () => {
    await fails(
      rpc(staffA, "menu_set_temporarily_unavailable", {
        p_item: cider(),
        p_variant: null,
        p_until: null,
        p_reason: null,
        p_request_key: randomUUID(),
      }),
      "not_venue_manager",
      "42501"
    )
    await fails(
      rpc(managerA, "menu_set_temporarily_unavailable", {
        p_item: cider(),
        p_variant: null,
        p_until: "2020-01-01T00:00:00Z",
        p_reason: null,
        p_request_key: randomUUID(),
      }),
      "invalid_until",
      "22023"
    )
    const set = await ok<{ lines: { lineId: string }[] }>(
      rpc(managerA, "menu_set_temporarily_unavailable", {
        p_item: cider(),
        p_variant: null,
        p_until: null,
        p_reason: "TEST keg out",
        p_request_key: randomUUID(),
      })
    )
    const live = rows<{ id: string }>(`select id from public.menu_trading_lines
      where item_id = ${literal(cider())} and retired_at is null order by id`)
    expect(set.lines.map((l) => l.lineId)).toEqual(live.map((l) => l.id))
    const view = await ok<{
      lines: { availability: Record<string, unknown> }[]
    }>(linesFor(staffA, cider()))
    for (const l of view.lines)
      expect(l.availability).toMatchObject({
        state: "temporarily_unavailable",
        until: null,
      })
  })

  it("reads needs_checking past `until` with the job stopped; bounded runs open one task; only a newer current statement closes it", async () => {
    const until = untilAhead()
    const set = await setUntil(R("mains--pie"), until)
    const line = set.lines[0]!.lineId
    const expired = set.lines[0]!.assertionId
    // Now: unavailable until then. As of one second past it: needs_checking,
    // with no job and no task (an explicit as-of read, never a clock wait).
    expect(await availabilityAt(line, null)).toMatchObject({
      state: "temporarily_unavailable",
    })
    expect(await availabilityAt(line, plusSeconds(until, 1))).toMatchObject({
      state: "needs_checking",
      reason: "stale",
      detail: "recheck_requested",
    })
    expect(openTasks(line)).toEqual([])

    // Two bounded runs: one task, due at `until`.
    jobAfter(until)
    jobAfter(until)
    const tasks = openTasks(line)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      cause: "temporary_until_passed",
      state: "open",
    })
    expect(Date.parse(tasks[0]!.dueAt)).toBe(Date.parse(until))
    expect(
      rows(`select task_id from private.menu_open_recheck_rows(${literal(venueR)})
        where task_id = ${literal(tasks[0]!.id)}`)
    ).toHaveLength(1)
    expect(
      rows(`select * from private.menu_open_recheck_rows(${literal(venueB)})`)
    ).toEqual([])

    // A pending staff report, its decline, and a withdrawal of the passed
    // statement read nothing current: the task stays open, also after a run.
    const report = await ok<Proposed>(
      propose(staffR, {
        line,
        field: "temporary_unavailability",
        value: { state: "back_in_service" },
      })
    )
    jobAfter(until)
    expect(openTasks(line).map((t) => t.state)).toEqual(["open"])
    await ok(
      decide(managerR, report.assertionId, lineRevision(line), "declined")
    )
    jobAfter(until)
    expect(openTasks(line).map((t) => t.state)).toEqual(["open"])
    await ok(decide(managerR, expired, lineRevision(line), "withdrawn"))
    expect(await availabilityAt(line, plusSeconds(until, 1))).toMatchObject({
      state: "unknown",
    })
    jobAfter(until)
    expect(openTasks(line).map((t) => t.state)).toEqual(["open"])

    // A newer confirmed return to service closes it, in the decision itself.
    const back = await ok<Proposed>(
      propose(managerR, {
        line,
        field: "temporary_unavailability",
        value: { state: "back_in_service" },
      })
    )
    await confirm(managerR, back)
    expect(openTasks(line).map((t) => t.state)).toEqual(["done"])
    expect(
      rows(`select task_id from private.menu_open_recheck_rows(${literal(venueR)})
        where task_id = ${literal(tasks[0]!.id)}`)
    ).toEqual([])
    // Closed once: the task cannot be reopened or deleted (contained probes).
    const task = literal(tasks[0]!.id)
    expect(
      denial(
        `update public.menu_trading_recheck_tasks set state = 'open', closed_at = null where id = ${task}`
      )
    ).toBe("menu_trading_recheck_task_immutable")
    expect(
      denial(`delete from public.menu_trading_recheck_tasks where id = ${task}`)
    ).toBe("menu_trading_recheck_task_immutable")
    expect(denial(`truncate public.menu_trading_recheck_tasks`)).toBe(
      "audit_append_only"
    )
    expect(openTasks(line).map((t) => t.state)).toEqual(["done"])
  })

  it("closes on a newer statement with no `until`, and opens nothing for an item off the active menu", async () => {
    const until = untilAhead()
    const line = (await setUntil(R("mains--fish"), until)).lines[0]!.lineId
    jobAfter(until)
    expect(openTasks(line).map((t) => t.state)).toEqual(["open"])
    await setUntil(R("mains--fish"), null)
    expect(openTasks(line).map((t) => t.state)).toEqual(["done"])

    // The stew leaves the active menu: the job's eligibility re-read skips it.
    const stewUntil = untilAhead()
    const stewLine = (await setUntil(R("mains--stew"), stewUntil)).lines[0]!
      .lineId
    const active = rows<{ id: string }>(`select id from public.menu_versions
      where venue_id = ${literal(venueR)} and status = 'active'`)[0]!.id
    await publishMenu(
      admin,
      venueR,
      menu("TEST trading R v2", [
        section("mains", "Mains", [
          item("mains--pie", "Pie", { itemId: R("mains--pie") }),
          item("mains--fish", "Fish", { itemId: R("mains--fish") }),
          item("mains--soup", "Soup", { itemId: R("mains--soup") }),
        ]),
      ]),
      active
    )
    jobAfter(stewUntil)
    expect(openTasks(stewLine)).toEqual([])
  })

  it("serialises the job with a confirmation: a run during an uncommitted confirmation waits for the line and re-reads it", async () => {
    const until = untilAhead()
    const line = (await setUntil(R("mains--soup"), until)).lines[0]!.lineId
    const back = await ok<Proposed>(
      propose(managerR, {
        line,
        field: "temporary_unavailability",
        value: { state: "back_in_service" },
      })
    )
    const name = `b04-confirm-${randomUUID().slice(0, 8)}`
    const confirmation = psqlBackground(
      name,
      `begin;
${as(managerR)}
select public.menu_trading_decide(${literal(back.assertionId)}, ${lineRevision(line)}, 'confirmed',
  null, null, gen_random_uuid()) is not null;
reset role;
select pg_sleep(1.5);
commit;`
    )
    await untilSleeping(name)
    // The confirmation holds the line row; the run (as of past `until`) waits
    // for it, then reads the committed return to service: no task.
    jobAfter(until)
    await confirmation
    expect(openTasks(line)).toEqual([])
    expect(
      await availabilityAt(line, plusSeconds(until, 61))
    ).not.toMatchObject({ state: "needs_checking" })
  })

  it("opens no menu task for a schedule's end", async () => {
    const ended = await ok<{ scheduleId: string }>(
      rpc(managerR, "menu_availability_schedule_add", {
        p_venue: venueR,
        p_schedule: {
          effectiveFrom: today(),
          effectiveTo: today(),
          recurrence: { kind: "weekly", days: ["mon"] },
          windows: [{ start: "09:00", end: "10:00" }],
        },
        p_timezone: null,
        p_knowledge_check_id: null,
        p_supersedes: null,
        p_request_key: randomUUID(),
      })
    )
    const a = await ok<Proposed>(
      propose(managerR, {
        item: R("mains--pie"),
        channel: "takeaway",
        field: "availability",
        value: { state: "scheduled", scheduleId: ended.scheduleId },
      })
    )
    await confirm(managerR, a)
    const later = psql(
      `select to_json(now() + interval '3 days') #>> '{}'`
    )
    runJob(`${literal(later)}::timestamptz`, [venueR])
    expect(openTasks(a.lineId)).toEqual([])
    expect(await availabilityAt(a.lineId, later)).toMatchObject({
      state: "not_offered",
      detail: "schedule_ended",
    })
  })
})

// ---------------------------------------------------------------------------
// A linked B03 service, read as of one instant (A40 deliberate stop; A1-4)
// ---------------------------------------------------------------------------

const WEEKLY = {
  recurrence: { kind: "weekly", days: ["sun"] },
  windows: [{ start: "12:00", end: "15:00" }],
}
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10)

describe("a schedule linked to a same-venue B03 service (B04-02c)", () => {
  const KEY = "guest_toilets"
  let w: World
  let other: World
  let roast: string
  let asset: string
  let start: string

  const link = (who: TestIdentity, venue: string, check: string) =>
    rpc(who, "menu_availability_schedule_add", {
      p_venue: venue,
      p_schedule: { effectiveFrom: start },
      p_timezone: null,
      p_knowledge_check_id: check,
      p_supersedes: null,
      p_request_key: randomUUID(),
    })

  beforeAll(async () => {
    w = await world("menu-trading-linked")
    other = await world("menu-trading-linked-b")
    const version = await publishMenu(
      w.admin,
      w.venue,
      menu("TEST linked", [
        section("sunday", "Sunday", [item("sunday--roast", "Roast")]),
      ])
    )
    roast = (await readDocument(service, version)).byKey["sunday--roast"]!
      .itemId
    asset = await photo(w.staffA.id, w.venue)
    start = psql(`select ((now() at time zone 'Europe/London')::date)::text`)
  })

  it("links only an active service question of the same venue: a non-service check and another venue's real check are refused", async () => {
    // Every registry key is a presence question outside a scoped version.
    await fails(
      link(w.manager, w.venue, w.checks[KEY]!),
      "knowledge_check_not_service",
      "P0001"
    )
    // A real check of another venue reads as not found.
    await fails(
      link(w.manager, w.venue, other.checks[KEY]!),
      "knowledge_check_not_found",
      "P0002"
    )
    await fails(
      link(w.manager, other.venue, other.checks[KEY]!),
      "not_venue_manager",
      "42501"
    )
  })

  it("reads the service as of each instant: later exceptions, versions and stops never change an earlier read; a transferred reader B04 allows reads it; the stop holds; no menu task", () => {
    const check = w.checks[KEY]!
    // The next Sunday after today and its local instants.
    let sunday = addDays(start, 1)
    while (new Date(`${sunday}T12:00:00Z`).getUTCDay() !== 0)
      sunday = addDays(sunday, 1)
    const dayMs = Date.parse(`${sunday}T00:00:00Z`)
    const at = (days: number, hours: number) =>
      new Date(
        localInstant(
          dayMs + days * 86_400_000 + hours * 3_600_000,
          "Europe/London"
        )
      ).toISOString()
    const lunch = at(0, 12.5)
    const afternoon = at(0, 14)
    const evening = at(0, 18.5)
    const nextEvening = at(7, 18.5)

    const revision = `reset role;
do $$ begin perform set_config('b04.rev', private.knowledge_slot_revision(${literal(w.venue)}, ${literal(KEY)})::text, true); end $$;`
    const read = (who: TestIdentity, instant: string) => `${as(who)}
select (public.menu_trading_history(current_setting('b04.line')::uuid, ${literal(instant)}::timestamptz)
  -> 'availability')::text;
reset role;`
    const lineRead = (who: TestIdentity) => `${as(who)}
select jsonb_build_object('view', x.v ->> 'view', 'availability',
  (select l -> 'availability' from jsonb_array_elements(x.v -> 'lines') l
   where l ->> 'lineId' = current_setting('b04.line')))::text
from (select public.menu_trading_lines_for_item(${literal(roast)}) as v) x;
reset role;`
    const latestSchedule = `(select s.id from public.knowledge_schedules s
      where s.check_id = ${literal(check)} order by s.created_at desc, s.id desc limit 1)`

    // One transaction, always rolled back: the service registry version and
    // every row below never reach the shared stack. Later facts are dated
    // after the earlier reads' instant, as B03 history records them.
    const out = psqlScript(`begin;
insert into public.knowledge_question_versions (key, version, catalogue_version, rule_version, value_schema,
  value_schema_version, guidance, evidence_rule, confirmation, self_confirmation_allowed, sensitivity, freshness,
  publishable_fields, material_fields, requires_zones, lifecycle, change_kind, change_note, family, subject_type,
  owner_role, features, public_media, upgrade_rules)
select v.key, v.version + 1, v.catalogue_version, v.rule_version, 'service', 1, v.guidance, v.evidence_rule,
  v.confirmation, v.self_confirmation_allowed, v.sensitivity,
  jsonb_build_object('internal', null, 'public', null),
  v.publishable_fields, v.material_fields, v.requires_zones, v.lifecycle, 'schema',
  'TEST B04 rollback-scoped service version', 'service', v.subject_type, v.owner_role, v.features, v.public_media,
  v.upgrade_rules
from public.knowledge_question_versions v where v.key = ${literal(KEY)} order by v.version desc limit 1;
${revision}
${as(w.staffA)}
do $$ declare r jsonb; begin
  r := public.knowledge_submit(p_check_id => ${literal(check)},
    p_slot_revision => current_setting('b04.rev')::bigint, p_idempotency_key => gen_random_uuid(),
    p_kind => 'finding', p_answer => 'yes', p_finding => null, p_limitations => null, p_reason => null,
    p_unknown_preset => null, p_tried_text => null, p_change_reason => null, p_responds_to => null,
    p_asset_ids => array[${literal(asset)}]::uuid[], p_internal_metadata => null, p_redaction_confirmed => null,
    p_confirm_own => false,
    p_detail => ${sqlJson({ schedule: { effectiveFrom: start, ...WEEKLY } })},
    p_observed_on => null, p_observed_on_source => null);
  perform set_config('b04.c', r ->> 'contributionId', true);
  perform set_config('b04.waits', (r ->> 'outcome' = 'awaiting_confirmation')::text, true);
end $$;
reset role;
select current_setting('b04.waits')::boolean as waits \\gset
\\if :waits
${revision}
${as(w.manager)}
do $$ begin
  perform public.knowledge_decide('contribution', current_setting('b04.c')::uuid, 'confirm',
    current_setting('b04.rev')::bigint, gen_random_uuid(), null);
end $$;
reset role;
\\endif
${as(w.manager)}
do $$ declare s jsonb; p jsonb; begin
  s := public.menu_availability_schedule_add(${literal(w.venue)}, ${sqlJson({ effectiveFrom: start })}, null,
    ${literal(check)}, null, gen_random_uuid());
  p := public.menu_trading_propose(null, ${literal(roast)}, null, null, null, 'availability',
    jsonb_build_object('state', 'scheduled', 'scheduleId', s ->> 'scheduleId'), null, null, null, null, null,
    gen_random_uuid());
  perform set_config('b04.line', p ->> 'lineId', true);
  perform public.menu_trading_decide((p ->> 'assertionId')::uuid, (p ->> 'lineRevision')::integer, 'confirmed',
    null, null, gen_random_uuid());
end $$;
reset role;
${read(w.manager, lunch)}
${read(w.manager, afternoon)}
${read(w.manager, evening)}
reset role;
update public.profiles set venue_id = ${literal(other.venue)} where id = ${literal(w.staffA.id)};
${as(w.staffA)}
do $$ begin
  perform public.knowledge_occurrences(${literal(check)}, current_date, current_date);
  perform set_config('b04.b03', 'readable', true);
exception when others then
  perform set_config('b04.b03', sqlerrm, true);
end $$;
select to_json(current_setting('b04.b03'))::text;
reset role;
${lineRead(w.staffA)}
${lineRead(w.manager)}
reset role;
insert into public.knowledge_schedule_exceptions (schedule_id, venue_id, local_date, kind, created_by, created_at)
select s.id, s.venue_id, ${literal(sunday)}, 'cancelled', ${literal(w.manager.id)}, ${literal(at(0, 13.5))}
from public.knowledge_schedules s where s.id = ${latestSchedule};
insert into public.knowledge_schedules (venue_id, question_key, check_id, contribution_id, submission_id, supersedes,
  timezone, effective_from, effective_to, recurrence, windows, created_at)
select s.venue_id, s.question_key, s.check_id, s.contribution_id, s.submission_id, s.id, s.timezone,
  s.effective_from, s.effective_to, s.recurrence, '[{"start": "18:00", "end": "20:00"}]'::jsonb,
  ${literal(at(0, 14.5))}
from public.knowledge_schedules s where s.id = ${latestSchedule};
insert into public.knowledge_detail_corrections (contribution_id, venue_id, detail, decision_id, created_at)
select x.id, x.venue_id,
  coalesce(d.detail, '{}'::jsonb) || jsonb_build_object('lastDayOffered', ${literal(sunday)}),
  (select k.id from public.knowledge_decisions k where k.check_id = ${literal(check)}
   order by k.created_at, k.id limit 1),
  ${literal(at(0, 15.5))}
from public.venue_amenity_checks c
join public.amenity_submissions sub on sub.id = c.current_submission_id
join public.knowledge_contributions x on x.id = sub.source_contribution_id
left join public.knowledge_contribution_details d on d.contribution_id = x.id
where c.id = ${literal(check)};
${read(w.manager, lunch)}
${read(w.manager, afternoon)}
${read(w.manager, evening)}
${read(w.manager, nextEvening)}
reset role;
select to_json(private.menu_open_rechecks(${literal(nextEvening)}::timestamptz + interval '1 day',
  array[${literal(w.venue)}]::uuid[]))::text;
select to_json((select count(*) from public.menu_trading_recheck_tasks t
  where t.line_id = current_setting('b04.line')::uuid))::text;
rollback;
`).map((line) => JSON.parse(line) as unknown)

    const [
      lunchBefore,
      afternoonBefore,
      eveningBefore,
      b03Public,
      transferred,
      manager,
      lunchAfter,
      afternoonAfter,
      eveningAfter,
      nextEveningAfter,
      ,
      menuTasks,
    ] = out as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
      string,
      { view: string; availability: Record<string, unknown> },
      { view: string; availability: Record<string, unknown> },
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
      number,
      number,
    ]
    expect(out).toHaveLength(12)
    expect(lunchBefore).toMatchObject({
      state: "available",
      source: "service",
      occurrence: { localDate: sunday },
    })
    expect(afternoonBefore).toMatchObject({
      state: "available",
      source: "service",
    })
    expect(eveningBefore).toMatchObject({
      state: "outside_window",
      source: "service",
    })

    // B03's public read refuses the moved staff member; B04 still lets them
    // read the line (they labelled at this venue) and reads the service for
    // them exactly as for the manager.
    expect(b03Public).toBe("amenity_check_not_found")
    expect(transferred.view).toBe("staff")
    expect(manager.view).toBe("manager")
    expect(transferred.availability).toEqual(manager.availability)
    expect(transferred.availability).toMatchObject({ source: "service" })
    expect(JSON.stringify(transferred)).not.toContain("unreadable")

    // The earlier read is unchanged after the later exception, version and
    // stop; each later fact applies from when it was recorded.
    expect(lunchAfter).toEqual(lunchBefore)
    expect(afternoonAfter).toMatchObject({
      state: "cancelled",
      source: "service",
    })
    expect(eveningAfter).toMatchObject({
      state: "available",
      source: "service",
      occurrence: { localDate: sunday },
    })
    expect(nextEveningAfter).toMatchObject({
      state: "not_offered",
      detail: "service_not_offered",
      source: "service",
    })
    // B03 keeps the service's recheck: the bounded run opens no menu task.
    expect(menuTasks).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// T9b catalogue and function privileges (§3, §19.3)
// ---------------------------------------------------------------------------

describe("catalogue assertions (T9b) and privileges", () => {
  const PUBLIC = [
    ["menu_availability_exception_add", "v"],
    ["menu_availability_schedule_add", "v"],
    ["menu_set_temporarily_unavailable", "v"],
    ["menu_trading_decide", "v"],
    ["menu_trading_history", "s"],
    ["menu_trading_lines_for_item", "s"],
    ["menu_trading_propose", "v"],
  ]

  it("keeps the two reads STABLE definers and the commands volatile, all with an empty search path", () => {
    expect(
      rows<{
        name: string
        volatility: string
        definer: boolean
        config: string[]
      }>(`select p.proname as name,
          p.provolatile as volatility, p.prosecdef as definer, p.proconfig as config
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any (${literal(`{${PUBLIC.map((x) => x[0]).join(",")}}`)}::text[])
        order by 1`)
    ).toEqual(
      PUBLIC.map(([name, volatility]) => ({
        name,
        volatility,
        definer: true,
        config: ['search_path=""'],
      }))
    )
  })

  it("keeps the read helpers STABLE (one snapshot) and the A1-5 helper's shape", () => {
    const stable = [
      "menu_open_recheck_rows",
      "menu_service_detail_at",
      "menu_service_occurrences",
      "menu_service_state_at",
      "menu_trading_availability",
      "menu_trading_field_state",
      "menu_trading_head",
      "menu_trading_line_json",
      "menu_trading_resolution",
      "menu_trading_schedule_state",
      "menu_trading_temporary_state",
    ]
    expect(
      rows<{
        name: string
        volatility: string
      }>(`select p.proname as name, p.provolatile as volatility
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = any (${literal(`{${stable.join(",")}}`)}::text[])
        order by 1`)
    ).toEqual(stable.map((name) => ({ name, volatility: "s" })))
    expect(
      psql(
        `select pg_get_function_result('private.menu_open_recheck_rows(uuid)'::regprocedure)`
      )
    ).toBe(
      "TABLE(task_id uuid, due_at timestamp with time zone, created_at timestamp with time zone)"
    )
    expect(
      psql(
        `select provolatile || ':' || prosecdef from pg_proc where oid = 'private.menu_open_rechecks(timestamptz,uuid[])'::regprocedure`
      )
    ).toBe("v:true")
  })

  it("grants the RPCs to signed-in users only and the helpers to no client", () => {
    for (const fn of [
      "public.menu_trading_propose(uuid,uuid,uuid,jsonb,text,text,jsonb,date,date,date,text,jsonb,uuid)",
      "public.menu_trading_decide(uuid,integer,text,text,date,uuid)",
      "public.menu_set_temporarily_unavailable(uuid,uuid,timestamptz,text,uuid)",
      "public.menu_availability_schedule_add(uuid,jsonb,text,uuid,uuid,uuid)",
      "public.menu_availability_exception_add(uuid,date,text,jsonb,text,uuid)",
      "public.menu_trading_lines_for_item(uuid)",
      "public.menu_trading_history(uuid,timestamptz)",
    ])
      expect(
        psql(`select has_function_privilege('anon', '${fn}', 'execute') || ':' ||
          has_function_privilege('authenticated', '${fn}', 'execute') || ':' ||
          has_function_privilege('service_role', '${fn}', 'execute')`),
        fn
      ).toBe("false:true:false")
    for (const fn of [
      "private.menu_open_rechecks(timestamptz,uuid[])",
      "private.menu_open_recheck_rows(uuid)",
      "private.menu_service_state_at(uuid,uuid,timestamptz)",
      "private.menu_service_occurrences(uuid,timestamptz,date,date,timestamptz)",
      "private.menu_trading_lock_actor(uuid)",
      "private.menu_close_rechecks(uuid,timestamptz)",
      "private.menu_trading_field_state(uuid,text,timestamptz)",
      "private.menu_parse_price(jsonb,text)",
    ])
      expect(
        psql(`select has_function_privilege('anon', '${fn}', 'execute') || ':' ||
          has_function_privilege('authenticated', '${fn}', 'execute')`),
        fn
      ).toBe("false:false")
  })

  it("reads a linked service only through private B04 projections, never a public B03 read", () => {
    expect(
      rows(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where (p.proname like 'menu\\_trading%' or p.proname like 'menu\\_availability%'
          or p.proname like 'menu\\_service%')
          and p.prosrc ~* 'public\\.knowledge_'`)
    ).toEqual([])
    // WS1/WS6's hourly route calls the job with p_now only: every venue.
    expect(
      psql(`select pg_get_function_arguments('private.menu_open_rechecks(timestamptz,uuid[])'::regprocedure)`)
    ).toBe("p_now timestamp with time zone, p_venue_ids uuid[] DEFAULT NULL::uuid[]")
  })

  it("writes no catalogue, label or photo table from any B04-b1 function", () => {
    expect(
      rows(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where (p.proname like 'menu\\_trading%' or p.proname like 'menu\\_availability%'
          or p.proname like 'menu\\_service%'
          or p.proname in ('menu_set_temporarily_unavailable', 'menu_open_rechecks', 'menu_close_rechecks'))
          and p.prosrc ~* '(insert into|update|delete from)\\s+public\\.(menu_items|menu_variants|menu_versions|menu_entries|menu_entry_variants|menu_item_photos|menu_item_photo_events|menu_item_photo_heads|media_label_items)'`)
    ).toEqual([])
  })
})
