// @vitest-environment jsdom
// Today's retake row (DESIGN.md §5c step 3): a retake opens the gallery for
// the same dish and variant the reviewer asked again for.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const add = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock("@/components/nabalens/shell/add-context", () => ({
  useAdd: () => add.open,
}))

import { HomeRetakes } from "@/components/nabalens/home/home-retakes"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("HomeRetakes", () => {
  it("presets the reviewed variant, not just the dish", () => {
    render(
      <HomeRetakes
        canAdd
        retakes={[
          {
            itemId: "momo",
            itemName: "Momo",
            variantId: "veg",
            variantName: "Veg",
            reason: "Too dark",
          },
        ]}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /Momo/ }))
    expect(add.open).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: {
          itemId: "momo",
          variantId: "veg",
          itemName: "Momo",
          variantName: "Veg",
        },
      })
    )
  })

  it("opens nothing when the person can't add", () => {
    render(
      <HomeRetakes
        canAdd={false}
        retakes={[{ itemId: "momo", itemName: "Momo", reason: null }]}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /Momo/ }))
    expect(add.open).not.toHaveBeenCalled()
  })
})
