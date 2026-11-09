import { describe, expect, it, vi } from "vitest"

import { sectionFocusRank } from "@/components/nabalens/labels/catalogue-search"
import { toWorkProfile } from "@/lib/auth/profile"
import {
  homePrompt,
  isWorkArea,
  isWorkRoleKey,
  suggestRoleFromJobTitle,
  WORK_AREA_OPTIONS,
  WORK_AREAS,
  WORK_ROLE_KEYS,
  WORK_ROLE_OPTIONS,
  workFocus,
  workRoleLabel,
} from "@/lib/config/work-roles"
import {
  parseWorkProfileInput,
  saveWorkProfile,
  setWelcomeDismissed,
  skipWorkProfile,
} from "@/lib/server/accounts/work-profile"

describe("work role vocabulary", () => {
  it("lists every key and area exactly once", () => {
    expect(WORK_ROLE_OPTIONS.map((o) => o.id).sort()).toEqual(
      [...WORK_ROLE_KEYS].sort()
    )
    expect(WORK_AREA_OPTIONS.map((o) => o.id)).toEqual([...WORK_AREAS])
    expect(isWorkRoleKey("head_chef")).toBe(true)
    expect(isWorkRoleKey("admin")).toBe(false)
    expect(isWorkArea("bar")).toBe(true)
    expect(isWorkArea("office")).toBe(false)
  })

  it("labels the custom title for other", () => {
    expect(workRoleLabel("other", "  Pastry lead ")).toBe("Pastry lead")
    expect(workRoleLabel("other", null)).toBe("Other")
    expect(workRoleLabel("bartender")).toBe("Bartender")
    expect(workRoleLabel(null)).toBeNull()
  })
})

describe("homePrompt", () => {
  it("matches the role", () => {
    expect(homePrompt("tandoor_chef")).toBe("What did you cook today?")
    expect(homePrompt("plating")).toBe("What did you plate today?")
    expect(homePrompt("bartender")).toBe("What did you make at the bar today?")
    expect(homePrompt("server")).toBe("What did service look like today?")
    expect(homePrompt("manager")).toBe(
      "What did you capture around the venue today?"
    )
  })

  it("falls back to the general prompt", () => {
    const general = "What did you make or capture today?"
    expect(homePrompt(null)).toBe(general)
    expect(homePrompt(undefined)).toBe(general)
    expect(homePrompt("other")).toBe(general)
  })
})

describe("workFocus", () => {
  it("is null without a role or areas", () => {
    expect(workFocus(null)).toBeNull()
    expect(workFocus("other", [])).toBeNull()
  })

  it("puts drinks first for the bar", () => {
    expect(workFocus("bartender")).toEqual({
      sectionKinds: ["drinks"],
      sectionKeywords: [],
      contentTypes: ["drinks", "venue", "event"],
    })
  })

  it("merges the role's areas with extra areas without repeats", () => {
    const focus = workFocus("tandoor_chef", ["curry", "tandoor"])!
    expect(focus.sectionKinds).toEqual(["food"])
    expect(focus.sectionKeywords).toContain("naan")
    expect(focus.sectionKeywords).toContain("korma")
    expect(new Set(focus.sectionKeywords).size).toBe(
      focus.sectionKeywords.length
    )
    expect(focus.contentTypes).toEqual(["dish", "preparation"])
  })

  it("prioritises Clay Oven for tandoor work without promoting other oven sections", () => {
    const tandoor = workFocus("tandoor_chef")
    const curry = workFocus("curry_chef")
    const clayOven = {
      name: "Clay Oven",
      slug: "specials",
      kind: "food",
    } as const

    expect(sectionFocusRank(clayOven, tandoor)).toBe(0)
    expect(
      sectionFocusRank(
        { ...clayOven, name: "Specials", slug: "clay-oven" },
        tandoor
      )
    ).toBe(0)
    expect(
      sectionFocusRank({ ...clayOven, name: "Mixed Grills" }, tandoor)
    ).toBe(0)
    expect(
      sectionFocusRank(
        { ...clayOven, name: "Wood-Fired Oven", slug: "clay" },
        tandoor
      )
    ).toBe(1)
    expect(sectionFocusRank(clayOven, curry)).toBe(1)
    expect(sectionFocusRank({ ...clayOven, name: "Curries" }, curry)).toBe(0)
  })

  it("uses extra areas alone for other", () => {
    expect(workFocus("other", ["bar"])?.sectionKinds).toEqual(["drinks"])
  })
})

describe("suggestRoleFromJobTitle", () => {
  it("matches known titles after normalising", () => {
    expect(suggestRoleFromJobTitle("Head Chef")).toBe("head_chef")
    expect(suggestRoleFromJobTitle("  tandoori-chef ")).toBe("tandoor_chef")
    expect(suggestRoleFromJobTitle("Waitress")).toBe("server")
    expect(suggestRoleFromJobTitle("General Manager")).toBe("manager")
  })

  it("returns null when unsure", () => {
    expect(suggestRoleFromJobTitle(null)).toBeNull()
    expect(suggestRoleFromJobTitle("")).toBeNull()
    expect(suggestRoleFromJobTitle("DEV FIXTURE Chef")).toBeNull()
    expect(suggestRoleFromJobTitle("Head chef and bar")).toBeNull()
  })
})

