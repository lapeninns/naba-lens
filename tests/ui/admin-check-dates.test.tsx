// @vitest-environment jsdom
// B03 UI design §6.4: what turning on a check-date rule would do, read only.
import { cleanup, render, screen, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/knowledge/check-dates",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
}))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/lib/auth", () => ({
  requireActiveAdmin: vi.fn(async () => ({
    id: "a1",
    displayName: "TEST Admin",
  })),
}))
const venues = vi.hoisted(() => ({
  rows: [] as { id: string; name: string }[],
}))
vi.mock("@/lib/server/coverage", () => ({
  getCoverageActor: vi.fn(async () => ({
    ok: true,
    actor: {
      profile: { id: "a1" },
      db: {
        from: () => ({
          select: () => ({
            in: async () => ({ data: venues.rows, error: null }),
          }),
        }),
      },
    },
  })),
}))
const knowledge = vi.hoisted(() => ({
  listQuestionRegistry: vi.fn(),
  getQuestion: vi.fn(),
  listFreshnessPolicies: vi.fn(),
  previewFreshness: vi.fn(),
}))
vi.mock("@/lib/knowledge-client/services", () => ({
  knowledgeServices: knowledge,
}))

import CheckDatesPreviewPage from "@/app/admin/knowledge/check-dates/page"

const VENUE = "9b000000-0000-4000-8000-000000000201"

beforeEach(() => {
  vi.clearAllMocks()
  venues.rows = [{ id: VENUE, name: "⟨Venue A⟩" }]
  knowledge.listQuestionRegistry.mockResolvedValue({
    ok: true,
    questions: [
      {
        key: "onsite_parking",
        guidance: { question: "⟨Parking question⟩" },
        freshness: { internal: null, public: null },
      },
      {
        key: "guest_wifi",
        guidance: { question: "⟨Wi-Fi question⟩" },
        freshness: { internal: "fixture_365", public: null },
      },
    ],
  })
  knowledge.listFreshnessPolicies.mockResolvedValue({
    ok: true,
    policies: [
      policy({ policyId: "offering_90", use: "internal", maxAge: "P90D" }),
      policy({ policyId: "fixture_365", use: "internal", maxAge: "P365D" }),
      policy({ policyId: "offering_public", use: "public", maxAge: "P30D" }),
    ],
  })
})

function policy(over: Record<string, unknown>) {
  return {
    policyId: "x",
    version: 1,
    claimClass: "offering",
    use: "internal",
    maxAge: "P90D",
    recheckLead: "P14D",
    basis: "observed_on",
    note: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    ...over,
  }
}
afterEach(cleanup)

async function show(search: Record<string, string> = {}) {
  render(await CheckDatesPreviewPage({ searchParams: Promise.resolve(search) }))
}

