/*
 * Matchers for tests/unit/token-discipline.test.ts. They live here, away from
 * the test, so each one can be tried on a plain string: a guard that has
 * never been seen to fail proves nothing.
 *
 * Every matcher takes one line of source with its comments removed and
 * returns what it found, written as the allow-list writes it.
 */

export const RULES = [
  "raw-colour",
  "shadcn-slot",
  "deprecated-name",
  "arbitrary-value",
  "dark-variant",
  "hand-focus",
] as const

export type Rule = (typeof RULES)[number]

export type Finding = { rule: Rule; match: string }

// A utility name starts where no longer name could contain it, and ends the
// same way. A variant (`md:`, `aria-invalid:`) may come before it.
const START = "(?<![\\w-])"
const END = "(?![\\w-])"

// Every prefix that takes a colour.
const COLOUR_PREFIX =
  "(?:bg|text|border(?:-[xytrblse])?|ring|ring-offset|outline|divide|fill|stroke|accent|shadow|inset-shadow|inset-ring|decoration|from|to|via|caret|placeholder)"

function all(line: string, pattern: RegExp): string[] {
  return [...line.matchAll(pattern)].map((match) => match[0])
}

function utility(body: string): RegExp {
  return new RegExp(`${START}${body}${END}`, "g")
}

/* ---------------------------------------------------------------- colour */

// 3, 4, 6 or 8 hex digits. `&#123;` is a character reference and `id#123`
// is not a colour, so neither may come before the hash.
const HEX = new RegExp(
  "(?<![\\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\\w-])",
  "g"
)
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g
const PALETTE = utility(
  `${COLOUR_PREFIX}-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)(?:/\\d+)?`
)
const WHITE_BLACK = utility(`${COLOUR_PREFIX}-(?:white|black)(?:/\\d+)?`)

export function rawColours(line: string): string[] {
  return [
    ...all(line, HEX),
    // Reported without the bracket, so one entry covers every literal of
    // that kind in a file.
    ...all(line, COLOUR_FUNCTION).map((match) => `${match})`),
    ...all(line, PALETTE),
    ...all(line, WHITE_BLACK),
  ]
}

/* ------------------------------------------------------- shadcn slot names */

// The slots are private custom properties in app/globals.css and have no
// utilities, so each of these would draw nothing. `accent` is not listed:
// here it is the brand colour and a public token.
const SLOT_NAME =
  "(?:background|foreground|card|popover|primary|secondary|muted|destructive|accent-foreground|(?:card|popover|primary|secondary|muted|destructive)-foreground|border|input|ring|sidebar(?:-[a-z-]+)?|chart-\\d)"
const SLOT = utility(`${COLOUR_PREFIX}-${SLOT_NAME}(?:/\\d+)?`)
// The same slot reached by its variable: `text-(--muted-foreground)`,
// `bg-[var(--primary)]`, `var(--border)` in a style. These do resolve, which
// is how a second vocabulary would come back unseen.
const SLOT_SHORTHAND = new RegExp(`[\\w-]+-\\(--${SLOT_NAME}\\)`, "g")
const SLOT_VARIABLE = new RegExp(`var\\(\\s*--${SLOT_NAME}\\s*(?=[,)])`, "g")

export function shadcnSlots(line: string): string[] {
  return [
    // shadow-card is the card elevation, not the `card` slot as a colour.
    ...all(line, SLOT).filter((match) => !/^shadow-card$/.test(match)),
    ...all(line, SLOT_SHORTHAND),
    // Reported closed and without a fallback, so one entry covers both.
    ...all(line, SLOT_VARIABLE).map((match) => `${match.replace(/\s/g, "")})`),
  ]
}

/* ------------------------------------------------------- deprecated names */