describe("parseWorkProfileInput", () => {
  it("accepts a listed role with areas in display order, deduplicated", () => {
    expect(
      parseWorkProfileInput({
        roleKey: "curry_chef",
        roleTitle: "ignored",
        workAreas: ["bar", "curry", "bar"],
      })
    ).toEqual({
      ok: true,
      value: {
        roleKey: "curry_chef",
        roleTitle: null,
        workAreas: ["curry", "bar"],
      },
    })
  })

  it("reads only the allowed fields", () => {
    const parsed = parseWorkProfileInput({
      roleKey: "server",
      job_title: "Owner",
      department: "boh",
      role: "admin",
      staffId: "someone-else",
    })
    expect(parsed).toEqual({
      ok: true,
      value: { roleKey: "server", roleTitle: null, workAreas: [] },
    })
  })

  it("requires a short title for other", () => {
    expect(
      parseWorkProfileInput({ roleKey: "other", roleTitle: "  Pastry   lead " })
    ).toEqual({
      ok: true,
      value: { roleKey: "other", roleTitle: "Pastry lead", workAreas: [] },
    })
    expect(parseWorkProfileInput({ roleKey: "other", roleTitle: " " })).toEqual(
      { ok: false, fieldErrors: { roleTitle: "Enter your role." } }
    )
    expect(
      parseWorkProfileInput({ roleKey: "other", roleTitle: "x".repeat(41) })
    ).toEqual({
      ok: false,
      fieldErrors: { roleTitle: "Use 40 characters or fewer." },
    })
  })

  it("rejects unknown roles and areas", () => {
    expect(parseWorkProfileInput(null)).toEqual({
      ok: false,
      fieldErrors: { roleKey: "Choose what you mainly do." },
    })
    expect(
      parseWorkProfileInput({ roleKey: "admin", workAreas: ["office"] })
    ).toEqual({
      ok: false,
      fieldErrors: {
        roleKey: "Choose what you mainly do.",
        workAreas: "Choose from the listed areas.",
      },
    })
    expect(
      parseWorkProfileInput({ roleKey: "host", workAreas: "bar" })
    ).toMatchObject({
      ok: false,
      fieldErrors: { workAreas: expect.any(String) },
    })
  })
})

describe("toWorkProfile", () => {
  it("is null without a row and drops unknown keys", () => {
    expect(toWorkProfile(null)).toBeNull()
    expect(
      toWorkProfile({
        role_key: "astronaut",
        role_title: "Captain",
        work_areas: ["bar", "moon"],
        completed_at: "2026-11-06T10:00:00Z",
        skipped_at: null,
        welcome_dismissed_at: null,
      })
    ).toEqual({
      roleKey: null,
      roleTitle: null,
      workAreas: ["bar"],
      completedAt: "2026-11-06T10:00:00Z",
      skippedAt: null,
      welcomeDismissedAt: null,
    })
  })
})

const row = {
  staff_id: "u1",
  role_key: "bartender",
  role_title: null,
  work_areas: ["bar"],
  completed_at: "2026-11-06T10:00:00Z",
  skipped_at: null,
  welcome_dismissed_at: null,
  created_at: "2026-11-06T10:00:00Z",
  updated_at: "2026-11-06T10:00:00Z",
}

function caller(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result)
  return { rpc, actor: { db: { rpc } } as never }
}

describe("work profile writes", () => {
  it("does not call the database for invalid input", async () => {
    const { rpc, actor } = caller({ data: row, error: null })
    const result = await saveWorkProfile(actor, { roleKey: "nope" })
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("sends only the parsed fields to save_work_profile", async () => {
    const { rpc, actor } = caller({ data: row, error: null })
    const result = await saveWorkProfile(actor, {
      roleKey: "bartender",
      workAreas: ["bar"],
      staffId: "someone-else",
    })
    expect(rpc).toHaveBeenCalledWith("save_work_profile", {
      p_role_key: "bartender",
      p_role_title: null,
      p_work_areas: ["bar"],
    })
    expect(result).toEqual({ ok: true, work: toWorkProfile(row) })
  })

  it("maps database refusals to messages", async () => {
    const forbidden = caller({
      data: null,
      error: { code: "42501", message: "work_profile_forbidden" },
    })
    expect(await skipWorkProfile(forbidden.actor)).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(forbidden.rpc).toHaveBeenCalledWith("skip_work_profile")

    const broken = caller({ data: null, error: { code: "08006" } })
    expect(await setWelcomeDismissed(broken.actor, true)).toMatchObject({
      ok: false,
      status: 503,
    })
    expect(broken.rpc).toHaveBeenCalledWith("set_welcome_dismissed", {
      p_dismissed: true,
    })
  })
})
