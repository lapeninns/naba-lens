// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ContributeCard } from "@/components/nabalens/home/contribute-card"
import {
  NO_MENU_COPY,
  OurMenuCard,
} from "@/components/nabalens/home/our-menu-card"
import {
  AddProvider,
  type OpenAddOptions,
} from "@/components/nabalens/shell/add-context"
import { homePrompt } from "@/lib/config/work-roles"

afterEach(cleanup)

describe("ContributeCard", () => {
  it("asks the role's question and opens the library first, then the camera", () => {
    const openAdd = vi.fn<(opts?: OpenAddOptions) => void>()
    render(
      <AddProvider value={{ openAdd }}>
        <ContributeCard prompt={homePrompt("bartender")} blocked={null} />
      </AddProvider>
    )
    expect(
      screen.getByRole("heading", {
        name: "What did you make at the bar today?",
      })
    ).toBeTruthy()
    const buttons = screen.getAllByRole("button")
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Choose from your photos",
      "Take a photo",
    ])
    fireEvent.click(buttons[0])
    expect(openAdd).toHaveBeenLastCalledWith({ source: "library" })
    fireEvent.click(buttons[1])
    expect(openAdd).toHaveBeenLastCalledWith({ source: "camera" })
  })

  it("uses the general question without a role", () => {
    render(<ContributeCard prompt={homePrompt(null)} blocked={null} />)
    expect(
      screen.getByRole("heading", {
        name: "What did you make or capture today?",
      })
    ).toBeTruthy()
    // Outside the staff layout it links to Me instead.
    expect(
      screen
        .getByRole("link", { name: "Choose from your photos" })
        .getAttribute("href")
    ).toBe("/staff")
  })

  it("explains why photos can't be added instead of offering the pickers", () => {
    render(
      <AddProvider value={{ openAdd: vi.fn() }}>
        <ContributeCard
          prompt={homePrompt(null)}
          blocked="You can't add photos until an admin assigns your venue."
        />
      </AddProvider>
    )
    expect(
      screen.getByText(
        "You can't add photos until an admin assigns your venue."
      )
    ).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
    // The guide stays reachable while adding is paused.
    expect(
      screen
        .getByRole("link", { name: "How to photograph a dish" })
        .getAttribute("href")
    ).toBe("/staff/tasks/guide")
  })

  it("links to the photo guide next to the pickers", () => {
    render(
      <AddProvider value={{ openAdd: vi.fn() }}>
        <ContributeCard prompt={homePrompt("head_chef")} blocked={null} />
      </AddProvider>
    )
    expect(
      screen
        .getByRole("link", { name: "How to photograph a dish" })
        .getAttribute("href")
    ).toBe("/staff/tasks/guide")
  })
})

describe("OurMenuCard", () => {
  it("shows menu items with an accepted photo and the way to browse", () => {
    render(
      <OurMenuCard
        progress={{ state: "ready", covered: 7, total: 30 }}
        venueName="TEST Inn"
      />
    )
    expect(screen.getByRole("heading", { name: "Our menu" })).toBeTruthy()
    expect(
      screen.getByText("Menu items with an accepted photo at TEST Inn")
    ).toBeTruthy()
    expect(
      screen.getByRole("progressbar", {
        name: "7 of 30 menu items have an accepted photo",
      })
    ).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "Browse our menu" }).getAttribute("href")
    ).toBe("/staff/menu")
    // Not the monthly target's words.
    expect(screen.queryByText(/target|task/i)).toBeNull()
  })

  it("says when the venue has no menu yet", () => {
    render(<OurMenuCard progress={{ state: "no_menu" }} venueName="TEST Inn" />)
    expect(screen.getByText(NO_MENU_COPY)).toBeTruthy()
    expect(NO_MENU_COPY).toBe(
      "Menu photos will appear once your venue’s menu is set up"
    )
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("has distinct empty and unavailable states", () => {
    render(<OurMenuCard progress={{ state: "empty" }} venueName={null} />)
    expect(
      screen.getByText("The active menu has no dishes or drinks yet.")
    ).toBeTruthy()
    cleanup()
    render(<OurMenuCard progress={{ state: "unavailable" }} venueName={null} />)
    expect(screen.getByRole("status").textContent).toContain(
      "Menu photos can't be shown right now."
    )
    expect(screen.queryByRole("link")).toBeNull()
  })
})