// The vocabulary Batch 1 removed (docs/design-system/strategy.md, section 5).
const OLD_COLOURS = [
  "bg",
  "paper",
  "panel",
  "well",
  "fill-hover",
  "fill-press",
  "line-control",
  "border-strong",
  "fg",
  "fg-muted",
  "positive",
  "positive-fill",
  "positive-soft",
  "positive-surface",
  "on-positive-fill",
  "attention",
  "attention-soft",
  "negative",
  "negative-fill",
  "negative-soft",
  "negative-surface",
  "on-negative-fill",
  "warning",
  "warning-surface",
  "info",
  "info-surface",
  "viewer",
  "on-viewer",
  "on-viewer-muted",
  "tile-badge",
  "on-tile-badge",
]
const OLD_COLOUR = utility(
  `${COLOUR_PREFIX}-(?:${OLD_COLOURS.join("|")})(?:/\\d+)?`
)
// Old type roles, and Tailwind's own size scale: app/globals.css lifts
// text-xs, text-sm and text-base to the 17px floor as a guard and says not to
// use them; the larger steps have a named role.
const OLD_TYPE = utility(
  "text-(?:[a-z-]+-touch|body-sm|meta-strong|card-title|page-title-compact|count-sm|xs|sm|base|lg|xl|[2-9]xl)"
)
const OLD_RADIUS = utility(
  "rounded(?:-(?:[trblse]|[tb][lr]|[se][se]))?-(?:panel|touch|chip|print)"
)
const OLD_OTHER = utility(
  "(?:shadow-(?:overlay|sheet)|font-heading|wdth-(?:88|92))"
)
// Tailwind's own radius and shadow steps. Batch 1 deleted the overrides that
// tied them to the tokens, so `rounded-lg` and `shadow-sm` now draw
// Tailwind's values, which are not in the system.
const STOCK_RADIUS = utility(
  "rounded(?:-(?:[trblse]|[tb][lr]|[se][se]))?-(?:xs|sm|md|lg|xl|[2-4]xl)"
)
const STOCK_SHADOW = utility("shadow-(?:2xs|xs|sm|md|lg|xl|2xl)")
// `gap-(--gutter)`, `max-w-(--size-feed)`, `duration-(--duration-quick)`,
// `ease-(--ease-out)`: the token now has a utility of its own.
const OLD_VARIABLE_FORM =
  /[\w-]+-\(--(?:gutter|page-gutter|size-[\w-]+|duration-[\w-]+|ease-[\w-]+)\)/g
const OLD_VARIABLE =
  /var\(--(?:size-[\w-]+|duration-[\w-]+|border-strong|gutter|page-gutter)\)/g

export function deprecatedNames(line: string): string[] {
  return [
    ...all(line, OLD_COLOUR),
    ...all(line, OLD_TYPE),
    ...all(line, OLD_RADIUS),
    ...all(line, OLD_OTHER),
    ...all(line, STOCK_RADIUS),
    ...all(line, STOCK_SHADOW),
    ...all(line, OLD_VARIABLE_FORM),
    ...all(line, OLD_VARIABLE),
  ]
}

/* ------------------------------------------------------- arbitrary values */

const VALUE = "\\[[^\\]\\s\"'`]*\\]"
const ARBITRARY = [
  // A font size or a colour written out in place of a role.
  utility(`text-${VALUE}`),
  utility(`rounded(?:-(?:[trblse]|[tb][lr]|[se][se]))?-${VALUE}`),
  utility(`(?:inset-|drop-|text-)?shadow-${VALUE}`),
  // An edge drawn by hand on the ring layer.
  utility(`(?:inset-)?ring-${VALUE}`),
  // Layers have names; z-0 is the only number that says what it means.
  utility(`-?z-(?:${VALUE}|[1-9]\\d*)`),
  utility(`duration-(?:${VALUE}|\\d+)`),
]

export function arbitraryValues(line: string): string[] {
  return (
    ARBITRARY.flatMap((pattern) => all(line, pattern))
      // `rounded-[inherit]` names no value: it follows the parent's radius.
      .filter((match) => !match.endsWith("-[inherit]"))
  )
}

/* ---------------------------------------------------------- dark variants */

// A token carries both themes, so a component never asks which one is on.
// The lookahead keeps an object key (`dark: "…"`) out of it.
const DARK = new RegExp(`${START}(?:not-)?dark:(?=[\\w[!*@-])[^\\s"'\`]*`, "g")

export function darkVariants(line: string): string[] {
  return all(line, DARK)
}

