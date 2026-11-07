// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LoginCard } from "@/components/nabalens/login-card"
import {
  DIFFERENT_ACCOUNT_MESSAGE,
  SignInAgainSheet,
  type SessionGuard,
} from "@/components/nabalens/session-guard"
import {
  RESEND_COOLDOWN_SECONDS,
  SignInCodeStep,
} from "@/components/nabalens/sign-in-code-step"
import { LoginCardHost } from "@/app/login/login-card-host"
import {
  normaliseSignInCode,
  SIGN_IN_CODE_FORMAT_MESSAGE,
  SIGN_IN_CODE_INVALID_MESSAGE,
} from "@/lib/auth/magic-link"

// Each mounted challenge hands over a fresh single-use token.
let challengeMounts = 0
vi.mock("@/components/nabalens/turnstile-challenge", async () => {
  const React = await import("react")
  return {
    TurnstileChallenge: ({
      onToken,
    }: {
      onToken: (token: string | null) => void
    }) => {
      React.useEffect(() => {
        challengeMounts += 1
        onToken(`token-${challengeMounts}`)
      }, [onToken])
      return null
    },
  }
})

// The browser client LoginCardHost checks codes with.
const browser = vi.hoisted(() => ({ verifyOtp: vi.fn() }))
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({ auth: { verifyOtp: browser.verifyOtp } }),
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  challengeMounts = 0
  // Sent-email memory (cooldowns, the waiting request) is per tab.
  window.sessionStorage.clear()
})

const EMAIL = "priya.gurung@example.test"
const codeField = () =>
  screen.getByLabelText("Sign-in code") as HTMLInputElement
const resendButton = () =>
  screen.getByRole("button", { name: "Send a new code" }) as HTMLButtonElement

function renderStep(
  props: Partial<React.ComponentProps<typeof SignInCodeStep>> = {}
) {
  const onVerify = vi.fn<(code: string) => Promise<void>>(async () => {})
  const onResend = vi.fn<(token?: string) => Promise<void>>(async () => {})
  const onChangeEmail = vi.fn()
  render(
    <SignInCodeStep
      sentAt={Date.now()}
      onVerify={onVerify}
      onResend={onResend}
      onChangeEmail={onChangeEmail}
      {...props}
    />
  )
  return { onVerify, onResend, onChangeEmail }
}

describe("normaliseSignInCode", () => {
  it("keeps only the digits and needs a whole code", () => {
    expect(normaliseSignInCode(" 123 456 ")).toBe("123456")
    expect(normaliseSignInCode("123-456")).toBe("123456")
    expect(normaliseSignInCode("12345678")).toBe("12345678")
    expect(normaliseSignInCode("12345")).toBeNull()
    expect(normaliseSignInCode("12345678901")).toBeNull()
    expect(normaliseSignInCode(123456)).toBeNull()
  })
})

