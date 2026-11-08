// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppShell } from "@/components/nabalens/app-shell"

afterEach(cleanup)

const formOf = (container: HTMLElement) =>
  container.querySelector<HTMLFormElement>("form[data-logout]")

describe("AppShell Log out works after the session has ended", () => {
  it.each([
    [
      "staff",
      <AppShell key="s" variant="staff" active="tasks">
        x
      </AppShell>,
    ],
    [
      "admin",
      <AppShell key="a" variant="admin" active="content">
        x
      </AppShell>,
    ],
  ])(
    "%s: posts the form to /auth/logout, never a Server Action",
    (_, shell) => {
      const { container } = render(shell)
      const form = formOf(container)!
      expect(form.getAttribute("action")).toBe("/auth/logout")
      expect(form.getAttribute("method")).toBe("post")
      const button = within(form).getByRole("button", { name: "Log out" })
      expect(button.getAttribute("type")).toBe("submit")
    }
  )

  it("takes no Server Action for Log out any more", () => {
    const { container } = render(
      // @ts-expect-error Log out always posts /auth/logout.
      <AppShell variant="admin" active="staff" logoutAction={async () => {}}>
        x
      </AppShell>
    )
    expect(formOf(container)?.getAttribute("action")).toBe("/auth/logout")
  })

  it("previews keep their own handler and no form", () => {
    const onLogout = vi.fn()
    const { container, getByRole } = render(
      <AppShell variant="admin" active="content" onLogout={onLogout}>
        x
      </AppShell>
    )
    expect(formOf(container)).toBeNull()
    getByRole("button", { name: "Log out" }).click()
    expect(onLogout).toHaveBeenCalledOnce()
  })
})
