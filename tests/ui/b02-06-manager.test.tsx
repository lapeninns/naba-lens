// @vitest-environment jsdom
// B02-06: manager amenity screens, the shells' tab badges and the venue name.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ pathname: "/manager", refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: nav.refresh, replace: vi.fn() }),
}))

import { AppShell } from "@/components/nabalens/app-shell"
import {
  AmenitiesOverview,
  AmenityCheckDetail,
  type AmenitiesOverviewHandlers,
  type CheckDetailHandlers,
} from "@/components/nabalens/amenities/manage"
import { CataloguePicker } from "@/components/nabalens/amenities/manage/catalogue-picker"
import { answeredText } from "@/components/nabalens/amenities/manage/check-row"
import {
  SAVING,
  STILL_SAVING,
} from "@/components/nabalens/amenities/manage/check-detail"
import { ManagerShell } from "@/components/nabalens/manager/manager-shell"
import { TabBadge } from "@/components/nabalens/shell/tab-badge"
import { UI_TEXT, type AmenityFailure } from "@/lib/amenities/contract"

import {
  ARCHIVED,
  BASE,
  CATALOGUE,
  STEP_FREE_CHECK,
  WIFI_CHECK,
  detail,
  view,
} from "./amenities-manage-fixtures"

beforeEach(() => {
  nav.pathname = "/manager"
  nav.refresh.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const ok = async () => ({ ok: true as const, revision: 4 })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function detailHandlers(
  overrides: Partial<CheckDetailHandlers> = {}
): CheckDetailHandlers {
  return {
    assign: vi.fn(ok),
    setNotes: vi.fn(ok),
    archive: vi.fn(ok),
    restore: vi.fn(ok),
    reopen: vi.fn(ok),
    ...overrides,
  }
}

describe("check detail writes (MG-12, MG-26)", () => {
  it("says Saving… on the pressed button only, then focuses the outcome", async () => {
    const user = userEvent.setup()
    const reply = deferred<{ ok: true; revision: number }>()
    render(
      <AmenityCheckDetail
        detail={detail()}
        basePath={BASE}
        handlers={detailHandlers({ archive: () => reply.promise })}
      />
    )
    await user.click(screen.getByRole("button", { name: UI_TEXT.archive }))
    const busy = screen.getByRole("button", { name: SAVING })
    expect(busy.getAttribute("aria-busy")).toBe("true")
    // Only the pressed button changes its words.
    expect(screen.getAllByRole("button", { name: SAVING })).toHaveLength(1)
    await act(async () => reply.resolve({ ok: true, revision: 5 }))
    const status = screen
      .getAllByRole("status")
      .find((el) => el.textContent?.includes("Archived."))!
    expect(status).toBeTruthy()
    expect(document.activeElement).toBe(status)
    expect(screen.queryByRole("button", { name: SAVING })).toBeNull()
  })

  it("focuses the notice after a save that disables its own button", async () => {
    const user = userEvent.setup()
    render(
      <AmenityCheckDetail
        detail={detail()}
        basePath={BASE}
        handlers={detailHandlers()}
      />
    )
    await user.type(
      screen.getByRole("textbox", { name: /Notes for this venue/ }),
      " More."
    )
    await user.click(screen.getByRole("button", { name: "Save notes" }))
    expect(await screen.findByText("Notes saved.")).toBeTruthy()
    expect(document.activeElement?.textContent).toContain("Notes saved.")
    expect(document.activeElement?.getAttribute("role")).toBe("status")
  })

  it("says it is still saving after 15 seconds without a reply", () => {
    vi.useFakeTimers()
    render(
      <AmenityCheckDetail
        detail={detail()}
        basePath={BASE}
        handlers={detailHandlers({ archive: () => new Promise(() => {}) })}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.archive }))
    expect(screen.queryByText(STILL_SAVING)).toBeNull()
    act(() => {
      vi.advanceTimersByTime(15_000)
    })
    expect(screen.getByText(STILL_SAVING)).toBeTruthy()
  })
})

describe("history and rows (MG-29, MG-30, MG-21)", () => {
  it("names the answer's time as when it was recorded", () => {
    expect(answeredText(WIFI_CHECK)).toBe("Recorded by TEST Sam on 4 Nov 2026")
  })

  it("says each submission was sent by its author", () => {
    render(
      <AmenityCheckDetail
        detail={detail()}
        basePath={BASE}
        handlers={detailHandlers()}
      />
    )
    const submissions = screen.getByRole("region", { name: /Submissions/ })
    expect(within(submissions).getAllByText(/^Sent by /).length).toBe(2)
  })

  it("makes the whole check row the question's link target", () => {
    render(
      <AmenitiesOverview
        view={view()}
        catalogue={CATALOGUE}
        basePath={BASE}
        handlers={overviewHandlers()}
      />
    )
    const link = screen.getAllByRole("link", {
      name: STEP_FREE_CHECK.entry.question,
    })[0]
    expect(link.className).toMatch(/after:absolute/)
    expect(link.className).toMatch(/after:inset-0/)
    expect(link.closest("li")?.className).toMatch(/\brelative\b/)
    expect(link.closest("li")?.className).toMatch(/min-h-11/)
  })
})

