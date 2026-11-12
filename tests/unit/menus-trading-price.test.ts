// B04-02e (b04-design §3 Money, §5.2 #1, §5.7): the price parser on the
// fixtures the database also runs (tests/security/menus-trading.test.ts), the
// stored value schema, and the server boundary: prices travel as text, bad
// input never reaches the database, and RPC failures map to plain messages.
// Mocked RPC client; synthetic values only.
import { describe, expect, it, vi } from "vitest"

import {
  PRICE_PARSE_FIXTURES,
  asciiLower,
  fixedPrice,
  formatMinor,
  parsePrice,
  priceInputText,
} from "@/lib/menus/trading/price"
import {
  PRICE_MAX_MINOR,
  tradingValueProblem,
  untilText,
} from "@/lib/menus/trading/types"
import type { MediaActor } from "@/lib/server/media/types"
import {
  decideTradingAssertion,
  proposeTradingValue,
  tradingRpcFailure,
} from "@/lib/server/menus/trading"

vi.mock("server-only", () => ({}))

describe("parsePrice (shared fixtures, §5.7)", () => {
  it.each(
    PRICE_PARSE_FIXTURES.map(
      (f) =>
        [
          `${JSON.stringify(f.input)}${f.currency ? ` ${f.currency}` : ""}`,
          f,
        ] as const
    )
  )("%s", (_, f) => {
    expect(parsePrice(f.input, f.currency ?? "GBP")).toEqual(f.expect)
  })

  it("accepts the four approved forms of ten pounds fifty as 1,050 pence", () => {
    for (const input of ["10.50", "10.5", 10.5, "£10.50"])
      expect(parsePrice(input)).toEqual({
        ok: true,
        amountMinor: 1050,
        currency: "GBP",
      })
  })

  it("never guesses an ambiguous price", () => {
    expect(parsePrice("MP")).toMatchObject({
      ok: false,
      error: "ambiguous_price",
    })
    expect(parsePrice("from 9.95")).toMatchObject({
      ok: false,
      form: "from",
    })
    expect(parsePrice("4.30 / 2.40")).toMatchObject({
      ok: false,
      form: "multiple",
    })
  })

  it("refuses excess precision, negatives and other currencies", () => {
    for (const input of ["10.505", "-1", -0.5, "10.999"])
      expect(parsePrice(input)).toEqual({ ok: false, error: "invalid_price" })
    expect(parsePrice("10.50", "USD")).toEqual({
      ok: false,
      error: "invalid_price",
    })
  })

  it("reads a JSON number by its shortest decimal text, never as a float sum", () => {
    expect(priceInputText(10.5)).toBe("10.5")
    expect(priceInputText(0.1 + 0.2)).toBe("0.30000000000000004")
    expect(parsePrice(0.1 + 0.2)).toEqual({ ok: false, error: "invalid_price" })
    expect(parsePrice(1e21)).toEqual({ ok: false, error: "invalid_price" })
    expect(parsePrice(Number.NaN)).toEqual({
      ok: false,
      error: "invalid_price",
    })
    expect(parsePrice(Infinity)).toEqual({ ok: false, error: "invalid_price" })
    expect(parsePrice(null)).toEqual({ ok: false, error: "invalid_price" })
    expect(parsePrice({ amount: 1 })).toEqual({
      ok: false,
      error: "invalid_price",
    })
  })

  it("keeps the whole supported range exact", () => {
    expect(PRICE_MAX_MINOR).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER)
    expect(parsePrice("999999.99")).toMatchObject({
      amountMinor: PRICE_MAX_MINOR,
    })
    expect(parsePrice("1000000")).toEqual({ ok: false, error: "invalid_price" })
    for (let pence = 0; pence < 100; pence++) {
      const text = `123456.${pence < 10 ? "0" : ""}${pence}`
      expect(parsePrice(text)).toMatchObject({ amountMinor: 12345600 + pence })
      expect(formatMinor(12345600 + pence)).toBe(text)
    }
  })

  it("lower-cases ASCII letters only", () => {
    expect(asciiLower("MP Market İ")).toBe("mp market İ")
  })

  it("builds the stored value of an accepted price only", () => {
    expect(fixedPrice(parsePrice("£4.30"))).toEqual({
      kind: "fixed",
      amountMinor: 430,
      currency: "GBP",
    })
    expect(fixedPrice(parsePrice("MP"))).toBeNull()
    expect(() => formatMinor(-1)).toThrow(RangeError)
    expect(() => formatMinor(1.5)).toThrow(RangeError)
  })
})