describe("SignInCodeStep", () => {
  it("is one labelled field the phone can fill from the email", () => {
    renderStep()
    const input = codeField()
    expect(input.getAttribute("autocomplete")).toBe("one-time-code")
    expect(input.getAttribute("inputmode")).toBe("numeric")
    expect(input.getAttribute("pattern")).toBe("[0-9]*")
    expect(input.getAttribute("type")).toBe("text")
  })

  it("strips everything but digits when typing and pasting", async () => {
    const user = userEvent.setup()
    const { onVerify } = renderStep()
    await user.type(codeField(), "12 ab-34")
    expect(codeField().value).toBe("1234")

    await user.clear(codeField())
    await user.click(codeField())
    await user.paste("Your code: 654 321.")
    expect(codeField().value).toBe("654321")

    await user.click(screen.getByRole("button", { name: "Sign in with code" }))
    expect(onVerify).toHaveBeenCalledExactlyOnceWith("654321")
    expect(
      await screen.findByRole("button", { name: "Signing in…" })
    ).toBeTruthy()
  })

  it("asks for the whole code without checking a part one", async () => {
    const user = userEvent.setup()
    const { onVerify } = renderStep()
    await user.type(codeField(), "123")
    await user.click(screen.getByRole("button", { name: "Sign in with code" }))
    expect(onVerify).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toBe(
      SIGN_IN_CODE_FORMAT_MESSAGE
    )
  })

  it("announces a refused code, ties it to the field and keeps focus there", async () => {
    const user = userEvent.setup()
    const onVerify = vi.fn(async () => ({
      error: SIGN_IN_CODE_INVALID_MESSAGE,
    }))
    renderStep({ onVerify })
    await user.type(codeField(), "111111")
    await user.click(screen.getByRole("button", { name: "Sign in with code" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe(SIGN_IN_CODE_INVALID_MESSAGE)
    expect(codeField().getAttribute("aria-invalid")).toBe("true")
    expect(codeField().getAttribute("aria-describedby")).toBe(alert.id)
    expect(document.activeElement).toBe(codeField())
    // The person can correct it and try again.
    expect(
      (
        screen.getByRole("button", {
          name: "Sign in with code",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  })

  it("waits before a new code can be sent, then sends one with a fresh challenge", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { onResend } = renderStep({ captchaSiteKey: "site-key" })
    expect(resendButton().disabled).toBe(true)
    expect(
      screen.getByText(
        `You can ask for a new one in ${RESEND_COOLDOWN_SECONDS} seconds.`
      )
    ).toBeTruthy()
    // No challenge is spent while the wait runs.
    expect(challengeMounts).toBe(0)

    await act(async () => vi.advanceTimersByTime(30_000))
    expect(
      screen.getByText("You can ask for a new one in 30 seconds.")
    ).toBeTruthy()
    await act(async () => vi.advanceTimersByTime(30_000))
    await waitFor(() => expect(resendButton().disabled).toBe(false))
    expect(challengeMounts).toBe(1)

    await user.type(codeField(), "12")
    await user.click(resendButton())
    expect(onResend).toHaveBeenCalledExactlyOnceWith("token-1")
    expect((await screen.findByRole("status")).textContent).toMatch(
      /^New link and code sent at \d\d:\d\d\. Use the newest sign-in email you have\. Older ones may stop working\.$/
    )
    // The old digits are cleared and the wait starts again.
    expect(codeField().value).toBe("")
    expect(resendButton().disabled).toBe(true)

    await act(async () =>
      vi.advanceTimersByTime(RESEND_COOLDOWN_SECONDS * 1000)
    )
    await waitFor(() => expect(resendButton().disabled).toBe(false))
    // A new widget, so the second request carries a new token.
    expect(challengeMounts).toBe(2)
    await user.click(resendButton())
    expect(onResend).toHaveBeenLastCalledWith("token-2")
  })

  it("shows a refused resend and still gets a fresh challenge", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onResend = vi.fn(async () => ({ error: "Try verification again." }))
    renderStep({
      onResend,
      captchaSiteKey: "site-key",
      sentAt: Date.now() - RESEND_COOLDOWN_SECONDS * 1000,
    })
    await waitFor(() => expect(resendButton().disabled).toBe(false))
    await user.click(resendButton())
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Try verification again."
    )
    await waitFor(() => expect(challengeMounts).toBe(2))
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("goes back to change the email", async () => {
    const user = userEvent.setup()
    const { onChangeEmail } = renderStep()
    await user.click(
      screen.getByRole("button", { name: "Use a different email" })
    )
    expect(onChangeEmail).toHaveBeenCalledOnce()
  })
})

describe("LoginCard with a sign-in code", () => {
  async function sendTo(
    email: string,
    props: Partial<React.ComponentProps<typeof LoginCard>> = {}
  ) {
    const onSubmit = vi.fn(async () => {})
    const onVerifyCode = vi.fn(async () => ({ ok: true as const }))
    const user = userEvent.setup()
    render(
      <LoginCard onSubmit={onSubmit} onVerifyCode={onVerifyCode} {...props} />
    )
    await user.type(screen.getByLabelText("Email"), email)
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }))
    await screen.findByRole("heading", { name: "Check your email" })
    return { user, onSubmit, onVerifyCode }
  }

  it("verifies the code for the email it was sent to, then loads the home page", async () => {
    const assign = vi.fn()
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      assign,
    })
    const { user, onVerifyCode } = await sendTo(` ${EMAIL} `)
    expect(
      screen.getByText(/enter the code from the same email here/)
    ).toBeTruthy()
    await user.type(codeField(), "123 456")
    await user.click(screen.getByRole("button", { name: "Sign in with code" }))
    expect(onVerifyCode).toHaveBeenCalledExactlyOnceWith(EMAIL, "123456")
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"))
  })

  it("shows the server's answer for a refused code and stays on the step", async () => {
    const onVerifyCode = vi.fn(async () => ({
      error: SIGN_IN_CODE_INVALID_MESSAGE,
    }))
    const { user } = await sendTo(EMAIL, { onVerifyCode })
    await user.type(codeField(), "123456")
    await user.click(screen.getByRole("button", { name: "Sign in with code" }))
    expect((await screen.findByRole("alert")).textContent).toBe(
      SIGN_IN_CODE_INVALID_MESSAGE
    )
    expect(
      screen.getByRole("heading", { name: "Check your email" })
    ).toBeTruthy()
  })

  it("Use a different email returns to the email field with the email kept", async () => {
    const { user } = await sendTo(EMAIL)
    await user.click(
      screen.getByRole("button", { name: "Use a different email" })
    )
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy()
    const email = screen.getByLabelText("Email") as HTMLInputElement
    expect(email.value).toBe(EMAIL)
    await waitFor(() => expect(document.activeElement).toBe(email))
  })

  it("does not send again for the same email inside the wait after changing it", async () => {
    const { user, onSubmit } = await sendTo(EMAIL)
    await user.click(
      screen.getByRole("button", { name: "Use a different email" })
    )
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }))
    await screen.findByRole("heading", { name: "Check your email" })
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(resendButton().disabled).toBe(true)
    // Neutral wording: a dropped resend never claims earlier codes are dead.
    expect(document.body.textContent).not.toContain(
      "earlier links and codes stop working"
    )
  })

  it("comes back to the code step after a reload instead of sending again", async () => {
    const { onSubmit } = await sendTo(EMAIL)
    cleanup()
    const again = vi.fn(async () => {})
    render(
      <LoginCard
        onSubmit={again}
        onVerifyCode={vi.fn(async () => ({ ok: true as const }))}
      />
    )
    await screen.findByRole("heading", { name: "Check your email" })
    expect(screen.getByText(EMAIL)).toBeTruthy()
    expect(codeField()).toBeTruthy()
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(again).not.toHaveBeenCalled()
  })

  it("starts from the email form after Use a different email and a reload", async () => {
    const { user } = await sendTo(EMAIL)
    await user.click(
      screen.getByRole("button", { name: "Use a different email" })
    )
    cleanup()
    render(
      <LoginCard
        onSubmit={vi.fn(async () => {})}
        onVerifyCode={vi.fn(async () => ({ ok: true as const }))}
      />
    )
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy()
  })

  it("checks the code from the browser on /login (per-person rate limits)", async () => {
    const assign = vi.fn()
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      assign,
    })
    browser.verifyOtp.mockResolvedValueOnce({
      data: { session: {}, user: { id: "u1" } },
      error: null,
    })
    const user = userEvent.setup()
    render(<LoginCardHost onSubmit={vi.fn(async () => {})} />)
    await user.type(screen.getByLabelText("Email"), ` ${EMAIL} `)
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }))
    await user.type(await screen.findByLabelText("Sign-in code"), "123456")
    await user.click(screen.getByRole("button", { name: "Sign in with code" }))
    expect(browser.verifyOtp).toHaveBeenCalledExactlyOnceWith({
      email: EMAIL,
      token: "123456",
      type: "email",
    })
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"))
  })

  it("resends through the same request as the first email", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { onSubmit } = await sendTo(EMAIL)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await act(async () =>
      vi.advanceTimersByTime(RESEND_COOLDOWN_SECONDS * 1000)
    )
    await waitFor(() => expect(resendButton().disabled).toBe(false))
    await user.click(resendButton())
    expect(onSubmit).toHaveBeenCalledTimes(2)
    expect(onSubmit).toHaveBeenLastCalledWith(EMAIL)
  })
})

