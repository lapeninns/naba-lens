// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import LoginError from "@/app/login/error"
import { LoginCard } from "@/components/nabalens/login-card"

afterEach(cleanup)

describe("sign-in recovery screens", () => {
  it("an expired link asks for the email instead of promising 'this email' (S-A3)", () => {
    render(<LoginCard onSubmit={vi.fn()} linkExpired />)
    expect(
      screen.getByRole("heading", { name: "That sign-in link has expired" })
    ).toBeTruthy()
    expect(
      screen.getByText(
        "Links work once and expire after a short time. Enter your email and we'll send a new one."
      )
    ).toBeTruthy()
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("")
  })

  it("a sign-in page that fails to load keeps the frame and offers Try again (S-A5)", async () => {
    const retry = vi.fn()
    render(<LoginError retry={retry} />)
    expect(screen.getByText("Naba-Lens")).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "Sign-in couldn't load" })
    ).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
