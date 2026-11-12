// B10-05a: in-app guidance repeats approved copy word for word, adds no new
// claim, stays off by default and is placed only where the switch is read.
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  GUIDANCE_LINES,
  GUIDANCE_SCREENS,
  plainQuote,
  shownGuidance,
} from "@/components/nabalens/guide/screen-guidance"
import { ENTRY_COPY } from "@/components/nabalens/shell/entry-copy"
import { screenGuidance } from "@/lib/config/screen-guidance"
import { switchById } from "@/lib/ops/switches"

const root = join(__dirname, "..", "..")
const read = (file: string) => readFileSync(join(root, file), "utf8")

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("guidance lines", () => {
  it("has unique, ordered IDs", () => {
    expect(GUIDANCE_LINES.map((l) => l.id)).toEqual(
      GUIDANCE_LINES.map((_, i) => `G-${String(i + 1).padStart(2, "0")}`)
    )
  })

  it.each(
    GUIDANCE_LINES.filter((l) => l.source.kind === "quote").map(
      (l) => [l.id, l] as const
    )
  )("%s quotes its source exactly", (_, line) => {
    if (line.source.kind !== "quote") throw new Error("unreachable")
    const file = plainQuote(read(line.source.file))
    expect(file).toContain(plainQuote(line.source.quote))
    expect(line.text).toBe(plainQuote(line.source.quote))
  })

  it("names an existing file for every copy constant", () => {
    for (const line of GUIDANCE_LINES)
      if (line.source.kind === "copy") {
        const [file, name] = line.source.ref.split(" ")
        expect(read(file), line.id).toContain(name.split(".")[0])
      }
  })

  it("adds no claim about ingredients, allergens, policy, credit, targets, review outcomes or publishing", () => {
    const banned =
      /ingredient|allergen|polic|credit|count|target|accept|approv|publish|public|guest-facing/i
    for (const line of GUIDANCE_LINES)
      expect(line.text, line.id).not.toMatch(banned)
  })

  it("holds back the entry audience lines still waiting for owner sign-off", () => {
    const pending = GUIDANCE_LINES.filter(
      (l) => l.wording === "awaiting_sign_off"
    )
    expect(pending.map((l) => l.text).sort()).toEqual(
      [
        ENTRY_COPY.photosAudience,
        ENTRY_COPY.findingAudience,
        ENTRY_COPY.evidenceAudience,
      ].sort()
    )
    for (const screen of GUIDANCE_SCREENS)
      for (const line of shownGuidance(screen))
        expect(line.wording).toBe("shipped")
  })

  it("gives every placed screen at least one approved line", () => {
    for (const screen of GUIDANCE_SCREENS)
      expect(shownGuidance(screen).length, screen).toBeGreaterThan(0)
  })
})

describe("SW-15 screen guidance switch", () => {
  it.each([undefined, "", "true", "ON", "1", "b02"])(
    "is off for %j",
    (value) => {
      if (value === undefined) vi.stubEnv("NABALENS_SCREEN_GUIDANCE", "")
      else vi.stubEnv("NABALENS_SCREEN_GUIDANCE", value)
      expect(screenGuidance()).toBe("off")
    }
  )

  it("is on only for on", () => {
    vi.stubEnv("NABALENS_SCREEN_GUIDANCE", " on ")
    expect(screenGuidance()).toBe("on")
  })

  it("is in the switch catalogue as owner-gated", () => {
    expect(switchById("SW-15")).toMatchObject({
      mechanism: "env_var",
      ownerGated: true,
    })
  })

  it.each([
    ["staff-home", "app/staff/tasks/page.tsx"],
    ["staff-capture", "app/staff/tasks/amenities/[checkId]/page.tsx"],
    ["manager-review", "app/manager/review/page.tsx"],
  ])("%s is placed behind the switch in %s", (screen, file) => {
    const text = read(file)
    expect(text).toMatch(
      new RegExp(
        `screenGuidance\\(\\) === "on" \\? \\(\\s*<ScreenGuide screen="${screen}"`
      )
    )
  })
})
