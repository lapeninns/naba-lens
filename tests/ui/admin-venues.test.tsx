// @vitest-environment jsdom
// S2-ADMIN screens (spec §8 A1, A2): the Overview puts venues needing
// attention first and links every number; venue forms show errors beside
// the field, and the archive, scope and template changes show their impact
// before the confirm. The MFA reset says what happened in place.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const actions = vi.hoisted(() => ({
  createVenueAction: vi.fn(),
  saveVenueAction: vi.fn(),
  setStatusAction: vi.fn(),
  setReviewerAction: vi.fn(),
  setScopeAction: vi.fn(),
  applyTemplateAction: vi.fn(),
  archiveImpactAction: vi.fn(),
  scopeImpactAction: vi.fn(),
  templatePreviewAction: vi.fn(),
}))
vi.mock("@/app/admin/venues/actions", () => actions)
const mfa = vi.hoisted(() => ({ resetMfaAction: vi.fn() }))
vi.mock("@/app/admin/staff/[id]/mfa-reset-actions", () => mfa)

import { OverviewView } from "@/app/admin/overview/overview-view"
import { MfaResetPanel } from "@/app/admin/staff/[id]/mfa-reset-panel"
import {
  ReviewerForm,
  ScopeForm,
  StatusForm,
  TemplateForm,
  VenueDetailsForm,
} from "@/app/admin/venues/venue-forms"
import {
  parseOverview,
  parseOverviewFilters,
  type OverviewRow,
} from "@/lib/admin/overview"
import { parseAdminVenue, type AdminVenue } from "@/lib/admin/venues"

afterEach(() => {
  cleanup()
  for (const fn of [...Object.values(actions), mfa.resetMfaAction])
    fn.mockReset()
})

const V1 = "11111111-1111-4111-8111-111111111111"
const V2 = "22222222-2222-4222-8222-222222222222"
const NOW = new Date("2026-11-18T12:00:00Z")
const ALL_SET = {
  items: ["inventory", "reviewers", "staff", "spaces", "collection"].map(
    (key) => ({ key, done: true })
  ),
}

function rows(): OverviewRow[] {
  return parseOverview({
    rows: [
      {
        venueId: V1,
        name: "The Bell",
        operatingStatus: "open",
        active: true,
        categories: [
          { category: "food", total: 10, covered: 4, pending: 2 },
          { category: "drinks", total: 4, covered: 4 },
          { category: "spaces", total: 0, covered: 0 },
          { category: "facilities", total: 5, covered: 0 },
        ],
        facts: { confirmed: 6, total: 8 },
        unlabelled: 7,
        review: { waiting: 2, oldestAt: "2026-11-08T12:00:00Z" },
        checksDue: {
          dishes: 1,
          places: 0,
          facilities: 0,
          slots: 1,
          facts: 0,
          total: 1,
        },
        publication: { failed: 1, withdrawalPending: 0, total: 1 },
        added: 3,
        setup: {
          items: [{ key: "inventory", done: false }, ...ALL_SET.items.slice(1)],
        },
      },
      {
        venueId: V2,
        name: "The Crown",
        operatingStatus: "temporarily_closed",
        active: true,
        categories: [{ category: "food", total: 2, covered: 2 }],
        facts: { confirmed: 0, total: 0 },
        unlabelled: 0,
        review: { waiting: 0, oldestAt: null },
        checksDue: {
          dishes: 0,
          places: 0,
          facilities: 0,
          slots: 0,
          facts: 0,
          total: 0,
        },
        publication: { failed: 0, withdrawalPending: 0, total: 0 },
        added: 0,
        setup: ALL_SET,
      },
    ],
  })!
}

const filters = parseOverviewFilters({}, "2026-11")

