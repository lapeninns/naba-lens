// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

const themes = vi.hoisted(() => ({
  theme: "system" as string | undefined,
  setTheme: vi.fn(),
}))
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: themes.theme, setTheme: themes.setTheme }),
}))

import {
  THEME_SETTING_COPY,
  ThemeSetting,
} from "@/components/nabalens/theme-setting"

afterEach(() => {
  cleanup()
  themes.theme = "system"
  themes.setTheme.mockClear()
})

function checked() {
  return screen
    .getAllByRole("radio")
    .filter((radio) => radio.getAttribute("aria-checked") === "true")
    .map((radio) => radio.textContent)
}

describe("ThemeSetting", () => {
  it("is a named group of three choices with the help text as its description", () => {
    render(<ThemeSetting />)
    const group = screen.getByRole("radiogroup", { name: "Appearance" })
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.textContent)
    ).toEqual(["System", "Light", "Dark"])
    expect(screen.getByRole("heading", { level: 2, name: "Appearance" })).toBe(
      document.getElementById(group.getAttribute("aria-labelledby") ?? "")
    )
    expect(
      document.getElementById(group.getAttribute("aria-describedby") ?? "")
        ?.textContent
    ).toBe(THEME_SETTING_COPY.help)
  })

  it("shows the stored choice once it is known", () => {
    render(<ThemeSetting />)
    expect(checked()).toEqual(["System"])
    cleanup()
    themes.theme = "dark"
    render(<ThemeSetting />)
    expect(checked()).toEqual(["Dark"])
  })

  it("choosing an option sets that theme", async () => {
    const user = userEvent.setup()
    render(<ThemeSetting />)
    await user.click(screen.getByRole("radio", { name: "Dark" }))
    expect(themes.setTheme).toHaveBeenCalledWith("dark")
    await user.click(screen.getByRole("radio", { name: "Light" }))
    expect(themes.setTheme).toHaveBeenLastCalledWith("light")
  })

  it("arrow keys move the choice, as in any radio group", async () => {
    const user = userEvent.setup()
    render(<ThemeSetting />)
    screen.getByRole<HTMLInputElement>("radio", { name: "System" }).focus()
    await user.keyboard("{ArrowRight}")
    expect(themes.setTheme).toHaveBeenCalledWith("light")
  })

  it("server markup has all three options and none selected", () => {
    themes.theme = "dark"
    const html = renderToString(<ThemeSetting layout="card" />)
    expect(html.match(/role="radio"/g)).toHaveLength(3)
    expect(html).not.toMatch(/\schecked(=|\s|\/|>)/)
    expect(html).not.toContain('aria-checked="true"')
  })

  it("the card layout keeps the heading, control and help in one card", () => {
    render(<ThemeSetting layout="card" />)
    const card = screen.getByRole("region", { name: "Appearance" })
    expect(card.className).toContain("rounded-card")
    expect(within(card).getByRole("radiogroup")).toBeTruthy()
    expect(within(card).getByText(THEME_SETTING_COPY.help)).toBeTruthy()
  })
})
