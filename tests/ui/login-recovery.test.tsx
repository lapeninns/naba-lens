// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import AuthError from "@/app/auth/error"
import LoginError from "@/app/login/error"
import LoginLoading from "@/app/login/loading"
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

  it("a sign-in page that fails to load keeps the frame and offers Retry (S-A5, decision 11)", async () => {
    const retry = vi.fn()
    render(<LoginError retry={retry} />)
    expect(screen.getByText("Naba-Lens")).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "Sign-in couldn't load" })
    ).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it("/auth shares the boundary and moves focus to what failed (R6)", async () => {
    const retry = vi.fn()
    render(<AuthError retry={retry} />)
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Sign-in couldn't load",
    })
    expect(document.activeElement).toBe(heading)
    expect(screen.getByRole("alert").textContent).toContain("retry")
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it("/login loading keeps the name and says what is loading (R6)", () => {
    render(<LoginLoading />)
    expect(screen.getByText("Naba-Lens")).toBeTruthy()
    expect(screen.getByRole("status").textContent).toBe("Loading sign-in…")
  })

  it("the code step's back link returns to the email step, not a reload (R6)", async () => {
    render(<LoginCard onSubmit={vi.fn(async () => {})} />)
    // Focus starts in the field (handoff "Email").
    expect(document.activeElement).toBe(screen.getByLabelText("Email"))
    await userEvent.type(screen.getByLabelText("Email"), "sam@example.com")
    await userEvent.click(
      screen.getByRole("button", { name: "Send sign-in link" })
    )
    const back = await screen.findByRole("link", {
      name: "Use a different email",
    })
    expect(back.getAttribute("href")).toBe("/login")
    await userEvent.click(back)
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText("Email"))
  })

  it("an invalid email moves focus to the field that names the error", async () => {
    render(<LoginCard onSubmit={vi.fn()} />)
    await userEvent.click(
      screen.getByRole("button", { name: "Send sign-in link" })
    )
    const field = screen.getByLabelText("Email")
    expect(document.activeElement).toBe(field)
    const describedBy = field.getAttribute("aria-describedby")
    expect(
      describedBy && document.getElementById(describedBy)?.textContent
    ).toContain("Enter a full email address")
  })
})
