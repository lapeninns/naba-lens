// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({}) }))

import { LoginCardHost } from "@/app/login/login-card-host"

afterEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  cleanup()
})

async function send(returnTo: string | null) {
  const onSubmit = vi.fn().mockResolvedValue({})
  render(<LoginCardHost onSubmit={onSubmit} returnTo={returnTo} />)
  await userEvent.type(screen.getByLabelText("Email"), "chef@example.test")
  await userEvent.click(
    screen.getByRole("button", { name: "Send sign-in link" })
  )
  await screen.findByRole("heading", { name: "Check your email" })
  return onSubmit
}

describe("login card host: return path", () => {
  it("sends the page to return to with the link request", async () => {
    const onSubmit = await send("/manager/review?status=pending")
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      "chef@example.test",
      undefined,
      "/manager/review?status=pending"
    )
  })

  it("sends none on a plain sign-in, so an earlier one is forgotten", async () => {
    const onSubmit = await send(null)
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      "chef@example.test",
      undefined,
      undefined
    )
  })
})
