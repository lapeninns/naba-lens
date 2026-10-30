// @vitest-environment jsdom
import * as React from "react"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const script = vi.hoisted(() => ({
  current: null as null | { onReady: () => void; onError: () => void },
}))
vi.mock("next/script", () => ({
  default: function MockScript({
    onReady,
    onError,
  }: {
    onReady: () => void
    onError: () => void
  }) {
    script.current = { onReady, onError }
    const loaded = React.useRef(false)
    React.useEffect(() => {
      if (loaded.current) return
      loaded.current = true
      onReady()
    }, [onReady])
    return null
  },
}))

import { LoginCard } from "@/components/nabalens/login-card"
import { CAPTCHA_RETRY_MESSAGE } from "@/lib/auth/captcha"

type Callbacks = {
  callback: (token: string) => void
  "expired-callback": () => void
  "error-callback": () => void
  "timeout-callback": () => void
}
let current: Callbacks
const reset = vi.fn()
const remove = vi.fn()
function installWidget() {
  ;(window as unknown as { turnstile: unknown }).turnstile = {
    render: (_container: HTMLElement, callbacks: Callbacks) => {
      current = callbacks
      return "widget-id"
    },
    reset,
    remove,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
  delete (window as unknown as { turnstile?: unknown }).turnstile
})

describe("configured login verification", () => {
  it("blocks missing configuration instead of submitting", async () => {
    const onSubmit = vi.fn()
    render(<LoginCard captchaRequired onSubmit={onSubmit} />)
    expect(screen.getByText(/Sign-in verification is unavailable/)).toBeTruthy()
    expect(
      (
        screen.getByRole("button", {
          name: "Send sign-in link",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("requires a solved challenge, forwards it and gets a fresh widget after failure", async () => {
    installWidget()
    const onSubmit = vi.fn().mockResolvedValue({ error: CAPTCHA_RETRY_MESSAGE })
    render(<LoginCard captchaSiteKey="site-key" onSubmit={onSubmit} />)
    await waitFor(() => expect(current).toBeTruthy())
    const submit = screen.getByRole("button", {
      name: "Send sign-in link",
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    await userEvent.type(screen.getByLabelText("Email"), "staff@example.test")
    act(() => current.callback("one-use-token"))
    const spentChallenge = current
    await userEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      "staff@example.test",
      "one-use-token"
    )
    expect(await screen.findByText(CAPTCHA_RETRY_MESSAGE)).toBeTruthy()
    expect(submit.disabled).toBe(true)
    expect(remove).toHaveBeenCalledWith("widget-id")
    await waitFor(() => expect(current).not.toBe(spentChallenge))
    act(() => spentChallenge.callback("stale-token"))
    expect(submit.disabled).toBe(true)
    act(() => current.callback("fresh-token"))
    expect(submit.disabled).toBe(false)
    expect(screen.queryByText(CAPTCHA_RETRY_MESSAGE)).toBeNull()
    expect(
      screen.getByLabelText("Email").getAttribute("aria-invalid")
    ).toBeNull()
    expect(screen.queryByText("Check your email")).toBeNull()
  })

  it("invalidates expired and failed challenges and offers reset", async () => {
    installWidget()
    render(<LoginCard captchaSiteKey="site-key" onSubmit={vi.fn()} />)
    await waitFor(() => expect(current).toBeTruthy())
    const submit = screen.getByRole("button", {
      name: "Send sign-in link",
    }) as HTMLButtonElement
    act(() => current.callback("token"))
    expect(submit.disabled).toBe(false)
    act(() => current["expired-callback"]())
    expect(submit.disabled).toBe(true)
    await userEvent.click(
      screen.getByRole("button", { name: "Retry verification" })
    )
    expect(reset).toHaveBeenCalledWith("widget-id")
    act(() => current["error-callback"]())
    expect(submit.disabled).toBe(true)
    expect(
      screen.getByRole("button", { name: "Retry verification" })
    ).toBeTruthy()
  })

  it("reports script loading failure without claiming a sign-in link was sent", async () => {
    installWidget()
    render(<LoginCard captchaSiteKey="site-key" onSubmit={vi.fn()} />)
    act(() => script.current!.onError())
    expect(await screen.findByText(/Verification could not load/)).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Reload verification" })
    ).toBeTruthy()
    expect(screen.queryByText("Check your email")).toBeNull()
  })

  it("offers retry when the challenge never finishes", () => {
    vi.useFakeTimers()
    installWidget()
    render(<LoginCard captchaSiteKey="site-key" onSubmit={vi.fn()} />)
    act(() => vi.advanceTimersByTime(60_000))
    expect(
      screen.getByRole("button", { name: "Retry verification" })
    ).toBeTruthy()
    expect(
      (
        screen.getByRole("button", {
          name: "Send sign-in link",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  })
})
