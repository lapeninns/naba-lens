// @vitest-environment jsdom
// B05-06 SS-3 (R12): "Where it's used" shows only for In use and only while a
// place of use is registered.
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { EMPTY_SEARCH_FILTERS } from "@/app/_media/search-params"
import { SEARCH_COPY } from "@/components/nabalens/search/search-copy"
import { SearchFilters } from "@/components/nabalens/search/search-filters"
import type { SearchOption } from "@/components/nabalens/search/types"

afterEach(cleanup)

function Filters({
  destinations,
  rights = "in_force",
}: {
  destinations: SearchOption[]
  rights?: string | null
}) {
  return (
    <SearchFilters
      mode="manager"
      value={{ ...EMPTY_SEARCH_FILTERS, rights }}
      onChange={() => {}}
      venues={[]}
      menuOptions={{ venueId: "v", items: [] }}
      destinations={destinations}
      fieldErrors={{}}
      onClear={() => {}}
    />
  )
}

const destination = () =>
  screen.queryByRole("combobox", {
    name: SEARCH_COPY.destination,
    hidden: true,
  })

describe("Where it's used (SS-3)", () => {
  it("is hidden while no place of use is registered", () => {
    render(<Filters destinations={[]} />)
    expect(destination()).toBeNull()
    expect(screen.queryByText(SEARCH_COPY.destination)).toBeNull()
  })

  it("shows once one place is registered", () => {
    render(<Filters destinations={[{ id: "web", name: "Website" }]} />)
    expect(destination()).not.toBeNull()
  })

  it("is hidden for any use other than In use", () => {
    render(
      <Filters
        rights="not_granted"
        destinations={[{ id: "web", name: "Website" }]}
      />
    )
    expect(destination()).toBeNull()
  })
})
