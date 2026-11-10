// B04 credit tests for sub-batch b1 (b04-design §13.2, A1-1, A1-8):
//   C-B04-1: trading proposals and decisions (a staff report, a manager's
//     confirmation, a decline, a withdrawal, temporary unavailability and a
//     schedule) leave every participant's monthly counts unchanged.
//   C-B04-4 (b1 subset): a passed `until`, with the job stopped and then run
//     twice, leaves menu_item_photos, photo heads, photo events and monthly
//     counts unchanged and opens exactly one task for the line. (Expiry and
//     basis_missing join with S3's freshness bindings.)
// Each case compares the credit function's definition, the venue's photo
// rows, heads and events, and the monthly counts before and after. Real
// signed-in identities through PostgREST; psql (postgres, local only) reads
// state back and runs the private job, bounded to this suite's synthetic
// venue (never across the retained baseline). The `until` deadline is an
// hour ahead and read with an explicit as-of instant, never by waiting for
// the clock. Synthetic menu and prices.
import { randomUUID } from "node:crypto"

import { beforeAll, describe, expect, it } from "vitest"

import {
  createIdentity,
  createVenue,
  serviceClient,
  type TestIdentity,
} from "../support/identities"
import { legacyStaffGrant, psql } from "./coverage-fixtures"
import {
  item,
  menu,
  publishMenu,
  readDocument,
  reserveReady,
  saveOk,
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
const literal = (text: string) => `'${text.replace(/'/g, "''")}'`

const CREDIT_MD5 = "b78b9daeb8ede1fec0b7224d99348659"
const MONTH = `date_trunc('month', now() at time zone 'Europe/London')::date`

let venue: string
let admin: TestIdentity
let manager: TestIdentity
let staff: TestIdentity
let staff2: TestIdentity
let pie: string
let curry: string

/** What credit reads, for one venue: compared before and after each case. */
function creditState() {
  const digest = (table: string, order: string) =>
    psql(`select coalesce(md5(string_agg(to_jsonb(t)::text, ',' order by ${order})), 'none')
      from public.${table} t where t.venue_id = ${literal(venue)}`)
  return {
    creditFunction: psql(`select md5(pg_get_functiondef(
      'private.monthly_venue_completion_counts(uuid,uuid,date)'::regprocedure))`),
    photos: digest("menu_item_photos", "t.id"),
    heads: digest("menu_item_photo_heads", "t.item_id"),
    events: digest("menu_item_photo_events", "t.id"),
    counts: [staff, staff2, manager].map((who) =>
      psql(`select menu_items_completed || ':' || amenity_checks_completed
        from private.monthly_venue_completion_counts(${literal(venue)}, ${literal(who.id)}, ${MONTH})`)
    ),
  }
}

const lineRevision = (line: string) =>
  Number(
    psql(
      `select revision from public.menu_trading_lines where id = ${literal(line)}`
    )
  )

type Proposed = { assertionId: string; lineId: string }
const propose = (who: TestIdentity, args: Record<string, unknown>) =>
  ok<Proposed>(
    rpc(who, "menu_trading_propose", {
      p_line: null,
      p_item: null,
      p_variant: null,
      p_portion: null,
      p_channel: null,
      p_value: null,
      p_effective_from: null,
      p_effective_to: null,
      p_observed_on: null,
      p_reason: null,
      p_source: null,
      p_request_key: randomUUID(),
      ...args,
    })
  )
const decide = (who: TestIdentity, p: Proposed, decision: string) =>
  ok(
    rpc(who, "menu_trading_decide", {
      p_assertion: p.assertionId,
      p_expected_line_revision: lineRevision(p.lineId),
      p_decision: decision,
      p_reason: null,
      p_stated_on: null,
      p_request_key: randomUUID(),
    })
  )

beforeAll(async () => {
  venue = (await createVenue(service, "credit-b04")).id
  admin = await createIdentity(service, { label: "cb4-admin", role: "admin" })
  ;[manager, staff, staff2] = await Promise.all([
    createIdentity(service, {
      label: "cb4-mgr",
      role: "staff",
      venueId: venue,
    }),
    createIdentity(service, { label: "cb4-s1", role: "staff", venueId: venue }),
    createIdentity(service, { label: "cb4-s2", role: "staff", venueId: venue }),
  ])
  await legacyStaffGrant(service, admin, manager.id, venue)
  const version = await publishMenu(
    admin,
    venue,
    menu("TEST credit B04", [
      section("mains", "Mains", [
        item("mains--pie", "Pie"),
        item("mains--curry", "Curry", { variants: ["Chicken"] }),
      ]),
    ])
  )
  const doc = await readDocument(service, version)
  pie = doc.byKey["mains--pie"]!.itemId
  curry = doc.byKey["mains--curry"]!.itemId

  // One accepted photo: staff earns one menu unit this month.
  const asset = await reserveReady(service, staff)
  await saveOk(staff, {
    asset: asset.id,
    revision: 0,
    items: [{ itemId: pie, variantId: null }],
    catalogue: version,
  })
  const { error } = await manager.client.rpc("review_menu_item_photo", {
    p_asset_id: asset.id,
    p_item_id: pie,
    p_variant_id: null as unknown as string,
    p_decision: "accepted",
    p_expected_revision: 1,
    p_make_primary: false,
  })
  if (error) throw error
})

describe("C-B04-1: trading proposals and decisions leave credit unchanged", () => {
  it("staff report, manager confirmation, decline, withdrawal, temporary unavailability and a schedule", async () => {
    const before = creditState()
    expect(before.creditFunction).toBe(CREDIT_MD5)
    expect(before.counts[0]).toBe("1:0")
    expect(before.photos).not.toBe("none")

    // A staff price report, confirmed by the manager.
    const report = await propose(staff, {
      p_item: pie,
      p_field: "price",
      p_value: { amount: "10.50" },
    })
    await decide(manager, report, "confirmed")
    // A second staff report, declined.
    const declined = await propose(staff2, {
      p_line: report.lineId,
      p_field: "price",
      p_value: { amount: "11.00" },
    })
    await decide(manager, declined, "declined")
    // A manager price on a variant, confirmed then withdrawn.
    const variant = (
      await service
        .from("menu_variants")
        .select("id")
        .eq("item_id", curry)
        .single()
    ).data!.id as string
    const own = await propose(manager, {
      p_item: curry,
      p_variant: variant,
      p_field: "price",
      p_value: { amount: 13 },
    })
    await decide(manager, own, "confirmed")
    await decide(manager, own, "withdrawn")
    // A staff temporary unavailability report, confirmed.
    const temp = await propose(staff, {
      p_line: report.lineId,
      p_field: "temporary_unavailability",
      p_value: { state: "temporarily_unavailable", until: null },
    })
    await decide(manager, temp, "confirmed")
    // The manager's one-step statement and a schedule.
    await ok(
      rpc(manager, "menu_set_temporarily_unavailable", {
        p_item: curry,
        p_variant: null,
        p_until: null,
        p_reason: null,
        p_request_key: randomUUID(),
      })
    )
    const schedule = await ok<{ scheduleId: string }>(
      rpc(manager, "menu_availability_schedule_add", {
        p_venue: venue,
        p_schedule: {
          effectiveFrom: psql(
            `select ((now() at time zone 'Europe/London')::date)::text`
          ),
          recurrence: { kind: "weekly", days: ["sun"] },
          windows: [{ start: "12:00", end: "15:00" }],
        },
        p_timezone: null,
        p_knowledge_check_id: null,
        p_supersedes: null,
        p_request_key: randomUUID(),
      })
    )
    const availability = await propose(manager, {
      p_item: pie,
      p_channel: "takeaway",
      p_field: "availability",
      p_value: { state: "scheduled", scheduleId: schedule.scheduleId },
    })
    await decide(manager, availability, "confirmed")

    expect(creditState()).toEqual(before)
    // No B04-b1 write reached a photo or catalogue table.
    expect(
      psql(`select count(*) from public.menu_item_photo_events
        where venue_id = ${literal(venue)} and created_at > now() - interval '1 hour'
          and action <> 'accepted'`)
    ).toBe("0")
  })
})

describe("C-B04-4 (b1): a passed until, job stopped then run twice", () => {
  it("leaves photos, heads, events and counts unchanged and opens exactly one task per line", async () => {
    // An hour ahead, so it is still in the future when the statement is
    // made; every later read and run names an explicit instant past it.
    const until = psql(
      `select to_json(date_trunc('second', now()) + interval '1 hour') #>> '{}'`
    )
    const afterUntil = new Date(Date.parse(until) + 1000).toISOString()
    const line = (
      await propose(manager, {
        p_item: pie,
        p_portion: { label: "Large" },
        p_field: "price",
        p_value: { amount: "15.00" },
      })
    ).lineId
    const set = await ok<{ lines: { lineId: string }[] }>(
      rpc(manager, "menu_set_temporarily_unavailable", {
        p_item: pie,
        p_variant: null,
        p_until: until,
        p_reason: null,
        p_request_key: randomUUID(),
      })
    )
    expect(set.lines.map((l) => l.lineId)).toContain(line)
    const before = creditState()

    // Job stopped: read as of a second past `until`, the line needs checking;
    // nothing else moved.
    const view = await ok<{ availability: { state: string } }>(
      rpc(manager, "menu_trading_history", { p_line: line, p_at: afterUntil })
    )
    expect(view.availability.state).toBe("needs_checking")
    expect(
      psql(
        `select count(*) from public.menu_trading_recheck_tasks where line_id = ${literal(line)}`
      )
    ).toBe("0")
    expect(creditState()).toEqual(before)

    // Run twice as of a minute past `until`, bounded to this suite's venue:
    // one task per line, nothing else moved.
    const runJob = () =>
      psql(`select private.menu_open_rechecks(${literal(until)}::timestamptz + interval '1 minute',
        array[${literal(venue)}]::uuid[])`)
    runJob()
    runJob()
    expect(
      psql(`select string_agg(cause || ':' || state, ',') from public.menu_trading_recheck_tasks
        where line_id = ${literal(line)}`)
    ).toBe("temporary_until_passed:open")
    expect(
      psql(`select count(*) from public.menu_trading_recheck_tasks t
        where t.venue_id = ${literal(venue)}
        group by t.line_id, t.cause, t.due_at, t.use having count(*) > 1`)
    ).toBe("")
    expect(creditState()).toEqual(before)
    expect(before.counts[0]).toBe("1:0")
  })
})