describe("Overview (A1)", () => {
  it("lists venues needing attention first, each problem linked", () => {
    render(<OverviewView rows={rows()} filters={filters} now={NOW} />)
    const attention = screen.getByTestId("overview-attention")
    const items = within(attention).getAllByRole("listitem")
    expect(items[0].textContent).toContain("The Bell")
    expect(attention.textContent).not.toContain("The Crown")
    const setupLink = within(attention).getByText("1 setup step missing")
    expect(setupLink.closest("a")?.getAttribute("href")).toBe(
      `/admin/venues/${V1}#setup`
    )
    expect(
      within(attention)
        .getByText("1 publication error")
        .closest("a")
        ?.getAttribute("href")
    ).toBe("/admin/publishing")
    expect(
      within(attention).getByText("Oldest photo waiting 10 days")
    ).toBeTruthy()
  })

  it("links every number in the table to its records", () => {
    render(<OverviewView rows={rows()} filters={filters} now={NOW} />)
    const [bell] = screen.getAllByTestId("overview-row")
    const food = within(bell).getByTestId("overview-food")
    expect(food.textContent).toContain("4 of 10")
    expect(food.textContent).toContain("40%")
    expect(food.textContent).toContain("2 waiting")
    expect(within(food).getByRole("link").getAttribute("href")).toBe(
      `/admin/coverage/${V1}/menu-photos`
    )
    expect(
      within(bell).getByTestId("overview-unlabelled").getAttribute("href")
    ).toBe(`/admin?venue=${V1}&labels=unlabelled`)
    expect(
      within(bell).getByTestId("overview-review").getAttribute("href")
    ).toBe(`/admin/coverage/${V1}/menu-photos`)
    // V20: each part of Checks due links to the page that lists it.
    expect(
      within(bell).getByTestId("overview-checks").getAttribute("href")
    ).toBe(`/admin/coverage/${V1}/menu-photos?status=recheck`)
    const parts = within(bell).getByTestId("overview-check-parts")
    expect(
      within(parts).getByText("1 dish").closest("a")?.getAttribute("href")
    ).toBe(`/admin/coverage/${V1}/menu-photos?status=recheck`)
    expect(within(bell).getByTestId("overview-facts").textContent).toContain(
      "6 of 8"
    )
    expect(
      within(bell).getByTestId("overview-added").getAttribute("href")
    ).toBe(`/admin?venue=${V1}&from=2026-11-01&to=2026-11-30`)
    // Spaces has no slots: words, not a zero.
    expect(bell.textContent).toContain("None listed")
    // Totals line adds the rows (AC39).
    const table = screen.getByTestId("overview-table")
    expect(table.textContent).toContain("6 of 12 · 50%")
  })

  it("draws the focus ring in on-ok inside a full (bottle) cell (review Z4)", () => {
    render(<OverviewView rows={rows()} filters={filters} now={NOW} />)
    const [bell] = screen.getAllByTestId("overview-row")
    // Drinks is 4 of 4: the bottle fill, where the ink ring is under 3:1.
    const full = within(bell).getByTestId("overview-drinks")
    expect(full.className).toContain("md:bg-ok-fg")
    expect(full.className).toContain("md:[--focus:var(--on-ok)]")
    // A partial cell keeps the ink ring (at least 9.6:1 on ok-bg).
    const part = within(bell).getByTestId("overview-food")
    expect(part.className).not.toContain("--focus")
  })

  it("flags a long wait from the admin's backlog alert setting (V21)", () => {
    // The Bell's oldest photo has waited 10 days.
    const { unmount } = render(
      <OverviewView
        rows={rows()}
        filters={filters}
        now={NOW}
        reviewAlertDays={14}
      />
    )
    expect(screen.queryByText("Oldest photo waiting 10 days")).toBeNull()
    unmount()
    render(
      <OverviewView
        rows={rows()}
        filters={filters}
        now={NOW}
        reviewAlertDays={3}
      />
    )
    expect(screen.getByText("Oldest photo waiting 10 days")).toBeTruthy()
  })

  it("shows only the chosen categories and says when no menu is scheduled", () => {
    const next = parseOverviewFilters(
      { menu: "next", category: ["food"] },
      "2026-11"
    )
    render(<OverviewView rows={rows()} filters={next} now={NOW} />)
    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent)
    expect(headers).toContain("Food")
    expect(headers).not.toContain("Drinks")
    expect(screen.getAllByText("No menu scheduled")).toHaveLength(2)
  })

  it("says so when no venue matches", () => {
    render(<OverviewView rows={[]} filters={filters} now={NOW} />)
    expect(screen.getByText("No venues match")).toBeTruthy()
  })
})

const venue: AdminVenue = parseAdminVenue({
  id: V1,
  name: "The Bell",
  slug: "the-bell",
  locality: "Ely",
  timezone: "Europe/London",
  operatingStatus: "open",
  active: true,
  revision: 2,
  reviewers: {
    main: { profileId: V2, name: "Sam", eligible: false, revision: 1 },
  },
  setup: ALL_SET,
})!