function overviewHandlers(
  overrides: Partial<AmenitiesOverviewHandlers> = {}
): AmenitiesOverviewHandlers {
  return {
    enable: vi.fn(async () => ({ ok: true as const, created: 4 })),
    addChecks: vi.fn(async () => ({ ok: true as const, checkIds: ["x"] })),
    restore: vi.fn(ok),
    ...overrides,
  }
}

describe("restore on the archived list (MG-13)", () => {
  it("moves focus to the restored check's row once the page re-reads", async () => {
    const user = userEvent.setup()
    const h = overviewHandlers()
    const { rerender } = render(
      <AmenitiesOverview
        view={view()}
        catalogue={CATALOGUE}
        basePath={BASE}
        handlers={h}
      />
    )
    const archived = screen.getByRole("region", { name: /Archived/ })
    await user.click(
      within(archived).getByRole("button", { name: UI_TEXT.restore })
    )
    expect(h.restore).toHaveBeenCalled()
    const back = { ...ARCHIVED, status: "active" as const }
    rerender(
      <AmenitiesOverview
        view={view({
          active: [...view().active, back],
          archived: [],
        })}
        catalogue={CATALOGUE}
        basePath={BASE}
        handlers={h}
      />
    )
    expect(document.activeElement?.textContent).toBe(ARCHIVED.entry.question)
    expect(document.activeElement?.tagName).toBe("A")
  })

  it("focuses the notice when the restore didn't land", async () => {
    const user = userEvent.setup()
    const h = overviewHandlers({
      restore: vi.fn(
        async (): Promise<AmenityFailure> =>
          ({
            ok: false,
            code: "unavailable",
            status: 503,
            message: "Amenities are unavailable.",
          }) as AmenityFailure
      ),
    })
    render(
      <AmenitiesOverview
        view={view()}
        catalogue={CATALOGUE}
        basePath={BASE}
        handlers={h}
      />
    )
    await user.click(screen.getByRole("button", { name: UI_TEXT.restore }))
    await screen.findByText("Amenities are unavailable.")
    expect(document.activeElement?.getAttribute("role")).toBe("status")
  })
})

describe("catalogue picker (MG-19, MG-20)", () => {
  it("makes the whole row the label, named by its question", async () => {
    const user = userEvent.setup()
    render(
      <CataloguePicker
        open
        onOpenChange={() => {}}
        options={CATALOGUE}
        venueName="TEST Venue"
        onAdd={vi.fn(async () => ({ ok: true as const }))}
      />
    )
    const option = CATALOGUE.find((o) => !o.existing)!
    const box = screen.getByRole("checkbox", { name: option.question })
    expect(box.closest("label")?.className).toMatch(/min-h-14/)
    await user.click(screen.getByText(option.captureBrief))
    expect((box as HTMLInputElement).checked).toBe(true)
    // The search keeps its 44px height at every width.
    expect(
      screen.getByRole("searchbox", { name: "Search the catalogue" }).className
    ).not.toMatch(/md:h-9/)
  })
})

describe("tab badges (UP-18, MG-24, HM-21, HM-22)", () => {
  it("caps a two-digit count at 9+ and still reads the number", () => {
    render(
      <a href="/x">
        Home
        <TabBadge count={12} label="things to do" />
      </a>
    )
    const link = screen.getByRole("link", { name: /^Home\W+12 things to do$/ })
    expect(within(link).getByText("9+")).toBeTruthy()
  })

  it("shows the To do count on the desktop Home link too", () => {
    render(
      <AppShell variant="staff" active="people" todoCount={3}>
        x
      </AppShell>
    )
    const bars = screen.getAllByRole("navigation", { name: "Staff" })
    expect(bars).toHaveLength(2)
    for (const bar of bars)
      expect(within(bar).getAllByRole("link")[0].textContent).toMatch(
        /^Home.*3 things to do$/
      )
  })

  it("says couldn't check, not nothing, when To do couldn't be read", () => {
    render(
      <AppShell variant="staff" active="people" todoUnknown>
        x
      </AppShell>
    )
    const homes = screen.getAllByRole("link", { name: /^Home/ })
    expect(homes.length).toBe(2)
    for (const home of homes) {
      expect(home.textContent).toContain("?")
      expect(home.textContent).toContain("couldn't check")
    }
  })

  it("caps the manager's tab bar badge", () => {
    render(
      <ManagerShell venueName="The Railway" userName="Mina" reviewCount={23}>
        x
      </ManagerShell>
    )
    const bar = screen
      .getAllByRole("navigation", { name: "Venue workspace" })
      .find((el) => el.dataset.slot === "tabbar")!
    const review = within(bar).getByRole("link", { name: /^Review/ })
    expect(within(review).getByText("9+")).toBeTruthy()
    expect(review.textContent).toContain("23")
  })
})

describe("manager venue name (MG-23)", () => {
  it("wraps to two lines and carries the full name", () => {
    const name =
      "The Very Long Named Railway Tavern and Kitchen at the Old Station Yard"
    const { container } = render(
      <ManagerShell venueName={name} userName="Mina">
        x
      </ManagerShell>
    )
    const venue = container.querySelector<HTMLElement>(
      '[data-slot="venue-name"]'
    )!
    expect(venue.getAttribute("title")).toBe(name)
    expect(venue.className).toMatch(/line-clamp-2/)
    expect(venue.className).not.toMatch(/\btruncate\b/)
  })
})
