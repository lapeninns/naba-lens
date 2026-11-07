// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
// A native select stands in for the Base UI one, so a section can be chosen
// under fake timers.
vi.mock("@/components/nabalens/option-select", () => ({
  OptionSelect: ({
    id,
    options,
    value,
    emptyLabel,
    onValueChange,
  }: {
    id?: string
    options: { id: string; name: string }[]
    value: string | null
    emptyLabel?: string
    onValueChange: (value: string | null) => void
  }) => (
    <select
      id={id}
      value={value ?? ""}
      onChange={(event) => onValueChange(event.currentTarget.value || null)}
    >
      <option value="">{emptyLabel}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  ),
}))

import { MenuFilters } from "@/components/nabalens/manager/menu/menu-filters"
import type { MenuFilter } from "@/components/nabalens/manager/menu/menu-query"
import type { ManagerOverview } from "@/lib/server/menu-photos/types"

const STARTERS = "00000000-0000-4000-8000-0000000000b1"
const MAINS = "00000000-0000-4000-8000-0000000000b2"
const NO_FILTER: MenuFilter = { status: null, sectionId: null, query: "" }

const overview = {
  eligible: 3,
  needsPhotoItems: 1,
  awaitingReviewItems: 1,
  covered: 1,
  replacementPendingItems: 1,
  needsRecheckItems: 1,
  sections: [
    { sectionId: STARTERS, name: "Starters" },
    { sectionId: MAINS, name: "Mains" },
  ],
} as unknown as ManagerOverview

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  router.replace.mockClear()
})

function type(value: string) {
  fireEvent.change(screen.getByRole("searchbox", { name: "Search items" }), {
    target: { value },
  })
}

describe("Menu search debounce", () => {
  it("a status chosen while a search waits is kept when the search lands", () => {
    const view = render(<MenuFilters filter={NO_FILTER} overview={overview} />)
    type("soup")
    // The status link navigates; the page re-renders with the new filter.
    view.rerender(
      <MenuFilters
        filter={{ ...NO_FILTER, status: "covered" }}
        overview={overview}
      />
    )
    act(() => vi.advanceTimersByTime(300))
    expect(router.replace).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenLastCalledWith(
      "/manager/menu?status=covered&q=soup",
      { scroll: false }
    )
  })

  it("a section chosen while a search waits applies both in one navigation", () => {
    const view = render(
      <MenuFilters
        filter={{ ...NO_FILTER, status: "needs_photo" }}
        overview={overview}
      />
    )
    type("pie")
    fireEvent.change(screen.getByLabelText("Section"), {
      target: { value: MAINS },
    })
    expect(router.replace).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenLastCalledWith(
      `/manager/menu?status=needs_photo&section=${MAINS}&q=pie`,
      { scroll: false }
    )
    view.rerender(
      <MenuFilters
        filter={{ status: "needs_photo", sectionId: MAINS, query: "pie" }}
        overview={overview}
      />
    )
    act(() => vi.advanceTimersByTime(300))
    expect(router.replace).toHaveBeenCalledTimes(1)
  })

  it("a section change with no search waiting keeps the applied query", () => {
    render(
      <MenuFilters
        filter={{ ...NO_FILTER, query: "pie" }}
        overview={overview}
      />
    )
    fireEvent.change(screen.getByLabelText("Section"), {
      target: { value: STARTERS },
    })
    expect(router.replace).toHaveBeenLastCalledWith(
      `/manager/menu?section=${STARTERS}&q=pie`,
      { scroll: false }
    )
  })
})
