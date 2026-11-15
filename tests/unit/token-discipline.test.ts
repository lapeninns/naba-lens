import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

import {
  arbitraryValues,
  darkVariants,
  deprecatedNames,
  handDrawnFocus,
  rawColours,
  RULES,
  scanSource,
  shadcnSlots,
  stripComments,
  type Rule,
} from "./support/token-discipline"
import {
  ALLOW,
  DEV_ALLOW,
  MAX_ALLOWED,
  MAX_ALLOWED_DEV,
  type AllowEntry,
} from "./token-discipline.allow"

const root = join(__dirname, "..", "..")
const DEV = "app/(dev)/"

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const key = (file: string, rule: Rule, match: string) =>
  `${rule} | ${file} | ${match}`

/*
 * Application code speaks one vocabulary: the tokens and recipes in
 * app/globals.css (docs/design-system/strategy.md, section 5). Anything else
 * is a value that will not follow the theme, or a second name for something
 * that has one. Exceptions are listed, with a reason, in
 * token-discipline.allow.ts.
 */
describe("token discipline", () => {
  const allowed = [...ALLOW, ...DEV_ALLOW]
  const allowedKeys = new Set(
    allowed.map((entry) => key(entry.file, entry.rule, entry.match))
  )

  const found = new Set<string>()
  const offenders: Record<Rule, string[]> = {
    "raw-colour": [],
    "shadcn-slot": [],
    "deprecated-name": [],
    "arbitrary-value": [],
    "dark-variant": [],
    "hand-focus": [],
  }
  let scanned = 0
  for (const path of ["app", "components", "hooks", "lib"].flatMap((dir) =>
    sourceFiles(join(root, dir))
  )) {
    scanned += 1
    const file = relative(root, path)
    for (const { rule, match, line } of scanSource(
      readFileSync(path, "utf8")
    )) {
      const id = key(file, rule, match)
      found.add(id)
      if (!allowedKeys.has(id)) offenders[rule].push(`${file}:${line} ${match}`)
    }
  }

  it("scans the application source", () => {
    expect(scanned).toBeGreaterThan(100)
  })

  const SAYS: Record<Rule, string> = {
    "raw-colour": "has no raw colour: every colour is a token",
    "shadcn-slot": "uses no shadcn slot utility",
    "deprecated-name": "uses no name that Batch 1 removed",
    "arbitrary-value":
      "writes no size, radius, shadow, layer or duration by hand",
    "dark-variant": "has no dark: variant: a token carries both themes",
    "hand-focus": "draws focus only with the focus-ring utilities",
  }

  it.each(RULES.map((rule) => ({ rule, says: SAYS[rule] })))(
    "$rule: $says",
    ({ rule }) => {
      expect(offenders[rule]).toEqual([])
    }
  )

  describe("allow-list", () => {
    it("has no entry that matches nothing, so it can only shrink", () => {
      const stale = allowed
        .filter((entry) => !found.has(key(entry.file, entry.rule, entry.match)))
        .map((entry) => key(entry.file, entry.rule, entry.match))
      expect(stale).toEqual([])
    })

    it("does not grow unless its count is raised on purpose", () => {
      // Equal, not "at most": deleting an entry takes the count down with
      // it, so the room it left cannot be spent on a new exception.
      expect(ALLOW.length).toBe(MAX_ALLOWED)
      expect(DEV_ALLOW.length).toBe(MAX_ALLOWED_DEV)
    })

    it("lists each exception once", () => {
      expect(allowedKeys.size).toBe(allowed.length)
    })

    it("keeps the dev fixture section to app/(dev)", () => {
      expect(DEV_ALLOW.filter((entry) => !entry.file.startsWith(DEV))).toEqual(
        []
      )
      expect(ALLOW.filter((entry) => entry.file.startsWith(DEV))).toEqual([])
    })

    it("gives every entry a known rule and a reason in a full sentence", () => {
      const weak = allowed.filter((entry) => !isJustified(entry))
      expect(weak).toEqual([])
    })
  })
})

function isJustified(entry: AllowEntry): boolean {
  const reason = entry.reason.trim()
  return (
    RULES.includes(entry.rule) &&
    /^[A-Z]/.test(reason) &&
    /[.!?]$/.test(reason) &&
    reason.split(/\s+/).length >= 8
  )
}

/*
 * The matchers, tried on strings. Each rule is shown something it must
 * catch and something close to it that it must leave alone.
 */
