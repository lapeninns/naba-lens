// B04-02e (docs: b04-design §3 Money, §5.2 #1, §5.7): the price text parser,
// a closed set of accepted forms read as exact decimal text, never floating
// point. Mirrors private.menu_parse_price in
// supabase/migrations/20261110203000_menu_b04b_trading_assertions.sql;
// PRICE_PARSE_FIXTURES run through both sides
// (tests/unit/menus-trading-price.test.ts, tests/security/menus-trading.test.ts).
// Pure.

import {
  PRICE_MAX_MINOR,
  TRADING_CURRENCIES,
  type AmbiguousPriceForm,
  type FixedPrice,
  type TradingCurrency,
} from "./types"

export type PriceParse =
  | { ok: true; amountMinor: number; currency: TradingCurrency }
  | { ok: false; error: "ambiguous_price"; form: AmbiguousPriceForm }
  | { ok: false; error: "invalid_price" }

const INVALID = { ok: false, error: "invalid_price" } as const
const PRICE = "£?[0-9]{1,6}(\\.[0-9]{1,2})?"
const SINGLE = /^£?([0-9]{1,6})(\.([0-9]{1,2}))?$/
const FROM = new RegExp(`^from ${PRICE}$`)
const MULTIPLE = new RegExp(`^${PRICE} ?/ ?${PRICE}$`)

/** private.menu_ascii_lower: only A-Z change, whatever the locale. */
export function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + 32)
  )
}

/**
 * The decimal text of a price input: a string as given; a JSON number by its
 * shortest round-trip text (String(10.5) is "10.5"). The server sends every
 * price to the database as this text, so both sides parse the same characters.
 */
export function priceInputText(input: unknown): string | null {
  if (typeof input === "string") return input
  if (typeof input === "number" && Number.isFinite(input)) return String(input)
  return null
}

/**
 * private.menu_parse_price. Outer U+0020 spaces are removed. Accepted: an
 * optional £, 1 to 6 ASCII digits, optionally a point and 1 or 2 digits, so
 * "10.50", "10.5", 10.5 and "£10.50" are all 1050. "MP", "M/P" and "market
 * price" (market), "from <price>" (from) and "<price> / <price>" (multiple)
 * are ambiguous; anything else (more than two decimals, a sign, a thousands
 * separator, free text, a currency outside the list) is invalid_price.
 */
export function parsePrice(
  input: unknown,
  currency: string | null = "GBP"
): PriceParse {
  const code = currency ?? "GBP"
  if (!(TRADING_CURRENCIES as readonly string[]).includes(code)) return INVALID
  const raw = priceInputText(input)
  if (raw === null) return INVALID
  const text = raw.replace(/^ +| +$/g, "")
  // Length in characters (code points), as SQL length().
  const length = [...text].length
  if (length < 1 || length > 80) return INVALID
  const match = SINGLE.exec(text)
  if (match) {
    const pounds = Number(match[1])
    const fraction = match[3]
    const pence =
      fraction === undefined
        ? 0
        : fraction.length === 1
          ? Number(fraction) * 10
          : Number(fraction)
    const amountMinor = pounds * 100 + pence
    // Six integer digits never exceed PRICE_MAX_MINOR; kept as a guard.
    if (amountMinor > PRICE_MAX_MINOR) return INVALID
    return { ok: true, amountMinor, currency: code as TradingCurrency }
  }
  const lower = asciiLower(text)
  if (lower === "mp" || lower === "m/p" || lower === "market price")
    return { ok: false, error: "ambiguous_price", form: "market" }
  if (FROM.test(lower))
    return { ok: false, error: "ambiguous_price", form: "from" }
  if (MULTIPLE.test(text))
    return { ok: false, error: "ambiguous_price", form: "multiple" }
  return INVALID
}

/** The stored value of an accepted price. */
export function fixedPrice(parse: PriceParse): FixedPrice | null {
  return parse.ok
    ? {
        kind: "fixed",
        amountMinor: parse.amountMinor,
        currency: parse.currency,
      }
    : null
}