describe("venue forms (A2)", () => {
  it("writes a database refusal beside its field", async () => {
    actions.saveVenueAction.mockResolvedValue({
      status: "error",
      message: "Check the highlighted field.",
      fieldErrors: { name: "Another venue already has this name." },
    })
    render(<VenueDetailsForm venue={venue} />)
    fireEvent.click(screen.getByTestId("venue-save"))
    expect(
      await screen.findByText("Another venue already has this name.")
    ).toBeTruthy()
    expect(
      (screen.getByTestId("venue-timezone") as HTMLSelectElement).value
    ).toBe("Europe/London")
  })

  it("shows what archiving changes before it can be confirmed", async () => {
    actions.archiveImpactAction.mockResolvedValue({
      ok: true,
      value: {
        members: 4,
        onlyVenue: 2,
        scheduledMenus: 1,
        photos: 120,
        destinations: 0,
      },
    })
    render(<StatusForm venue={venue} />)
    const save = screen.getByTestId("venue-status-save") as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(screen.getByRole("radio", { name: /Closed for good/ }))
    const impact = await screen.findByTestId("archive-impact")
    expect(actions.archiveImpactAction).toHaveBeenCalledWith(V1)
    expect(impact.textContent).toContain("4 people can no longer open it")
    expect(impact.textContent).toContain("for 2 it is their only venue")
    expect(impact.textContent).toContain("120 photos")
    expect(save.textContent).toBe("Archive the venue")
    await waitFor(() => expect(save.disabled).toBe(false))
  })

  it("previews a scope change, then asks for a reason", async () => {
    actions.scopeImpactAction.mockResolvedValue({
      ok: true,
      value: {
        key: "accommodation",
        applicableBefore: false,
        applicableAfter: true,
        changes: true,
        slotsBefore: 40,
        coveredBefore: 12,
        slotsAdded: 0,
        slotsRemoved: 0,
        roomPlaces: 0,
      },
    })
    render(
      <ScopeForm
        venueId={V1}
        applicable={false}
        decided={false}
        revision={0}
        reason={null}
      />
    )
    fireEvent.click(screen.getByTestId("scope-preview"))
    const impact = await screen.findByTestId("scope-impact")
    expect(actions.scopeImpactAction).toHaveBeenCalledWith(V1, true)
    expect(impact.textContent).toContain("keeps its 40 slots (12 with a photo)")
    expect(screen.getByLabelText(/Why is this changing/)).toBeTruthy()
  })

  it("previews a template copy from another venue", async () => {
    actions.templatePreviewAction.mockResolvedValue({
      ok: true,
      value: {
        sourceVenueId: V2,
        questions: [{ key: "darts", label: "Is there a dartboard?" }],
        places: [{ label: "Garden", kind: "area" }],
      },
    })
    render(
      <TemplateForm venueId={V1} otherVenues={[{ id: V2, name: "Crown" }]} />
    )
    fireEvent.change(screen.getByTestId("template-source"), {
      target: { value: V2 },
    })
    fireEvent.click(screen.getByTestId("template-preview-button"))
    const preview = await screen.findByTestId("template-preview")
    expect(actions.templatePreviewAction).toHaveBeenCalledWith(V1, V2)
    expect(preview.textContent).toContain("1 facility question")
    expect(preview.textContent).toContain("Garden")
  })

  it("marks a named reviewer who no longer reviews there", () => {
    render(
      <ReviewerForm
        venueId={V1}
        responsibility="main"
        current={venue.reviewers.main}
        candidates={[{ profileId: V1, name: "Alex", role: "manager" }]}
      />
    )
    expect(screen.getByText(/Sam no longer reviews at this venue/)).toBeTruthy()
    const options = screen.getAllByRole("option").map((o) => o.textContent)
    expect(options).toEqual([
      "Nobody named",
      "Sam (no longer reviews here)",
      "Alex",
    ])
  })
})

describe("MFA reset", () => {
  it("says the reset happened in place", async () => {
    mfa.resetMfaAction.mockResolvedValue({ status: "done", removed: 1 })
    render(<MfaResetPanel profileId={V2} firstName="Sam" />)
    fireEvent.click(screen.getByRole("button", { name: "Reset authenticator" }))
    expect(
      await screen.findByText(/Sam sets up a new authenticator/)
    ).toBeTruthy()
  })
})