/* ------------------------------------------------------ focus drawn by hand */

const QUOTES = /^["'`({,]+|["'`)},;]+$/g
// `focus-visible:`, `has-focus-visible:`, `has-[a:focus-visible]:`,
// `group-focus-within/row:` and the like, anywhere in the variant chain.
const FOCUS_VARIANT = /focus(?:-visible|-within)?(?:\/[\w-]+)?\]?\)?:/
const FOCUS_COLOUR = /:outline-focus(?:\/\d+)?$/
const FOCUS_RING_LAYER = /:(?:inset-)?ring(?:-[\w[\]/.()-]+)?$/
// A width or a style: `outline`, `outline-2`, `outline-[3px]`,
// `outline-solid`. The base layer gives every outline the focus colour, so
// either one draws a focus mark without naming a colour.
const FOCUS_OUTLINE_DRAWN =
  /:outline(?:-(?:\d+|\[[^\]]*\]|solid|dashed|dotted|double))?$/
// Focus switched off. On a variant it also wins over focus-ring, which a
// plain `outline-none` does not.
const FOCUS_OUTLINE_OFF = /:outline-(?:none|hidden|0)$/

// The focus-ring utilities (app/globals.css) are the one way to draw focus:
// an outline spelt out here, or a ring on the box-shadow layer, drifts from
// them and vanishes in forced colours.
export function handDrawnFocus(line: string): string[] {
  const focusChunks = line
    .split(/\s+/)
    .map((chunk) => chunk.replace(QUOTES, ""))
    .filter((chunk) => FOCUS_VARIANT.test(chunk))
  // An outline spelt out with its colour is reported once, by the colour.
  // Its width and style are reported only where no colour stands for them.
  const named = focusChunks.some((chunk) => FOCUS_COLOUR.test(chunk))
  return focusChunks.filter(
    (chunk) =>
      FOCUS_COLOUR.test(chunk) ||
      FOCUS_RING_LAYER.test(chunk) ||
      FOCUS_OUTLINE_OFF.test(chunk) ||
      (!named && FOCUS_OUTLINE_DRAWN.test(chunk))
  )
}

/* ------------------------------------------------------------------ scan */

const MATCHERS: Record<Rule, (line: string) => string[]> = {
  "raw-colour": rawColours,
  "shadcn-slot": shadcnSlots,
  "deprecated-name": deprecatedNames,
  "arbitrary-value": arbitraryValues,
  "dark-variant": darkVariants,
  "hand-focus": handDrawnFocus,
}

export function findingsInLine(line: string): Finding[] {
  return RULES.flatMap((rule) =>
    MATCHERS[rule](line).map((match) => ({ rule, match }))
  )
}

/*
 * Blank out comments and keep every line break, so line numbers still point
 * at the source. Comments explain old names and quote hex values; they are
 * not code. Strings are kept whole: a URL's `//` does not start a comment.
 */
export function stripComments(source: string): string {
  let out = ""
  let state: "code" | "line" | "block" | "'" | '"' | "`" = "code"
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    const next = source[i + 1]
    if (state === "line") {
      if (char === "\n") {
        state = "code"
        out += char
      }
    } else if (state === "block") {
      if (char === "*" && next === "/") {
        state = "code"
        i += 1
      } else if (char === "\n") out += char
    } else if (state === "code") {
      if (char === "/" && next === "/") state = "line"
      else if (char === "/" && next === "*") {
        state = "block"
        i += 1
      } else {
        if (char === "'" || char === '"' || char === "`") state = char
        out += char
      }
    } else {
      out += char
      if (char === "\\" && next !== undefined && next !== "\n") {
        out += next
        i += 1
      } else if (char === state) state = "code"
      // An apostrophe in JSX text opens a string that never closes; a quoted
      // string cannot span lines, so the line break ends it.
      else if (char === "\n" && state !== "`") state = "code"
    }
  }
  return out
}

export type Offender = Finding & { line: number }

export function scanSource(source: string): Offender[] {
  return stripComments(source)
    .split("\n")
    .flatMap((line, i) =>
      findingsInLine(line).map((finding) => ({ ...finding, line: i + 1 }))
    )
}
