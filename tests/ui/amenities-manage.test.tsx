// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AmenitiesOverview,
  groupByCategory,
  matchesCatalogue,
  type AmenitiesOverviewHandlers,
} from "@/components/nabalens/amenities/manage"
import { manageHrefs } from "@/components/nabalens/coverage"
import { ManageNav } from "@/components/nabalens/coverage/manage-nav"
import { UI_TEXT, type AmenityFailure } from "@/lib/amenities/contract"

import {
  ARCHIVED,
  BASE,
  CATALOGUE,
  DARTS,
  WIFI_CHECK,
  view,
} from "./amenities-manage-fixtures"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => "/staff/manage/amenities",
}))

afterEach(cleanup)
beforeEach(() => {
  refresh.mockReset()
  sessionStorage.clear()
})

function handlers(
  overrides: Partial<AmenitiesOverviewHandlers> = {}
): AmenitiesOverviewHandlers & {
  enable: ReturnType<typeof vi.fn>
  addChecks: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
} {
  return {
    enable: vi.fn(async () => ({ ok: true as const, created: 4 })),
    addChecks: vi.fn(async (keys: string[]) => ({
      ok: true as const,
      checkIds: keys.map((k) => `id-${k}`),
    })),
    restore: vi.fn(async () => ({ ok: true as const, revision: 8 })),
    ...overrides,
  } as never
}

const conflict: AmenityFailure = {
  ok: false,
  code: "revision_conflict",
  status: 409,
  message: "Stale.",
  currentRevision: 9,
}

describe("Manage nav", () => {
  it("has an Amenities tab after Our menu and amenity hrefs", () => {
    render(<ManageNav basePath={BASE} active="amenities" />)
    const tab = screen.getByRole("link", { name: UI_TEXT.navTab })
    expect(tab.getAttribute("href")).toBe("/staff/manage/amenities")
    expect(tab.getAttribute("aria-current")).toBe("page")
    const hrefs = manageHrefs("/admin/coverage/v1")
    expect(hrefs.amenities).toBe("/admin/coverage/v1/amenities")
    expect(hrefs.amenity("c 1")).toBe("/admin/coverage/v1/amenities/c%201")
    expect(hrefs.amenityCapture("c1")).toBe(
      "/admin/coverage/v1/amenities/c1/capture"
    )
  })
})

describe("AmenitiesOverview: enabling", () => {
  it("offers Enable Amenities to an admin and enables the venue", async () => {
    const user = userEvent.setup()
    const h = handlers()
    render(
      <AmenitiesOverview
        view={view({ enabled: false, canEnable: true, active: [] })}
        catalogue={null}
        basePath={BASE}
        handlers={h}
      />
    )
    await user.click(screen.getByRole("button", { name: UI_TEXT.enable }))
    expect(h.enable).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByText(
        /Amenities are on for TEST Venue: 4 core checks added/
      )
    ).toBeTruthy()
    expect(refresh).toHaveBeenCalled()
  })

  it("tells a manager that an admin must enable Amenities", () => {
    render(
      <AmenitiesOverview
        view={view({ enabled: false, canEnable: false, active: [] })}
        catalogue={null}
        basePath={BASE}
        handlers={handlers()}
      />
    )
    expect(screen.queryByRole("button", { name: UI_TEXT.enable })).toBeNull()
    expect(screen.getByText(/An admin must enable Amenities/)).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: UI_TEXT.addFromCatalogue })
    ).toBeNull()
  })
})