describe("SignInAgainSheet with a sign-in code", () => {
  function guardWith(overrides: Partial<SessionGuard> = {}): SessionGuard {
    return {
      email: EMAIL,
      userId: "user-1",
      captchaRequired: false,
      captchaSiteKey: null,
      sendLink: vi.fn(async () => ({})),
      isSignedIn: async () => false,
      verifyCode: vi.fn(async () => ({ userId: "user-1" })),
      ...overrides,
    }
  }

  async function sendFromSheet(
    guard: SessionGuard,
    onSignedIn = vi.fn(),
    onOpenChange = vi.fn()
  ) {
    const user = userEvent.setup()
    render(
      <SignInAgainSheet
        open
        onOpenChange={onOpenChange}
        guard={guard}
        done={1}
        stopped={1}
        onSignedIn={onSignedIn}
      />
    )
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }))
    await screen.findByRole("dialog", { name: "Check your email" })
    return { user, onSignedIn, onOpenChange }
  }

  it("resumes straight away when the same person signs in with the code", async () => {
    const guard = guardWith()
    const { user, onSignedIn } = await sendFromSheet(guard)
    await user.type(codeField(), "123456")
    await user.click(screen.getByRole("button", { name: "Sign in with code" }))
    expect(guard.verifyCode).toHaveBeenCalledExactlyOnceWith(EMAIL, "123456")
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce())
  })

  it("does not resume for a different account", async () => {
    const guard = guardWith({
      verifyCode: vi.fn(async () => ({ userId: "someone-else" })),
    })
    const { user, onSignedIn, onOpenChange } = await sendFromSheet(guard)
    await user.type(codeField(), "123456")
    await user.click(screen.getByRole("button", { name: "Sign in with code" }))
    expect((await screen.findByRole("alert")).textContent).toBe(
      DIFFERENT_ACCOUNT_MESSAGE
    )
    expect(onSignedIn).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("shows a refused code and keeps the queue paused", async () => {
    const guard = guardWith({
      verifyCode: vi.fn(async () => ({ error: SIGN_IN_CODE_INVALID_MESSAGE })),
    })
    const { user, onSignedIn } = await sendFromSheet(guard)
    await user.type(codeField(), "123456")
    await user.click(screen.getByRole("button", { name: "Sign in with code" }))
    expect((await screen.findByRole("alert")).textContent).toBe(
      SIGN_IN_CODE_INVALID_MESSAGE
    )
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it("does not send again when reopened inside the resend wait", async () => {
    const guard = guardWith()
    const user = userEvent.setup()
    const props = {
      onOpenChange: () => {},
      guard,
      done: 0,
      stopped: 1,
    }
    const { rerender } = render(<SignInAgainSheet open {...props} />)
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }))
    await screen.findByRole("dialog", { name: "Check your email" })
    rerender(<SignInAgainSheet open={false} {...props} />)
    rerender(<SignInAgainSheet open {...props} />)
    await user.click(
      await screen.findByRole("button", { name: "Send sign-in link" })
    )
    await screen.findByRole("dialog", { name: "Check your email" })
    expect(guard.sendLink).toHaveBeenCalledOnce()
    expect(resendButton().disabled).toBe(true)
  })

  it("closes itself when no resume callback is given", async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(
      <SignInAgainSheet
        open
        onOpenChange={onOpenChange}
        guard={guardWith()}
        done={0}
        stopped={1}
      />
    )
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }))
    await user.type(await screen.findByLabelText("Sign-in code"), "123456")
    await user.click(screen.getByRole("button", { name: "Sign in with code" }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("offers the link only when the page cannot check codes", async () => {
    const user = userEvent.setup()
    render(
      <SignInAgainSheet
        open
        onOpenChange={() => {}}
        guard={guardWith({ verifyCode: undefined })}
        done={0}
        stopped={1}
      />
    )
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }))
    await screen.findByRole("dialog", { name: "Check your email" })
    expect(screen.queryByLabelText("Sign-in code")).toBeNull()
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy()
  })
})
