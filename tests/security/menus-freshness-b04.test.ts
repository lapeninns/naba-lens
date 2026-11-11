// B04-b2 database contract (b04-design A1-2, A1-3, A1-4, A1-6, A1-8, §19.2
// S3): freshness bindings to B03-e policies, the freshness of confirmed
// prices and availability (age from stated_on), freshness recheck tasks with
// the job stopped and run twice, the binding preview, and C-B04-4 (time
// never moves a photo). One psql session and one transaction that always
// rolls back, on the fixture world of
// tests/fixtures/menus/recheck-public-withdrawal/menu.sql; the SQL lives in
// menus-freshness-fixtures.ts.
import { execFileSync } from "node:child_process"

import { beforeAll, describe, expect, it } from "vitest"

import { psql } from "./coverage-fixtures"
import { checkpoints, freshnessScript } from "./menus-freshness-fixtures"

const CREDIT_MD5 = "b78b9daeb8ede1fec0b7224d99348659"

type Entry = {
  use: string
  state: string
  basis: string | null
  basisDate: string | null
  nextCheckDue: string | null
  policyId: string | null
}
type Read = Record<string, unknown> & {
  status?: string
  state?: string
  reason?: string
  detail?: string
  freshness?: Entry[]
  staleValue?: Record<string, unknown>
}

function localDbUrl(): string {
  const url = process.env.NABALENS_TEST_DB_URL
  if (!url || !/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error("Run through `pnpm test:security <workdir>` (local DB).")
  }
  return url
}

let out: Record<string, unknown>
const read = (label: string) => out[label] as Read
const entry = (r: Read, use: string) => r.freshness!.find((e) => e.use === use)!