describe("tradingValueProblem (the stored value schema, §5.3)", () => {
  const SCHEDULE = "22222222-2222-4222-8222-222222222222"
  it.each([
    ["price", { kind: "fixed", amountMinor: 1050, currency: "GBP" }, null],
    ["price", { kind: "fixed", amountMinor: 0, currency: "GBP" }, null],
    [
      "price",
      { kind: "fixed", amountMinor: PRICE_MAX_MINOR, currency: "GBP" },
      null,
    ],
    [
      "price",
      { kind: "fixed", amountMinor: PRICE_MAX_MINOR + 1, currency: "GBP" },
      "amount",
    ],
    ["price", { kind: "fixed", amountMinor: -1, currency: "GBP" }, "amount"],
    ["price", { kind: "fixed", amountMinor: 10.5, currency: "GBP" }, "amount"],
    [
      "price",
      { kind: "fixed", amountMinor: "1050", currency: "GBP" },
      "amount",
    ],
    [
      "price",
      { kind: "fixed", amountMinor: 1050, currency: "EUR" },
      "currency",
    ],
    ["price", { kind: "fixed", amountMinor: 1050 }, "keys"],
    [
      "price",
      { kind: "fixed", amountMinor: 1050, currency: "GBP", note: "x" },
      "keys",
    ],
    ["price", { kind: "ambiguous", form: "from" }, null],
    ["price", { kind: "ambiguous", form: "guess" }, "form"],
    ["price", { kind: "from", amountMinor: 995, currency: "GBP" }, "kind"],
    ["price", "10.50", "not_an_object"],
    ["availability", { state: "always" }, null],
    ["availability", { state: "not_offered" }, null],
    ["availability", { state: "scheduled", scheduleId: SCHEDULE }, null],
    ["availability", { state: "scheduled", scheduleId: "nope" }, "schedule"],
    ["availability", { state: "scheduled" }, "keys"],
    ["availability", { state: "sometimes" }, "state"],
    [
      "temporary_unavailability",
      { state: "temporarily_unavailable", until: "2026-11-10T18:00:00Z" },
      null,
    ],
    [
      "temporary_unavailability",
      { state: "temporarily_unavailable", until: null },
      null,
    ],
    [
      "temporary_unavailability",
      { state: "temporarily_unavailable", until: "2026-11-10T18:00:00.000Z" },
      "until",
    ],
    ["temporary_unavailability", { state: "temporarily_unavailable" }, "keys"],
    ["temporary_unavailability", { state: "back_in_service" }, null],
  ] as const)("%s %j -> %s", (field, value, problem) => {
    expect(tradingValueProblem(field, value)).toBe(problem)
  })

  it("writes an until instant as UTC whole seconds", () => {
    expect(untilText("2026-11-10T18:00:00.999+01:00")).toBe(
      "2026-11-10T17:00:00Z"
    )
    expect(
      tradingValueProblem("temporary_unavailability", {
        state: "temporarily_unavailable",
        until: untilText(Date.UTC(2026, 10, 10, 18)),
      })
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Server boundary
// ---------------------------------------------------------------------------

function actorWith(
  handler: (fn: string, args: Record<string, unknown>) => object
) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    const out = handler(fn, args) as { data?: unknown; error?: unknown }
    return { data: out.data ?? null, error: out.error ?? null }
  })
  const db = { rpc }
  return {
    actor: {
      db,
      service: db,
      profile: { id: "p", role: "staff", active: true },
    } as unknown as MediaActor,
    rpc,
  }
}

const KEY = "11111111-1111-4111-8111-111111111111"
const ITEM = "33333333-3333-4333-8333-333333333333"
const LINE = "55555555-5555-4555-8555-555555555555"
const ASSERTION = "66666666-6666-4666-8666-666666666666"

describe("proposeTradingValue and decideTradingAssertion (server boundary)", () => {
  it("sends a price as its decimal text and returns the confirmed value separately (L4)", async () => {
    const current = {
      status: "unavailable",
      reason: "unknown",
      detail: "not_recorded",
    }
    const { actor, rpc } = actorWith(() => ({
      data: {
        assertionId: ASSERTION,
        lineId: LINE,
        lineRevision: 2,
        field: "price",
        state: "proposed",
        value: { kind: "fixed", amountMinor: 1050, currency: "GBP" },
        current,
        replayed: false,
      },
    }))
    const out = await proposeTradingValue(actor, {
      target: { itemId: ITEM, variantId: null, portion: null, channel: "all" },
      proposal: { field: "price", amount: 10.5 },
      requestKey: KEY,
    })
    expect(out).toMatchObject({ ok: true, state: "proposed", current })
    expect(rpc).toHaveBeenCalledWith(
      "menu_trading_propose",
      expect.objectContaining({
        p_item: ITEM,
        p_line: null,
        p_field: "price",
        p_value: { amount: "10.5", currency: "GBP" },
        p_source: null,
      })
    )
  })

  it("refuses ambiguous and over-precise prices before the database", async () => {
    const { actor, rpc } = actorWith(() => ({}))
    for (const amount of ["MP", "from 9.95", "4.30 / 2.40", "10.505", "-1"]) {
      const out = await proposeTradingValue(actor, {
        target: { lineId: LINE },
        proposal: { field: "price", amount },
        requestKey: KEY,
      })
      expect(out).toMatchObject({ ok: false, status: 400 })
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it("checks the portion, the dates and the request key before the database", async () => {
    const { actor, rpc } = actorWith(() => ({}))
    const base = {
      proposal: { field: "price", amount: "4.30" } as const,
      requestKey: KEY,
    }
    expect(
      await proposeTradingValue(actor, {
        ...base,
        target: {
          itemId: ITEM,
          variantId: null,
          portion: { label: "Pint", quantity: 568 },
          channel: "all",
        },
      })
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      await proposeTradingValue(actor, {
        ...base,
        target: { lineId: LINE },
        effectiveFrom: "2026-02-30",
      })
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      await proposeTradingValue(actor, {
        ...base,
        target: { lineId: LINE },
        requestKey: "x",
      })
    ).toMatchObject({ ok: false, status: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("passes a source mapping through for the database to parse and keep", async () => {
    const { actor, rpc } = actorWith(() => ({
      error: { message: "source_mapping_admin_only", code: "42501" },
    }))
    const out = await proposeTradingValue(actor, {
      target: { lineId: LINE },
      proposal: { field: "price", amount: "" },
      source: { snapshotId: ASSERTION, locator: "w#Pie", rawText: "from 9.95" },
      requestKey: KEY,
    })
    expect(out).toEqual({
      ok: false,
      status: 403,
      message: "Only an admin can propose a price from a menu source.",
    })
    expect(rpc).toHaveBeenCalledWith(
      "menu_trading_propose",
      expect.objectContaining({
        p_value: null,
        p_source: expect.objectContaining({ rawText: "from 9.95" }),
      })
    )
  })

  it("allows stated_on only on a confirmation", async () => {
    const { actor, rpc } = actorWith(() => ({}))
    expect(
      await decideTradingAssertion(actor, {
        assertionId: ASSERTION,
        expectedLineRevision: 3,
        decision: "declined",
        statedOn: "2026-11-01",
        requestKey: KEY,
      })
    ).toMatchObject({ ok: false, status: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("returns the decision and the line's value after it", async () => {
    const current = {
      status: "available",
      assertionId: ASSERTION,
      value: { kind: "fixed", amountMinor: 430, currency: "GBP" },
    }
    const { actor, rpc } = actorWith(() => ({
      data: {
        decisionId: KEY,
        assertionId: ASSERTION,
        lineId: LINE,
        lineRevision: 4,
        decision: "confirmed",
        statedOn: "2026-11-10",
        statedOnSource: "form_default",
        current,
        replayed: true,
      },
    }))
    const out = await decideTradingAssertion(actor, {
      assertionId: ASSERTION,
      expectedLineRevision: 3,
      decision: "confirmed",
      requestKey: KEY,
    })
    expect(out).toMatchObject({
      ok: true,
      lineRevision: 4,
      statedOnSource: "form_default",
      current,
      replayed: true,
    })
    expect(rpc).toHaveBeenCalledWith("menu_trading_decide", {
      p_assertion: ASSERTION,
      p_expected_line_revision: 3,
      p_decision: "confirmed",
      p_reason: null,
      p_stated_on: null,
      p_request_key: KEY,
    })
  })
})

describe("tradingRpcFailure", () => {
  it.each([
    [
      {
        message: "menu_trading_conflict",
        code: "40001",
        details: '{"revision":7}',
      },
      409,
      "now revision 7",
    ],
    [
      { message: "menu_trading_conflict", code: "40001" },
      409,
      "changed elsewhere",
    ],
    [
      { message: "invalid_price", code: "22023", details: '{"form":"from"}' },
      400,
      "cannot be confirmed",
    ],
    [{ message: "not_venue_manager", code: "42501" }, 403, "manager"],
    [{ message: "not_venue_member", code: "42501" }, 403, "own venue"],
    [{ message: "staff_field_not_allowed", code: "42501" }, 403, "Staff"],
    [
      { message: "menu_trading_proposal_outdated", code: "P0001" },
      409,
      "Propose the change again",
    ],
    [
      { message: "menu_item_not_on_active_menu", code: "P0001" },
      409,
      "active menu",
    ],
    [
      { message: "menu_trading_assertion_not_found", code: "P0002" },
      404,
      "proposal",
    ],
    [
      { message: "menu_source_price_scope_unverified", code: "P0001" },
      409,
      "not this option or portion",
    ],
    [{ message: "idempotency_key_reused", code: "22023" }, 400, "Reload"],
    [
      { message: "freshness_policy_unsuitable", code: "P0001" },
      409,
      "stated date",
    ],
    [
      { message: "freshness_field_not_supported", code: "P0001" },
      409,
      "prices and availability only",
    ],
    [{ message: "invalid_effective_from", code: "22023" }, 400, "from now on"],
    [{ message: "not_active_admin", code: "42501" }, 403, "admin"],
    [{ message: "something_else", code: "40001" }, 409, "changed elsewhere"],
  ] as const)("%j", (error, status, text) => {
    const out = tradingRpcFailure(error, "test")
    expect(out.status).toBe(status)
    expect(out.message).toContain(text)
  })

  it("logs and hides an unexpected failure", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(
      tradingRpcFailure({ message: "boom", code: "XX000" }, "test")
    ).toMatchObject({
      status: 503,
    })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
