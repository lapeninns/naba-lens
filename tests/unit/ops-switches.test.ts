// B10-02b switch catalogue: every switch exists in source, and the switches
// that are plain functions of configuration behave as the catalogue says
// (a unit-level exercise of RB-07, RB-17 and RB-18; no database).
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { readerConfigFromEnv } from "@/app/api/knowledge/_reader/credentials"
import { contributionEntry } from "@/lib/config/contribution-entry"
import { homeLayout } from "@/lib/config/home-layout"
import { managerTriageSurface } from "@/lib/config/manager-triage"
import { myContributionsSurface } from "@/lib/config/my-contributions"
import { RUNBOOKS } from "@/lib/ops/runbooks"
import { ONE_WAY_SETTINGS, SWITCHES } from "@/lib/ops/switches"

const root = join(__dirname, "..", "..")
const VENUE_A = "00000000-0000-4000-8000-0000000000a1"
const VENUE_B = "00000000-0000-4000-8000-0000000000b2"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("switch catalogue", () => {
  it("has unique, ordered IDs and every field filled", () => {
    expect(SWITCHES.map((s) => s.id)).toEqual(
      SWITCHES.map((_, i) => `SW-${String(i + 1).padStart(2, "0")}`)
    )
    for (const s of SWITCHES)
      for (const text of [
        s.title,
        s.howToTurnOff,
        s.stops,
        s.keepsRunning,
        s.restore,
      ])
        expect(text.trim(), s.id).not.toBe("")
  })

  it.each(SWITCHES.map((s) => [s.id, s] as const))(
    "%s exists in its source file",
    (_, s) => {
      expect(readFileSync(join(root, s.source.file), "utf8")).toContain(
        s.source.contains
      )
    }
  )

  it("marks every configuration, schedule or SQL switch as owner-gated (X1)", () => {
    for (const s of SWITCHES)
      expect(s.ownerGated, s.id).toBe(
        s.mechanism === "env_var" ||
          s.mechanism === "schedule" ||
          s.mechanism === "reviewed_sql"
      )
  })

  it("covers each of the four scheduled jobs in vercel.json", () => {
    const crons = (
      JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
        crons: { path: string }[]
      }
    ).crons.map((c) => c.path)
    const jobSwitches = SWITCHES.filter((s) => s.scope === "job")
    expect(jobSwitches).toHaveLength(crons.length)
    for (const path of crons)
      expect(
        jobSwitches.some((s) => s.source.contains.includes(`"${path}"`)),
        path
      ).toBe(true)
  })

  it("never lets a runbook use a one-way setting as a switch", () => {
    for (const setting of ONE_WAY_SETTINGS) {
      expect(readFileSync(join(root, setting.source.file), "utf8")).toContain(
        setting.source.contains
      )
      for (const rb of RUNBOOKS)
        expect(rb.narrowestSwitch).not.toContain("venue_amenity_settings")
    }
  })
})

describe("SW-02 internal reader", () => {
  it.each([undefined, "", "false", "TRUE", "1"])(
    "is off when KNOWLEDGE_READER_ENABLED is %j",
    (value) => {
      expect(
        readerConfigFromEnv({
          KNOWLEDGE_READER_ENABLED: value,
          KNOWLEDGE_READER_CONSUMERS: "[]",
        })
      ).toEqual({ ok: false, reason: "disabled" })
    }
  )

  it("fails closed on a malformed registry when switched on", () => {
    expect(
      readerConfigFromEnv({
        KNOWLEDGE_READER_ENABLED: "true",
        KNOWLEDGE_READER_CONSUMERS: "{",
      })
    ).toEqual({ ok: false, reason: "invalid_registry" })
  })
})

describe("SW-04 and SW-05: per-venue B02 switches", () => {
  const cases = [
    [
      "SW-04 Home layout",
      homeLayout,
      "NABALENS_HOME_LAYOUT",
      "NABALENS_HOME_LAYOUT_B01_VENUES",
    ],
    [
      "SW-05 Add entry",
      contributionEntry,
      "NABALENS_CONTRIBUTION_ENTRY",
      "NABALENS_CONTRIBUTION_ENTRY_B01_VENUES",
    ],
  ] as const

  it.each(cases)("%s defaults to b02", (_, read, all, list) => {
    vi.stubEnv(all, "")
    vi.stubEnv(list, "")
    expect(read(VENUE_A)).toBe("b02")
  })

  it.each(cases)(
    "%s keeps only the listed venue on b01",
    (_, read, all, list) => {
      vi.stubEnv(all, "")
      vi.stubEnv(list, ` ${VENUE_A} ,`)
      expect(read(VENUE_A)).toBe("b01")
      expect(read(VENUE_B)).toBe("b02")
    }
  )

  it.each(cases)("%s rolls everyone back with b01", (_, read, all, list) => {
    vi.stubEnv(all, "b01")
    vi.stubEnv(list, "")
    expect(read(VENUE_A)).toBe("b01")
    expect(read(VENUE_B)).toBe("b01")
  })

  it.each(cases)(
    "%s ignores an unknown value (default b02)",
    (_, read, all, list) => {
      vi.stubEnv(all, "off")
      vi.stubEnv(list, "")
      expect(read(VENUE_A)).toBe("b02")
    }
  )
})

describe("SW-06 and SW-07: global B02 switches", () => {
  const cases = [
    ["SW-06 Manager triage", managerTriageSurface, "NABALENS_MANAGER_TRIAGE"],
    [
      "SW-07 My contributions",
      myContributionsSurface,
      "NABALENS_MY_CONTRIBUTIONS",
    ],
  ] as const

  it.each(cases)("%s: default b02, b01 when set", (_, read, env) => {
    vi.stubEnv(env, "")
    expect(read()).toBe("b02")
    vi.stubEnv(env, " b01 ")
    expect(read()).toBe("b01")
    vi.stubEnv(env, "off")
    expect(read()).toBe("b02")
  })
})