beforeAll(() => {
  out = checkpoints(
    execFileSync(
      "psql",
      [localDbUrl(), "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
      {
        encoding: "utf8",
        input: freshnessScript(),
        maxBuffer: 16 * 1024 * 1024,
      }
    )
      .split("\n")
      .filter((line) => line.length > 0)
  )
})

describe("freshness of confirmed trading values (A1-2, A1-6)", () => {
  it("keeps S2's read unchanged when nothing is bound", () => {
    expect(read("UNBOUND")).toMatchObject({ status: "available" })
    expect(read("UNBOUND")).not.toHaveProperty("freshness")
  })

  it("ages a price from stated_on, not the decision time: due_soon before local midnight plus max age, stale / expired one second after", () => {
    const due = out.A_DUE as string
    const before = read("A_BEFORE_DUE")
    expect(before).toMatchObject({
      status: "available",
      statedOn: expect.any(String),
    })
    expect(entry(before, "internal")).toMatchObject({
      state: "due_soon",
      basis: "stated_on",
      basisDate: before.statedOn,
      nextCheckDue: due,
    })
    expect(entry(before, "public").state).toBe("current")
    const after = read("A_AFTER_DUE")
    expect(after).toMatchObject({
      status: "unavailable",
      reason: "stale",
      detail: "expired",
      nextCheckDue: due,
    })
    // The value stays visible to managers.
    expect(after.staleValue).toMatchObject({
      status: "available",
      value: { kind: "fixed", amountMinor: 1200, currency: "GBP" },
    })
    expect(entry(read("B_NOW"), "internal").state).toBe("current")
  })

  it("shows a stale price and availability without the value to staff, with it to managers", () => {
    expect(read("C_MANAGER")).toMatchObject({
      reason: "stale",
      detail: "expired",
    })
    expect(read("C_MANAGER").staleValue).toMatchObject({
      value: { amountMinor: 950 },
    })
    expect(read("C_STAFF")).toMatchObject({
      reason: "stale",
      detail: "expired",
    })
    expect(read("C_STAFF")).not.toHaveProperty("staleValue")
    expect(read("D_MANAGER")).toMatchObject({
      state: "unknown",
      reason: "stale",
      detail: "expired",
    })
    expect(read("D_MANAGER").staleValue).toMatchObject({ source: "always" })
    expect(read("D_STAFF")).not.toHaveProperty("staleValue")
  })

  it("reads basis_missing for a bound value with no stated_on, and unrated again once unbound", () => {
    const missing = out.BASIS_MISSING as Entry[]
    expect(missing.map((e) => [e.use, e.state])).toEqual([
      ["internal", "basis_missing"],
      ["public", "basis_missing"],
    ])
    expect((out.UNBIND as Record<string, unknown>).policyId).toBeNull()
    const unbound = read("A_UNBOUND")
    expect(unbound.status).toBe("available")
    expect(entry(unbound, "internal").state).toBe("unrated")
  })
})

describe("freshness bindings and the preview (A1-3)", () => {
  it("binds only stated_on policies that suit the field, never retroactively, admin only, append-only", () => {
    expect(out.BIND_INTERNAL).toMatchObject({
      field: "price",
      use: "internal",
      policyVersion: 1,
    })
    expect(out.BIND_AVAILABILITY).toMatchObject({ field: "availability" })
    expect(out.BIND_OBSERVED).toBe("freshness_policy_unsuitable")
    expect(out.BIND_EVENT).toBe("freshness_policy_unsuitable")
    expect(out.BIND_WRONG_USE).toBe("freshness_policy_unsuitable")
    expect(out.BIND_UNKNOWN).toBe("freshness_policy_not_found")
    expect(out.BIND_RETRO).toBe("invalid_effective_from")
    expect(out.BIND_FIELD).toBe("invalid_freshness_binding")
    expect(out.BIND_MANAGER).toBe("not_active_admin")
    expect(out.BINDING_UPDATE).toBe("audit_append_only")
  })

  it("previews how a policy would read the live confirmed values, for admins only", () => {
    expect(out.PREVIEW).toMatchObject({
      field: "price",
      counts: {
        internal: { current: 1, due_soon: 1, expired: 1, basis_missing: 0 },
      },
    })
    expect(out.PREVIEW_MANAGER).toBe("not_active_admin")
    expect(out.PREVIEW_UNKNOWN).toBe("freshness_policy_not_found")
  })
})

describe("freshness rechecks and C-B04-4 (A1-4, A1-8)", () => {
  it("opens nothing with the job stopped; two runs open one task per field, cause and use; a later run adds expired", () => {
    expect(out.TASKS_STOPPED).toEqual([])
    expect(out.OPENED_1).toBe(3)
    expect(out.OPENED_2).toBe(0)
    expect(out.TASKS_NOW).toEqual([
      "A:price:due_soon:internal:open",
      "C:price:expired:internal:open",
      "D:availability:expired:internal:open",
    ])
    expect(out.OPENED_DUE).toBe(1)
    // Once due, A's due_soon task gives way to its expired one (as B03).
    expect(out.TASKS_DUE).toEqual([
      "A:price:due_soon:internal:cancelled",
      "A:price:expired:internal:open",
      "C:price:expired:internal:open",
      "D:availability:expired:internal:open",
    ])
  })

  it("keeps a task open after a withdrawal and closes it only on a re-statement", () => {
    expect(out.OPENED_AFTER_WITHDRAW).toBe(0)
    expect(out.TASKS_AFTER_WITHDRAW).toEqual(out.TASKS_DUE)
    expect(out.TASKS_AFTER_WITHDRAW).toContain(
      "A:price:due_soon:internal:cancelled"
    )
    expect(out.TASKS_AFTER_RESTATE).toContain("C:price:expired:internal:done")
    expect(out.TASKS_AFTER_RESTATE).toContain("A:price:expired:internal:open")
    expect(out.TASKS_AFTER_RESTATE).toContain(
      "A:price:due_soon:internal:cancelled"
    )
  })

  it("C-B04-4: expiry and two job runs leave photos, photo events, counts and the credit function unchanged", () => {
    expect(out.INVARIANTS_AFTER).toEqual(out.INVARIANTS_BEFORE)
    expect((out.INVARIANTS_BEFORE as { creditMd5: string }).creditMd5).toBe(
      CREDIT_MD5
    )
  })

  it("keeps the new reads STABLE definers and the commands to signed-in users only", () => {
    for (const fn of [
      "public.menu_freshness_preview(uuid,text,jsonb)",
      "private.menu_trading_freshness(uuid,text,jsonb,timestamptz)",
      "private.menu_freshness_policy_at(uuid,text,text,timestamptz)",
      "private.menu_trading_read_price(public.menu_trading_lines,text,timestamptz)",
      "private.menu_trading_read_availability(public.menu_trading_lines,text,timestamptz)",
    ])
      expect(
        psql(`select provolatile::text || ':' || prosecdef || ':' || array_to_string(proconfig, ',')
          from pg_proc where oid = '${fn}'::regprocedure`),
        fn
      ).toBe('s:true:search_path=""')
    for (const fn of [
      "public.menu_freshness_binding_add(uuid,text,text,text,integer,timestamptz)",
      "public.menu_freshness_preview(uuid,text,jsonb)",
    ])
      expect(
        psql(`select has_function_privilege('anon', '${fn}', 'execute') || ':' ||
          has_function_privilege('authenticated', '${fn}', 'execute') || ':' ||
          has_function_privilege('service_role', '${fn}', 'execute')`),
        fn
      ).toBe("false:true:false")
    expect(
      psql(
        `select has_table_privilege('authenticated', 'public.menu_freshness_bindings', 'select')`
      )
    ).toBe("f")
  })
})
