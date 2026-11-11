// @vitest-environment jsdom
// B05-06 search screen review repairs (R2, R6, R8): Try again and Reload keep
// focus on the screen, the first invalid control that exists takes focus, and
// a bad media type's pill shows the value given.
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/manager/search",
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh }),
}))
// The Next error boundary needs the app router; the list's own cases are what
// these tests are about.
vi.mock("next/error", () => ({
  catchError:
    () =>
    ({ children }: { children: React.ReactNode }) =>
      children,
}))
vi.mock("@/app/_media/fetch-search-page", () => ({
  fetchSearchPage: vi.fn(),
}))

import { EMPTY_SEARCH_FILTERS } from "@/app/_media/search-params"
import { SEARCH_COPY } from "@/components/nabalens/search/search-copy"
import {
  SearchView,
  filterPills,
} from "@/components/nabalens/search/search-view"
import type { SearchPageResult } from "@/components/nabalens/search/types"

afterEach(() => {
  cleanup()
  nav.replace.mockReset()
  nav.refresh.mockReset()
})

const NOW = "2026-11-11T12:00:00.000Z"

function settled(value: SearchPageResult): Promise<SearchPageResult> {
  return Object.assign(Promise.resolve(value), {
    status: "fulfilled",
    value,
  })
}

function View({
  page,
  filters = {},
}: {
  page: SearchPageResult
  filters?: Partial<typeof EMPTY_SEARCH_FILTERS>
}) {
  return (
    <SearchView
      mode="manager"
      venueName="Venue A"
      venues={[]}
      menuOptions={{ venueId: "v", items: [] }}
      destinations={[]}
      filters={{ ...EMPTY_SEARCH_FILTERS, ...filters }}
      initialPage={settled(page)}
      now={NOW}
    />
  )
}

const heading = () => screen.getByRole("heading", { name: "Results" })
const statusLine = () =>
  document.querySelector(
    'section[aria-labelledby="search-results-heading"] > p[role="status"]'
  )

describe("focus after Try again and Reload (R6)", () => {
  it("Try again moves focus to the Results heading", async () => {
    render(
      <View
        page={{ ok: false, status: 503, code: "unavailable", message: "" }}
      />
    )
    await userEvent.click(
      screen.getByRole("button", { name: SEARCH_COPY.tryAgain })
    )
    await act(async () => {})
    expect(nav.refresh).toHaveBeenCalled()
    expect(document.activeElement).toBe(heading())
  })

  it("Reload moves focus to the Results heading", async () => {
    render(
      <View
        filters={{ venue: "other" }}
        page={{
          ok: false,
          status: 403,
          code: "not_permitted",
          message: SEARCH_COPY.wrongVenue,
        }}
      />
    )
    await userEvent.click(
      screen.getByRole("button", { name: SEARCH_COPY.reload })
    )
    await act(async () => {})
    expect(nav.replace).toHaveBeenCalled()
    expect(document.activeElement).toBe(heading())
  })
})

describe("focus on the first invalid control that exists (R8)", () => {
  const invalid = (fieldErrors: Record<string, string>): SearchPageResult => ({
    ok: false,
    status: 400,
    code: "invalid_input",
    message: "",
    fieldErrors,
  })

  it("a bad media type focuses the Photo or video group", async () => {
    render(
      <View
        filters={{ mediaType: "gif" }}
        page={invalid({ mediaType: "Choose photo or video." })}
      />
    )
    await act(async () => {})
    const focused = document.activeElement as HTMLInputElement
    expect(focused.type).toBe("radio")
    expect(focused.name).toBe("search-mediaType")
  })

  it("a variant error with no Option control falls back to the error summary", async () => {
    render(
      <View
        filters={{ item: "x", variant: "y" }}
        page={invalid({ variant: "Not an option of this item." })}
      />
    )
    await act(async () => {})
    expect(document.activeElement?.textContent).toContain(
      SEARCH_COPY.checkFilters
    )
  })

  it("a filter with no control (submission) falls back to the error summary", async () => {
    render(
      <View
        filters={{ submission: "bad" }}
        page={invalid({ submission: "Not a submission." })}
      />
    )
    await act(async () => {})
    expect(document.activeElement?.textContent).toContain(
      SEARCH_COPY.checkFilters
    )
  })

  it("says the summary through the one status region", async () => {
    render(
      <View
        filters={{ submission: "bad" }}
        page={invalid({ submission: "Not a submission." })}
      />
    )
    await act(async () => {})
    expect(statusLine()?.textContent).toBe(SEARCH_COPY.checkFilters)
  })
})

describe("the empty outcome is said (R2)", () => {
  it("says the first-use empty title in the status region", async () => {
    render(<View page={{ ok: true, page: { items: [], nextCursor: null } }} />)
    await act(async () => {})
    expect(statusLine()?.textContent).toBe(SEARCH_COPY.emptyManager("Venue A"))
  })

  it("says the filtered empty title when filters are on", async () => {
    render(
      <View
        filters={{ mediaType: "video" }}
        page={{ ok: true, page: { items: [], nextCursor: null } }}
      />
    )
    await act(async () => {})
    expect(statusLine()?.textContent).toBe(SEARCH_COPY.emptyFiltered)
  })
})

describe("filter pills (R8)", () => {
  const pills = (mediaType: string) =>
    filterPills(
      { ...EMPTY_SEARCH_FILTERS, mediaType },
      {
        mode: "manager",
        venues: [],
        menuOptions: null,
        destinations: [],
        now: new Date(NOW),
      }
    ).map((p) => p.text)

  it("names photos and videos, and shows any other value as given", () => {
    expect(pills("image")).toEqual([SEARCH_COPY.mediaPhotos])
    expect(pills("video")).toEqual([SEARCH_COPY.mediaVideos])
    expect(pills("gif")).toEqual(["gif"])
  })
})
