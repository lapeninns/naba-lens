import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

import { cn } from "@/lib/utils"

import {
  blocks,
  contrastOf,
  contrastRatio,
  declaredOn,
  isOpaque,
  definedProperties,
  listIn,
  luminance,
  oklchToLinearSrgb,
  parseOklch,
  referencedProperties,
  resolve,
  stripCssComments,
  themeKeys,
  toHex,
  utilityNames,
} from "./support/token-integrity"

const root = join(__dirname, "..", "..")
const SHEET = "app/globals.css"

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : []
  })
}

/*
 * Values that are the same in both themes on purpose, so :root declares them
 * and .dark does not. The camera and the photo viewer are dark whatever the
 * theme (docs/design-system/DESIGN.md §3.1). Sizes, type, radius, layers and
 * motion are not here: they sit in @theme, not on :root.
 */
const THEME_INVARIANT = ["--stage", "--on-stage", "--on-stage-muted"]

/*
 * Custom properties that app/globals.css does not declare because something
 * else sets them while the page runs. A name here that nothing reads fails
 * the test, so the list cannot go stale.
 */
const RUNTIME = [
  // Set inline by the component that reads it.
  "--ah", // components/nabalens/profile-avatar.tsx: the avatar's hue
  "--gap", // components/ui/toggle-group.tsx: the gap between toggles
  // Set on <html> by next/font (app/layout.tsx).
  "--font-fraunces",
  "--font-atkinson-next",
  "--font-atkinson-mono",
  // Set by Base UI on a popup's positioner.
  "--anchor-width",
  "--available-width",
  "--available-height",
  "--transform-origin",
]
// Tailwind's own working variables, set by its utilities.
const RUNTIME_PREFIXES = ["--tw-"]

/*
 * Tailwind's text-xs, text-sm and text-base are redefined in @theme only to
 * lift them to the 17px floor. They are a guard, not roles, so the class
 * merger already knows them and lib/utils.ts does not list them.
 */
const STOCK_TEXT_GUARDS = ["xs", "sm", "base"]

/*
 * Each @theme namespace and the list in lib/utils.ts that registers its
 * names with the class merger. A name in one and not the other means cn()
 * will drop or duplicate a class without any error.
 */
const REGISTERED: Array<{ prefix: string; list: string; skip?: string[] }> = [
  { prefix: "--text-", list: "TYPE_ROLES", skip: STOCK_TEXT_GUARDS },
  { prefix: "--radius-", list: "RADII" },
  { prefix: "--shadow-", list: "ELEVATION" },
  { prefix: "--spacing-", list: "SPACING" },
  { prefix: "--container-", list: "CONTAINERS" },
  { prefix: "--z-index-", list: "LAYERS" },
  { prefix: "--transition-duration-", list: "DURATIONS" },
]

/*
 * type-* recipes that set no size: family, weight, tracking and case only.
 * They are not in TYPE_RECIPES, because the merger would then drop the
 * text-* role that gives them their size.
 */
const LETTERING_ONLY = ["stamp"]

type Theme = "light" | "dark"
type Pair = { fg: string; bg: string; min: number }

const TEXT = 4.5 // WCAG 1.4.3: text against what it sits on
const BOUNDARY = 3 // WCAG 1.4.11: the edge or fill that marks a control

const text = (fg: string, ...on: string[]): Pair[] =>
  on.map((bg) => ({ fg, bg, min: TEXT }))
const boundary = (fg: string, ...on: string[]): Pair[] =>
  on.map((bg) => ({ fg, bg, min: BOUNDARY }))

// Checked in both themes.
const PAIRS: Pair[] = [
  ...text("ink", "canvas", "surface", "surface-2"),
  ...text("ink-muted", "canvas", "surface", "surface-2"),
  ...text("ink-subtle", "canvas", "surface", "surface-2"),
  ...text("on-accent", "accent", "accent-hover"),
  ...text("accent-text", "surface", "accent-soft"),
  ...text("on-select", "select"),
  ...text("ok-fg", "ok-bg", "surface"),
  ...text("on-ok", "ok-fg"),
  ...text("warn-fg", "warn-bg", "surface"),
  ...text("info-fg", "info-bg", "surface"),
  ...text("on-stage", "stage"),
  ...text("on-stage-muted", "stage"),
  ...boundary("edge-strong", "surface", "surface-2"),
  // The dashed edge of an empty slot sits on paper and on a card.
  ...boundary("edge-strong", "canvas"),
  ...boundary("focus", "canvas", "surface", "surface-2"),
  ...boundary("select", "surface"),
]