describe("token discipline matchers", () => {
  it("raw colour: hex, colour functions, palette and white/black", () => {
    expect(rawColours('fill="#fff"')).toEqual(["#fff"])
    expect(rawColours("color: #0063BA;")).toEqual(["#0063BA"])
    expect(rawColours("#11223344")).toEqual(["#11223344"])
    expect(rawColours("oklch(0.5 0.16 252)")).toEqual(["oklch()"])
    expect(rawColours("rgba(0,0,0,0.2) hsl(1 2% 3%)")).toEqual([
      "rgba()",
      "hsl()",
    ])
    expect(rawColours("hover:bg-red-500 text-slate-50/80")).toEqual([
      "bg-red-500",
      "text-slate-50/80",
    ])
    expect(rawColours("bg-white dark:text-black/60 border-b-white")).toEqual([
      "bg-white",
      "text-black/60",
      "border-b-white",
    ])
    // Not colours: a character reference, an id, a longer word, tokens.
    expect(rawColours("&#8217; issue#123 #header #abcdefg")).toEqual([])
    expect(
      rawColours("bg-surface text-ink bg-ok-bg whitespace-nowrap")
    ).toEqual([])
    expect(rawColours("border-red text-blue-light")).toEqual([])
  })

  it("shadcn slot utilities", () => {
    expect(
      shadcnSlots(
        "bg-background text-foreground bg-primary bg-muted text-muted-foreground"
      )
    ).toEqual([
      "bg-background",
      "text-foreground",
      "bg-primary",
      "bg-muted",
      "text-muted-foreground",
    ])
    expect(
      shadcnSlots("border-border border-input ring-ring/50 hover:bg-card")
    ).toEqual(["border-border", "border-input", "ring-ring/50", "bg-card"])
    expect(
      shadcnSlots("bg-popover bg-destructive bg-secondary bg-sidebar-accent")
    ).toEqual([
      "bg-popover",
      "bg-destructive",
      "bg-secondary",
      "bg-sidebar-accent",
    ])
    // The brand accent and the card elevation are public names.
    expect(shadcnSlots("bg-accent text-on-accent shadow-card border")).toEqual(
      []
    )
    expect(shadcnSlots("text-input-label bg-card-header")).toEqual([])
  })

  it("shadcn slots reached by their variable", () => {
    expect(
      shadcnSlots(
        "bg-[var(--primary)] text-(--muted-foreground) hover:border-(--border)"
      )
    ).toEqual([
      "text-(--muted-foreground)",
      "border-(--border)",
      "var(--primary)",
    ])
    expect(
      shadcnSlots("color: var(--background); fill: var( --ring , red)")
    ).toEqual(["var(--background)", "var(--ring)"])
    // Public tokens, a runtime variable, and longer names that only start
    // like a slot.
    expect(
      shadcnSlots(
        "var(--accent) var(--surface) w-(--anchor-width) var(--border-width) bg-(--card-tint) var(--ring-offset)"
      )
    ).toEqual([])
  })

  it("deprecated names", () => {
    expect(
      deprecatedNames("bg-paper bg-panel bg-well text-fg text-fg-muted")
    ).toEqual(["bg-paper", "bg-panel", "bg-well", "text-fg", "text-fg-muted"])
    expect(
      deprecatedNames(
        "hover:bg-fill-hover border-line-control border-border-strong text-positive bg-viewer text-on-viewer"
      )
    ).toEqual([
      "bg-fill-hover",
      "border-line-control",
      "border-border-strong",
      "text-positive",
      "bg-viewer",
      "text-on-viewer",
    ])
    expect(
      deprecatedNames(
        "text-body-touch md:text-body-sm text-meta-strong text-sm text-2xl"
      )
    ).toEqual([
      "text-body-touch",
      "text-body-sm",
      "text-meta-strong",
      "text-sm",
      "text-2xl",
    ])
    expect(
      deprecatedNames(
        "rounded-panel rounded-t-touch rounded-chip rounded-print"
      )
    ).toEqual([
      "rounded-panel",
      "rounded-t-touch",
      "rounded-chip",
      "rounded-print",
    ])
    expect(
      deprecatedNames(
        "gap-(--gutter) max-w-(--size-feed) duration-(--duration-quick) h-[var(--size-tabbar)]"
      )
    ).toEqual([
      "gap-(--gutter)",
      "max-w-(--size-feed)",
      "duration-(--duration-quick)",
      "var(--size-tabbar)",
    ])
    // Tailwind's stock radius and shadow steps: no token stands behind them.
    expect(
      deprecatedNames(
        "rounded-lg md:rounded-md rounded-t-2xl rounded-xs shadow-sm hover:shadow-lg shadow-2xs"
      )
    ).toEqual([
      "rounded-lg",
      "rounded-md",
      "rounded-t-2xl",
      "rounded-xs",
      "shadow-sm",
      "shadow-lg",
      "shadow-2xs",
    ])
    expect(
      deprecatedNames(
        "rounded-card rounded-t-sheet rounded-none rounded-round shadow-card shadow-none shadow-float"
      )
    ).toEqual([])
    // The names that replaced them.
    expect(
      deprecatedNames(
        "bg-canvas bg-surface text-ink text-info-fg bg-info-bg text-body text-meta rounded-card gap-gutter max-w-feed duration-quick text-warn-fg"
      )
    ).toEqual([])
  })

  it("arbitrary values", () => {
    expect(
      arbitraryValues("text-[1.5rem] group-data-[size=lg]/avatar:text-[30px]")
    ).toEqual(["text-[1.5rem]", "text-[30px]"])
    expect(arbitraryValues("rounded-[6px] before:rounded-b-[3px]")).toEqual([
      "rounded-[6px]",
      "rounded-b-[3px]",
    ])
    expect(
      arbitraryValues(
        "shadow-[0_1px_0_var(--line)] inset-shadow-[4px_0_0_0_var(--ok-fg)] ring-[1.5px]"
      )
    ).toEqual([
      "shadow-[0_1px_0_var(--line)]",
      "inset-shadow-[4px_0_0_0_var(--ok-fg)]",
      "ring-[1.5px]",
    ])
    expect(arbitraryValues("z-20 z-[60] -z-10 md:z-50")).toEqual([
      "z-20",
      "z-[60]",
      "-z-10",
      "z-50",
    ])
    expect(arbitraryValues("duration-150 duration-[240ms]")).toEqual([
      "duration-150",
      "duration-[240ms]",
    ])
    // Named steps, z-0, an inherited radius, and arbitrary values on
    // properties that have no token scale.
    expect(
      arbitraryValues(
        "text-body rounded-card shadow-card z-nav z-0 duration-quick rounded-[inherit] max-h-[92dvh] grid-cols-[minmax(0,1fr)] ring-2"
      )
    ).toEqual([])
  })

  it("dark variants", () => {
    expect(darkVariants("bg-surface dark:bg-surface-2")).toEqual([
      "dark:bg-surface-2",
    ])
    expect(
      darkVariants('"dark:hover:text-ink md:dark:[&_a]:underline"')
    ).toEqual(["dark:hover:text-ink", "dark:[&_a]:underline"])
    // An object key, a longer word.
    expect(darkVariants('{ light: "a", dark: "b" }')).toEqual([])
    expect(darkVariants("is-dark:flex")).toEqual([])
  })

  it("focus drawn by hand", () => {
    expect(
      handDrawnFocus(
        '"focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-solid"'
      )
    ).toEqual(["focus-visible:outline-focus"])
    expect(
      handDrawnFocus(
        "has-[a:focus-visible]:outline-focus has-focus-visible:outline-focus peer-focus-visible:outline-focus"
      )
    ).toEqual([
      "has-[a:focus-visible]:outline-focus",
      "has-focus-visible:outline-focus",
      "peer-focus-visible:outline-focus",
    ])
    expect(
      handDrawnFocus(
        "focus-visible:ring-2 focus-visible:ring-focus focus:ring-[3px] focus-within:ring-0 focus-visible:ring"
      )
    ).toEqual([
      "focus-visible:ring-2",
      "focus-visible:ring-focus",
      "focus:ring-[3px]",
      "focus-within:ring-0",
      "focus-visible:ring",
    ])
    // No colour named: the base layer's focus colour still draws these.
    expect(
      handDrawnFocus(
        "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2"
      )
    ).toEqual(["focus-visible:outline-2", "focus-visible:outline-solid"])
    expect(
      handDrawnFocus(
        "has-[a:focus-visible]:outline-[3px] focus-within:outline focus:outline-dashed"
      )
    ).toEqual([
      "has-[a:focus-visible]:outline-[3px]",
      "focus-within:outline",
      "focus:outline-dashed",
    ])
    // Focus switched off on a variant.
    expect(
      handDrawnFocus(
        "focus:outline-none focus-visible:outline-hidden focus:outline-0"
      )
    ).toEqual([
      "focus:outline-none",
      "focus-visible:outline-hidden",
      "focus:outline-0",
    ])
    // The utilities themselves, an offset moved for a clipped row, a plain
    // outline-none under a focus-ring, a selection ring outside focus, and
    // the base outline colour.
    expect(
      handDrawnFocus(
        "focus-ring focus-ring-inset focus-ring-within focus-visible:-outline-offset-3 focus-visible:outline-offset-2 outline-none outline-2 ring-selected outline-focus focus-visible:bg-surface-2"
      )
    ).toEqual([])
  })

  it("ignores comments and keeps line numbers", () => {
    const source = [
      "// bg-white in a comment",
      'const url = "https://example.com" // text-[1px]',
      "/* #fff",
      "   dark:bg-ink */",
      "const a = 'z-20'",
      "{/* rounded-[9px] */}",
      "don't // z-30",
      "const b = `bg-black`",
    ].join("\n")
    expect(stripComments(source).split("\n")).toHaveLength(8)
    expect(scanSource(source)).toEqual([
      { rule: "arbitrary-value", match: "z-20", line: 5 },
      // An apostrophe in JSX text reads as an open string, so the rest of
      // that line is scanned: the scan errs towards reporting.
      { rule: "arbitrary-value", match: "z-30", line: 7 },
      { rule: "raw-colour", match: "bg-black", line: 8 },
    ])
  })
})