describe("AmenitiesOverview: lists", () => {
  it("groups active checks by progress with question, category, rule, assignee and answer", () => {
    render(
      <AmenitiesOverview
        view={view()}
        catalogue={CATALOGUE}
        basePath={BASE}
        handlers={handlers()}
      />
    )
    const capture = screen.getByRole("region", { name: "Needs capture" })
    const dart = within(capture).getByRole("link", {
      name: DARTS.entry.question,
    })
    expect(dart.getAttribute("href")).toBe(
      `/staff/manage/amenities/${DARTS.id}`
    )
    expect(within(capture).getByText("Games")).toBeTruthy()
    expect(within(capture).getByText("Evidence: Photo")).toBeTruthy()
    expect(within(capture).getByText("Unassigned")).toBeTruthy()
    expect(within(capture).getByText("Answer: To check")).toBeTruthy()

    const recheck = screen.getByRole("region", { name: "Needs recheck" })
    expect(within(recheck).getByText("Evidence: Video")).toBeTruthy()
    expect(within(recheck).getByText("Assigned to TEST Sam")).toBeTruthy()
    expect(
      within(recheck).getByText("Recheck: Conditions changed: new ramp")
    ).toBeTruthy()

    const complete = screen.getByRole("region", { name: "Complete" })
    expect(within(complete).getByText("Evidence: Photo and video")).toBeTruthy()
    expect(within(complete).getByText("Answer: Yes")).toBeTruthy()
  })

  it("shows who answered recently completed checks and when", () => {
    render(
      <AmenitiesOverview
        view={view()}
        catalogue={CATALOGUE}
        basePath={BASE}
        handlers={handlers()}
      />
    )
    const recent = screen.getByRole("region", {
      name: UI_TEXT.recentlyCompleted,
    })
    expect(
      within(recent).getByRole("link", { name: WIFI_CHECK.entry.question })
    ).toBeTruthy()
    expect(
      within(recent).getByText("Recorded by TEST Sam on 4 Nov 2026")
    ).toBeTruthy()
  })

  it("restores an archived check with its revision", async () => {
    const user = userEvent.setup()
    const h = handlers()
    render(
      <AmenitiesOverview
        view={view()}
        catalogue={CATALOGUE}
        basePath={BASE}
        handlers={h}
      />
    )
    const archived = screen.getByRole("region", { name: UI_TEXT.archived })
    await user.click(
      within(archived).getByRole("button", { name: UI_TEXT.restore })
    )
    expect(h.restore).toHaveBeenCalledWith({
      idempotencyKey: expect.any(String),
      checkId: ARCHIVED.id,
      revision: ARCHIVED.revision,
    })
  })

  it("reports a stale restore and re-reads the page", async () => {
    const user = userEvent.setup()
    const h = handlers({ restore: vi.fn(async () => conflict) })
    render(
      <AmenitiesOverview
        view={view()}
        catalogue={CATALOGUE}
        basePath={BASE}
        handlers={h}
      />
    )
    await user.click(screen.getByRole("button", { name: UI_TEXT.restore }))
    expect(
      await screen.findByText(/Someone else changed this check/)
    ).toBeTruthy()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe("Catalogue picker", () => {
  it("matches question, category and key, and groups by category", () => {
    const high = CATALOGUE[2]
    expect(matchesCatalogue(high, "HIGH CHAIR")).toBe(true)
    expect(matchesCatalogue(high, "families")).toBe(true)
    expect(matchesCatalogue(high, "high_chairs")).toBe(true)
    expect(matchesCatalogue(high, "parking")).toBe(false)
    expect(groupByCategory(CATALOGUE).map(([c]) => c)).toEqual([
      "Access",
      "Facilities",
      "Families",
      "Games",
    ])
  })

  it("searches, marks existing keys and adds the selected keys", async () => {
    const user = userEvent.setup()
    const h = handlers()
    render(
      <AmenitiesOverview
        view={view()}
        catalogue={CATALOGUE}
        basePath={BASE}
        handlers={h}
      />
    )
    await user.click(
      screen.getByRole("button", { name: UI_TEXT.addFromCatalogue })
    )
    const dialog = await screen.findByRole("dialog", {
      name: UI_TEXT.addFromCatalogue,
    })
    const wifi = within(dialog).getByRole("checkbox", {
      name: "Is there guest Wi-Fi?",
    }) as HTMLInputElement
    expect(wifi.disabled).toBe(true)
    expect(within(dialog).getAllByText("Already added")).toHaveLength(2)
    expect(
      within(dialog).getByText("Archived · adding restores it")
    ).toBeTruthy()
    expect(
      within(dialog).getByText("Photograph the changing table.")
    ).toBeTruthy()

    await user.click(
      within(dialog).getByRole("button", { name: UI_TEXT.addSelected })
    )
    expect(within(dialog).getByRole("alert").textContent).toMatch(
      /Choose at least one/
    )
    expect(h.addChecks).not.toHaveBeenCalled()

    await user.type(
      within(dialog).getByLabelText("Search the catalogue"),
      "famil"
    )
    expect(
      within(dialog).queryByRole("checkbox", { name: "Is there guest Wi-Fi?" })
    ).toBeNull()
    expect(within(dialog).getByRole("group", { name: "Families" })).toBeTruthy()
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "Are high chairs available?",
      })
    )
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Is there baby changing?" })
    )
    expect(within(dialog).getByText("2 selected")).toBeTruthy()
    await user.click(
      within(dialog).getByRole("button", { name: UI_TEXT.addSelected })
    )
    expect(h.addChecks).toHaveBeenCalledWith(
      ["high_chairs", "baby_changing"],
      expect.any(String)
    )
    expect(await screen.findByText("2 checks added.")).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("keeps the picker open with the server's field error", async () => {
    const user = userEvent.setup()
    const h = handlers({
      addChecks: vi.fn(async () => ({
        ok: false as const,
        code: "invalid_input" as const,
        status: 400 as const,
        message: "Check the list.",
        fieldErrors: { keys: "Unknown catalogue key." },
      })),
    })
    render(
      <AmenitiesOverview
        view={view()}
        catalogue={CATALOGUE}
        basePath={BASE}
        handlers={h}
      />
    )
    await user.click(
      screen.getByRole("button", { name: UI_TEXT.addFromCatalogue })
    )
    const dialog = await screen.findByRole("dialog")
    await user.click(
      within(dialog).getByRole("checkbox", { name: "Is there a pool table?" })
    )
    await user.click(
      within(dialog).getByRole("button", { name: UI_TEXT.addSelected })
    )
    expect(h.addChecks).toHaveBeenCalledWith(["pool_table"], expect.any(String))
    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "Unknown catalogue key."
    )
  })
})