/*
 * Controls marked by a fill and an edge together: the boundary is whichever
 * of the two stands out more from what is behind. A see-through edge draws
 * nothing and does not count. The primary button's fill carries it in
 * light; in dark the fill is 2.7:1 on a card and the edge takes over.
 */
const EDGED = [
  { fill: "accent", edge: "accent-edge", on: ["canvas", "surface"] },
]

/*
 * Pairs that miss their minimum today. This is a record, not a lower bar:
 * each entry holds the measured ratio and the test fails if it gets worse.
 * It also fails once the pair passes, so the entry is deleted then. Do not
 * add a pair here to make a new token pass.
 */
const KNOWN_BELOW: Array<Pair & { theme: Theme; ratio: number; why: string }> =
  []

const css = readFileSync(join(root, SHEET), "utf8")
const light = declaredOn(css, ":root")
const dark = declaredOn(css, ".dark")
// A dark subtree inherits what .dark does not redeclare.
const themes: Record<Theme, Map<string, string>> = {
  light,
  dark: new Map([...light, ...dark]),
}

describe("token integrity", () => {
  it("reads both themes from the sheet", () => {
    expect(light.size).toBeGreaterThan(30)
    expect(dark.size).toBeGreaterThan(30)
  })

  it("gives every :root value a dark value, or lists it as the same in both", () => {
    const lightOnly = [...light.keys()].filter((name) => !dark.has(name))
    expect(lightOnly.sort()).toEqual([...THEME_INVARIANT].sort())
  })

  it("declares nothing on .dark that :root does not have", () => {
    expect([...dark.keys()].filter((name) => !light.has(name))).toEqual([])
  })

  describe("custom properties in use", () => {
    const defined = definedProperties(css)
    const isRuntime = (name: string) =>
      RUNTIME.includes(name) ||
      RUNTIME_PREFIXES.some((prefix) => name.startsWith(prefix))

    const used = new Set<string>()
    const missing: string[] = []
    for (const path of ["app", "components", "hooks", "lib"].flatMap((dir) =>
      sourceFiles(join(root, dir))
    )) {
      const source = readFileSync(path, "utf8")
      const lines = (
        path.endsWith(".css") ? stripCssComments(source) : source
      ).split("\n")
      lines.forEach((line, i) => {
        for (const name of referencedProperties(line)) {
          used.add(name)
          if (!defined.has(name) && !isRuntime(name))
            missing.push(`${relative(root, path)}:${i + 1} ${name}`)
        }
      })
    }

    it("are all defined in the sheet or set at runtime", () => {
      expect(missing).toEqual([])
      // The scan is doing something.
      expect(used.size).toBeGreaterThan(20)
    })

    it("keeps the runtime list to names that are read", () => {
      expect(RUNTIME.filter((name) => !used.has(name))).toEqual([])
      // A name the sheet declares is not a runtime name.
      expect(RUNTIME.filter((name) => defined.has(name))).toEqual([])
    })
  })

  describe("class merger registration (lib/utils.ts)", () => {
    const utils = readFileSync(join(root, "lib/utils.ts"), "utf8")
    const keys = themeKeys(css)

    it.each(REGISTERED)(
      "$list holds exactly the $prefix* names in @theme",
      ({ prefix, list, skip = [] }) => {
        const inTheme = keys
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length))
          // `--text-body--line-height` belongs to `--text-body`.
          .filter((name) => !name.includes("--") && !skip.includes(name))
        expect(inTheme.length).toBeGreaterThan(0)
        expect(listIn(utils, list).sort()).toEqual(inTheme.sort())
      }
    )

    it("TYPE_RECIPES holds exactly the type-* utilities that set a size", () => {
      const recipes = utilityNames(css)
        .filter((name) => name.startsWith("type-"))
        .map((name) => name.slice("type-".length))
        .filter((name) => !LETTERING_ONLY.includes(name))
      expect(listIn(utils, "TYPE_RECIPES").sort()).toEqual(recipes.sort())
      // A lettering recipe is still a recipe in the sheet.
      expect(
        LETTERING_ONLY.filter(
          (name) => !utilityNames(css).includes(`type-${name}`)
        )
      ).toEqual([])
    })

    it("lets a size recipe replace a text role, and the other way round", () => {
      expect(cn("text-body", "type-section-title")).toBe("type-section-title")
      expect(cn("type-section-title", "text-body")).toBe("text-body")
    })

    it("keeps the chip's size beside the stamp's lettering", () => {
      // The Complete stamp (components/nabalens/status-chip.tsx) adds
      // type-stamp to a chip that already holds text-chip.
      expect(cn("text-chip", "type-stamp")).toBe("text-chip type-stamp")
      expect(cn("type-stamp", "text-chip")).toBe("type-stamp text-chip")
    })
  })

  describe("contrast", () => {
    const known = (theme: Theme, pair: Pair) =>
      KNOWN_BELOW.find(
        (entry) =>
          entry.theme === theme && entry.fg === pair.fg && entry.bg === pair.bg
      )

    it.each(["light", "dark"] as const)(
      "%s theme: every pair meets its minimum",
      (theme) => {
        const failures = PAIRS.filter((pair) => !known(theme, pair))
          .map((pair) => ({
            pair,
            ratio: contrastOf(themes[theme], pair.fg, pair.bg),
          }))
          .filter(({ pair, ratio }) => ratio < pair.min)
          .map(
            ({ pair, ratio }) =>
              `${pair.fg} on ${pair.bg}: ${ratio.toFixed(2)}, needs ${pair.min}`
          )
        expect(failures).toEqual([])
      }
    )

    it.each(["light", "dark"] as const)(
      "%s theme: a filled control's fill or edge meets the boundary minimum",
      (theme) => {
        const tokens = themes[theme]
        const failures = EDGED.flatMap(({ fill, edge, on }) =>
          on
            .map((bg) => ({
              bg,
              ratio: Math.max(
                contrastOf(tokens, fill, bg),
                isOpaque(tokens, edge) ? contrastOf(tokens, edge, bg) : 0
              ),
            }))
            .filter(({ ratio }) => ratio < BOUNDARY)
            .map(
              ({ bg, ratio }) =>
                `${fill} or ${edge} on ${bg}: ${ratio.toFixed(2)}, needs ${BOUNDARY}`
            )
        )
        expect(failures).toEqual([])
      }
    )

    it("known shortfalls do not get worse, and leave the list once fixed", () => {
      const problems: string[] = []
      for (const entry of KNOWN_BELOW) {
        const name = `${entry.theme}: ${entry.fg} on ${entry.bg}`
        if (!PAIRS.some((pair) => pair.fg === entry.fg && pair.bg === entry.bg))
          problems.push(`${name} is not a pair in the table`)
        const ratio = contrastOf(themes[entry.theme], entry.fg, entry.bg)
        if (ratio < entry.ratio - 0.01)
          problems.push(
            `${name} fell to ${ratio.toFixed(2)} from ${entry.ratio}`
          )
        if (ratio >= entry.min)
          problems.push(
            `${name} now passes at ${ratio.toFixed(2)}: delete the entry`
          )
        if (entry.why.trim().split(/\s+/).length < 8)
          problems.push(`${name} needs a reason`)
      }
      expect(problems).toEqual([])
    })
  })
})