describe("admin check dates preview", () => {
  it("says it changes nothing, and reads nothing until a rule is named", async () => {
    await show()
    expect(
      screen.getByText(
        "This changes nothing. Turning a rule on is an owner decision and a release step."
      )
    ).toBeTruthy()
    expect(
      within(screen.getByLabelText("Question")).getByRole("option", {
        name: "⟨Parking question⟩",
      })
    ).toBeTruthy()
    expect(knowledge.previewFreshness).not.toHaveBeenCalled()
  })

  it("shows what the rule would do per venue and use, from the server", async () => {
    knowledge.previewFreshness.mockResolvedValue({
      ok: true,
      preview: {
        key: "onsite_parking",
        items: [
          {
            venueId: VENUE,
            use: "internal",
            answers: 5,
            dueSoon: 1,
            expired: 2,
            basisMissing: 1,
          },
        ],
      },
    })
    await show({ key: "onsite_parking", internal: "offering_90" })
    expect(knowledge.previewFreshness).toHaveBeenCalledWith(expect.anything(), {
      key: "onsite_parking",
      policy: { internal: "offering_90", public: null },
    })
    expect(screen.getByText("⟨Venue A⟩")).toBeTruthy()
    expect(screen.getByText("For staff and internal tools")).toBeTruthy()
    expect(
      screen.getByText("2 answers would be past their check date")
    ).toBeTruthy()
    expect(
      screen.getByText("1 would be not in use because they have no check date")
    ).toBeTruthy()
    expect(screen.getByText("4 rechecks would open")).toBeTruthy()
  })

  it("offers Try again only when the read may work again", async () => {
    knowledge.previewFreshness.mockResolvedValue({
      ok: false,
      code: "unavailable",
      status: 503,
      message: "down",
    })
    await show({ key: "onsite_parking", internal: "offering_90" })
    expect(
      screen.getByText("We couldn't work out what this rule would do.")
    ).toBeTruthy()
    expect(screen.getByRole("link", { name: "Try again" })).toBeTruthy()
    cleanup()
    knowledge.previewFreshness.mockResolvedValue({
      ok: false,
      code: "invalid_input",
      status: 400,
      message: "bad",
    })
    await show({ key: "onsite_parking", internal: "offering_90" })
    expect(screen.queryByRole("link", { name: "Try again" })).toBeNull()
  })

  it("offers only the rules the server lists, for each use (A42)", async () => {
    await show()
    const internal = screen.getByLabelText(
      "Rule for staff and internal tools (optional)"
    )
    expect(
      within(internal)
        .getAllByRole("option")
        .map((o) => o.textContent)
    ).toEqual([
      "None",
      "offering_90 (due for a check after 90 days)",
      "fixture_365 (due for a check after 365 days)",
    ])
    expect(
      within(screen.getByLabelText("Rule for guests (optional)"))
        .getAllByRole("option")
        .map((o) => (o as HTMLOptionElement).value)
    ).toEqual(["", "offering_public"])
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("starts from the question's rules in force until the form names others", async () => {
    knowledge.previewFreshness.mockResolvedValue({
      ok: true,
      preview: { key: "guest_wifi", items: [] },
    })
    await show({ key: "guest_wifi" })
    expect(
      (
        screen.getByLabelText(
          "Rule for staff and internal tools (optional)"
        ) as HTMLSelectElement
      ).value
    ).toBe("fixture_365")
    expect(knowledge.previewFreshness).toHaveBeenCalledWith(expect.anything(), {
      key: "guest_wifi",
      policy: { internal: "fixture_365", public: null },
    })
    cleanup()
    vi.clearAllMocks()
    // Named None for both: nothing to preview, and the rule in force isn't put back.
    await show({ key: "guest_wifi", internal: "", public: "" })
    expect(
      (
        screen.getByLabelText(
          "Rule for staff and internal tools (optional)"
        ) as HTMLSelectElement
      ).value
    ).toBe("")
    expect(knowledge.previewFreshness).not.toHaveBeenCalled()
  })

  it("starts from the version in force now, not a later one (review 2)", async () => {
    knowledge.listQuestionRegistry.mockResolvedValue({
      ok: true,
      questions: [
        {
          key: "guest_wifi",
          version: 3,
          guidance: { question: "⟨Wi-Fi question⟩" },
          effectiveFrom: "2999-01-01T00:00:00.000Z",
          freshness: { internal: "offering_90", public: "offering_public" },
        },
      ],
    })
    knowledge.getQuestion.mockImplementation(
      async (_actor: unknown, { version }: { version: number }) => ({
        ok: true,
        question:
          version === 2
            ? {
                key: "guest_wifi",
                version: 2,
                effectiveFrom: "2998-01-01T00:00:00.000Z",
                freshness: { internal: "offering_90", public: null },
              }
            : {
                key: "guest_wifi",
                version: 1,
                effectiveFrom: null,
                freshness: { internal: "fixture_365", public: null },
              },
      })
    )
    knowledge.previewFreshness.mockResolvedValue({
      ok: true,
      preview: { key: "guest_wifi", items: [] },
    })
    await show({ key: "guest_wifi" })
    expect(knowledge.getQuestion.mock.calls.map((c) => c[1])).toEqual([
      { key: "guest_wifi", version: 2 },
      { key: "guest_wifi", version: 1 },
    ])
    expect(knowledge.previewFreshness).toHaveBeenCalledWith(expect.anything(), {
      key: "guest_wifi",
      policy: { internal: "fixture_365", public: null },
    })
    expect(
      (screen.getByLabelText("Rule for guests (optional)") as HTMLSelectElement)
        .value
    ).toBe("")
    cleanup()
    vi.clearAllMocks()
    // An earlier version that can't be read: no rules are guessed, and it says so.
    knowledge.getQuestion.mockResolvedValue({
      ok: false,
      code: "unavailable",
      status: 503,
      message: "down",
    })
    await show({ key: "guest_wifi" })
    expect(
      screen.getByText(
        "This question's rules in force couldn't be read. Choose the rules to preview, or reload the page."
      )
    ).toBeTruthy()
    expect(knowledge.previewFreshness).not.toHaveBeenCalled()
  })

  it("passes over a skipped version to the one in force", async () => {
    knowledge.listQuestionRegistry.mockResolvedValue({
      ok: true,
      questions: [
        {
          key: "guest_wifi",
          version: 3,
          guidance: { question: "⟨Wi-Fi question⟩" },
          effectiveFrom: "2999-01-01T00:00:00.000Z",
          freshness: { internal: "offering_90", public: "offering_public" },
        },
      ],
    })
    knowledge.getQuestion.mockImplementation(
      async (_actor: unknown, { version }: { version: number }) =>
        version === 2
          ? {
              ok: false,
              code: "not_found",
              status: 404,
              message: "This question could not be found.",
            }
          : {
              ok: true,
              question: {
                key: "guest_wifi",
                version: 1,
                effectiveFrom: null,
                freshness: { internal: "fixture_365", public: null },
              },
            }
    )
    knowledge.previewFreshness.mockResolvedValue({
      ok: true,
      preview: { key: "guest_wifi", items: [] },
    })
    await show({ key: "guest_wifi" })
    expect(knowledge.getQuestion.mock.calls.map((c) => c[1])).toEqual([
      { key: "guest_wifi", version: 2 },
      { key: "guest_wifi", version: 1 },
    ])
    expect(
      (
        screen.getByLabelText(
          "Rule for staff and internal tools (optional)"
        ) as HTMLSelectElement
      ).value
    ).toBe("fixture_365")
    expect(knowledge.previewFreshness).toHaveBeenCalledWith(expect.anything(), {
      key: "guest_wifi",
      policy: { internal: "fixture_365", public: null },
    })
    expect(
      screen.queryByText(
        "This question's rules in force couldn't be read. Choose the rules to preview, or reload the page."
      )
    ).toBeNull()
    // A read that fails outright, or no registry function, is not a skip.
    for (const failed of [
      () => Promise.reject(new Error("down")),
      async () => ({ ok: true, question: null }),
    ]) {
      cleanup()
      vi.clearAllMocks()
      knowledge.getQuestion.mockImplementation(failed)
      await show({ key: "guest_wifi" })
      expect(knowledge.getQuestion).toHaveBeenCalledTimes(1)
      expect(
        screen.getByText(
          "This question's rules in force couldn't be read. Choose the rules to preview, or reload the page."
        )
      ).toBeTruthy()
      expect(knowledge.previewFreshness).not.toHaveBeenCalled()
    }
  })

  it("reads no earlier version when the latest is in force", async () => {
    knowledge.listQuestionRegistry.mockResolvedValue({
      ok: true,
      questions: [
        {
          key: "guest_wifi",
          version: 2,
          guidance: { question: "⟨Wi-Fi question⟩" },
          effectiveFrom: "2026-01-01T00:00:00.000Z",
          freshness: { internal: "fixture_365", public: null },
        },
      ],
    })
    knowledge.previewFreshness.mockResolvedValue({
      ok: true,
      preview: { key: "guest_wifi", items: [] },
    })
    await show({ key: "guest_wifi" })
    expect(knowledge.getQuestion).not.toHaveBeenCalled()
    expect(knowledge.previewFreshness).toHaveBeenCalledWith(expect.anything(), {
      key: "guest_wifi",
      policy: { internal: "fixture_365", public: null },
    })
  })

  it("starts a newly chosen question from its own rules, not the last one's (review 2)", async () => {
    knowledge.previewFreshness.mockResolvedValue({
      ok: true,
      preview: { key: "guest_wifi", items: [] },
    })
    const internal = () =>
      (
        screen.getByLabelText(
          "Rule for staff and internal tools (optional)"
        ) as HTMLSelectElement
      ).value
    // First choice: the form sent its empty rule controls with it.
    await show({ key: "guest_wifi", for: "", internal: "", public: "" })
    expect(internal()).toBe("fixture_365")
    expect(knowledge.previewFreshness).toHaveBeenLastCalledWith(
      expect.anything(),
      { key: "guest_wifi", policy: { internal: "fixture_365", public: null } }
    )
    expect(
      (document.querySelector('input[name="for"]') as HTMLInputElement).value
    ).toBe("guest_wifi")
    cleanup()
    // Changed from parking with offering_90 chosen there: not carried over.
    await show({
      key: "guest_wifi",
      for: "onsite_parking",
      internal: "offering_90",
      public: "",
    })
    expect(internal()).toBe("fixture_365")
    expect(knowledge.previewFreshness).toHaveBeenLastCalledWith(
      expect.anything(),
      { key: "guest_wifi", policy: { internal: "fixture_365", public: null } }
    )
    cleanup()
    // To parking, which has no rules in force: nothing carried, nothing read.
    knowledge.previewFreshness.mockClear()
    await show({
      key: "onsite_parking",
      for: "guest_wifi",
      internal: "fixture_365",
      public: "",
    })
    expect(internal()).toBe("")
    expect(knowledge.previewFreshness).not.toHaveBeenCalled()
    cleanup()
    // Chosen for this question: the choice wins over the rules in force.
    await show({
      key: "guest_wifi",
      for: "guest_wifi",
      internal: "offering_90",
      public: "",
    })
    expect(internal()).toBe("offering_90")
    expect(knowledge.previewFreshness).toHaveBeenLastCalledWith(
      expect.anything(),
      { key: "guest_wifi", policy: { internal: "offering_90", public: null } }
    )
    expect(knowledge.getQuestion).not.toHaveBeenCalled()
  })

  it("keeps the chosen rules on Try again", async () => {
    knowledge.previewFreshness.mockResolvedValue({
      ok: false,
      code: "unavailable",
      status: 503,
      message: "down",
    })
    await show({
      key: "guest_wifi",
      for: "guest_wifi",
      internal: "offering_90",
    })
    const href = screen
      .getByRole("link", { name: "Try again" })
      .getAttribute("href")!
    expect(Object.fromEntries(new URL(href, "http://x").searchParams)).toEqual({
      key: "guest_wifi",
      for: "guest_wifi",
      internal: "offering_90",
      public: "",
    })
  })

  it("says when no rules are set up, or they can't be read", async () => {
    knowledge.listFreshnessPolicies.mockResolvedValue({
      ok: true,
      policies: [],
    })
    await show()
    expect(
      screen.getByText("No check-date rules have been set up yet.")
    ).toBeTruthy()
    cleanup()
    knowledge.listFreshnessPolicies.mockResolvedValue({
      ok: false,
      code: "unavailable",
      status: 503,
      message: "down",
    })
    await show()
    expect(
      screen.getByText(
        "The check-date rules couldn't be read. Reload the page to try again."
      )
    ).toBeTruthy()
  })
})