/** Pence as pounds text ("10.50"), for display and for the server boundary. */
export function formatMinor(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
    throw new RangeError("amountMinor must be a non-negative safe integer")
  const pounds = Math.floor(amountMinor / 100)
  const pence = amountMinor % 100
  return `${pounds}.${pence < 10 ? "0" : ""}${pence}`
}

/**
 * Shared parser fixtures (§5.7): each runs through parsePrice and
 * private.menu_parse_price with the same expected result. `input` is what a
 * caller sends: a string, or a JSON number (sent to SQL as its jsonb number).
 * Synthetic values only.
 */
export const PRICE_PARSE_FIXTURES: readonly {
  input: string | number
  currency?: string
  expect: PriceParse
}[] = [
  { input: "10.50", expect: { ok: true, amountMinor: 1050, currency: "GBP" } },
  { input: "10.5", expect: { ok: true, amountMinor: 1050, currency: "GBP" } },
  { input: 10.5, expect: { ok: true, amountMinor: 1050, currency: "GBP" } },
  { input: "£10.50", expect: { ok: true, amountMinor: 1050, currency: "GBP" } },
  {
    input: " 10.50 ",
    expect: { ok: true, amountMinor: 1050, currency: "GBP" },
  },
  { input: "10", expect: { ok: true, amountMinor: 1000, currency: "GBP" } },
  { input: 10, expect: { ok: true, amountMinor: 1000, currency: "GBP" } },
  { input: "0", expect: { ok: true, amountMinor: 0, currency: "GBP" } },
  { input: "0.05", expect: { ok: true, amountMinor: 5, currency: "GBP" } },
  { input: "£4.3", expect: { ok: true, amountMinor: 430, currency: "GBP" } },
  {
    input: "999999.99",
    expect: { ok: true, amountMinor: PRICE_MAX_MINOR, currency: "GBP" },
  },
  {
    input: "10.50",
    currency: "GBP",
    expect: { ok: true, amountMinor: 1050, currency: "GBP" },
  },
  { input: "10.505", expect: INVALID },
  { input: 10.505, expect: INVALID },
  { input: "-1", expect: INVALID },
  { input: -1, expect: INVALID },
  { input: "+1", expect: INVALID },
  { input: "1000000", expect: INVALID },
  { input: "1,000.00", expect: INVALID },
  { input: "10.", expect: INVALID },
  { input: ".50", expect: INVALID },
  { input: "£ 10.50", expect: INVALID },
  { input: "10.50 GBP", expect: INVALID },
  { input: "$10.50", expect: INVALID },
  { input: "", expect: INVALID },
  { input: "   ", expect: INVALID },
  { input: "ten pounds", expect: INVALID },
  // Arabic-Indic and full-width digits are not ASCII digits.
  { input: "١٠.٥٠", expect: INVALID },
  { input: "１０.５０", expect: INVALID },
  { input: "10.50", currency: "EUR", expect: INVALID },
  { input: "10.50", currency: "gbp", expect: INVALID },
  {
    input: "MP",
    expect: { ok: false, error: "ambiguous_price", form: "market" },
  },
  {
    input: "m/p",
    expect: { ok: false, error: "ambiguous_price", form: "market" },
  },
  {
    input: "Market Price",
    expect: { ok: false, error: "ambiguous_price", form: "market" },
  },
  {
    input: "from 9.95",
    expect: { ok: false, error: "ambiguous_price", form: "from" },
  },
  {
    input: "From £9.95",
    expect: { ok: false, error: "ambiguous_price", form: "from" },
  },
  {
    input: "4.30 / 2.40",
    expect: { ok: false, error: "ambiguous_price", form: "multiple" },
  },
  {
    input: "£4.30/£2.40",
    expect: { ok: false, error: "ambiguous_price", form: "multiple" },
  },
  { input: "from 9.955", expect: INVALID },
  { input: "MARKET PRİCE", expect: INVALID },
]