/*
 * The readers and the colour maths, tried on values with known answers.
 */
describe("token integrity helpers", () => {
  const sample = `
    @import "x"; /* --ghost: 1; */
    :root { --a: oklch(1 0 0); --b: var(--a); --only-light: 1px; }
    .dark { --a: oklch(0 0 0); /* --b: gone; */ }
    :root,
    .dark { --slot: var(--a); }
    @theme inline { --color-a: var(--a); --text-body: 1rem; --text-body--line-height: 1.5; }
    @theme { --radius-card: 0.75rem; }
    @utility type-count { @apply font-display; }
    @layer base { body { color: var(--missing); width: calc(var(--tw-x) * 2); } }
  `

  it("reads the declarations of each theme and skips comments", () => {
    expect([...declaredOn(sample, ":root").keys()]).toEqual([
      "--a",
      "--b",
      "--only-light",
      "--slot",
    ])
    expect([...declaredOn(sample, ".dark").keys()]).toEqual(["--a", "--slot"])
    expect(blocks("@import 'x'; :root { --a: 1; }")[0].selectors).toEqual([
      ":root",
    ])
  })

  it("reads @theme keys, utilities, definitions and references", () => {
    expect(themeKeys(sample)).toEqual([
      "--color-a",
      "--text-body",
      "--text-body--line-height",
      "--radius-card",
    ])
    expect(utilityNames(sample)).toEqual(["type-count"])
    const defined = definedProperties(sample)
    expect(defined.has("--only-light")).toBe(true)
    expect(defined.has("--ghost")).toBe(false)
    expect(defined.has("--missing")).toBe(false)
    // An inline theme key is never emitted; a plain one is.
    expect(defined.has("--color-a")).toBe(false)
    expect(defined.has("--text-body")).toBe(false)
    expect(defined.has("--radius-card")).toBe(true)
    expect(
      referencedProperties(
        'className="w-(--anchor-width) h-[var(--spacing-tabbar)] bg-[oklch(0.4_0.06_var(--ah,250))] [--set:1px]"'
      )
    ).toEqual(["--anchor-width", "--spacing-tabbar", "--ah"])
  })

  it("reads a list from the class merger's source", () => {
    const utils =
      'const RADII = ["control", "card"]\nconst LAYERS = [\n  "nav",\n]'
    expect(listIn(utils, "RADII")).toEqual(["control", "card"])
    expect(listIn(utils, "LAYERS")).toEqual(["nav"])
    expect(() => listIn(utils, "MISSING")).toThrow()
  })

  it("parses oklch() and follows aliases", () => {
    expect(parseOklch("oklch(0.5 0.16 252)")).toEqual({
      l: 0.5,
      c: 0.16,
      h: 252,
      alpha: 1,
    })
    expect(parseOklch("oklch(50% 0.1 20 / 0.5)").alpha).toBe(0.5)
    expect(() => parseOklch("#fff")).toThrow()
    const tokens = declaredOn(sample, ":root")
    expect(resolve(tokens, "--slot")).toBe("oklch(1 0 0)")
    expect(() => resolve(tokens, "--nope")).toThrow()
  })

  it("converts OKLCH to sRGB as a browser does", () => {
    const hex = (value: string) => toHex(oklchToLinearSrgb(parseOklch(value)))
    expect(hex("oklch(1 0 0)")).toBe("#ffffff")
    expect(hex("oklch(0 0 0)")).toBe("#000000")
    // Reference values: sRGB red and blue in OKLCH.
    expect(hex("oklch(0.62796 0.25768 29.234)")).toBe("#ff0000")
    expect(hex("oklch(0.45201 0.31321 264.052)")).toBe("#0000ff")
    // Out of gamut: clipped, not wrapped.
    expect(hex("oklch(0.7 0.4 145)")).toMatch(/^#00[0-9a-f]{2}00$/)
  })

  it("measures WCAG contrast", () => {
    const white = luminance(oklchToLinearSrgb(parseOklch("oklch(1 0 0)")))
    const black = luminance(oklchToLinearSrgb(parseOklch("oklch(0 0 0)")))
    expect(contrastRatio(white, black)).toBeCloseTo(21, 1)
    expect(contrastRatio(black, white)).toBeCloseTo(21, 1)
    expect(contrastRatio(white, white)).toBe(1)
    // #767676 on white is the well-known 4.54:1.
    const grey = oklchToLinearSrgb(parseOklch("oklch(0.5659 0 0)"))
    expect(toHex(grey)).toBe("#767676")
    expect(contrastRatio(luminance(grey), white)).toBeCloseTo(4.54, 2)
  })

  it("fails a weak pair and refuses a see-through colour", () => {
    const tokens = new Map([
      ["--fg", "oklch(0.7 0 0)"],
      ["--bg", "oklch(1 0 0)"],
      ["--alias", "var(--fg)"],
      ["--glass", "oklch(0.2 0 0 / 0.5)"],
    ])
    expect(contrastOf(tokens, "fg", "bg")).toBeLessThan(3)
    expect(contrastOf(tokens, "alias", "bg")).toBe(
      contrastOf(tokens, "fg", "bg")
    )
    expect(() => contrastOf(tokens, "glass", "bg")).toThrow(/not opaque/)
    expect(isOpaque(tokens, "glass")).toBe(false)
    expect(isOpaque(tokens, "alias")).toBe(true)
  })
})
