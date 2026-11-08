// @vitest-environment jsdom
import * as React from "react"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest"

import { SESSION_ENDED_MESSAGE } from "@/lib/auth/session-ended"

type Session = { user: { id: string; email: string } } | null
type AuthCall = Mock<(...args: unknown[]) => Promise<unknown>>
const auth = vi.hoisted(() => ({
  session: null as Session,
  error: null as null | { name: string },
  listener: null as null | ((event: string, session: Session) => void),
  signInWithOtp: undefined as unknown as AuthCall,
  verifyOtp: undefined as unknown as AuthCall,
}))
const refresh = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: auth.session },
        error: auth.error,
      }),
      onAuthStateChange: (
        listener: (event: string, session: Session) => void
      ) => {
        auth.listener = listener
        queueMicrotask(() => listener("INITIAL_SESSION", auth.session))
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signInWithOtp: (...args: unknown[]) => auth.signInWithOtp(...args),
      verifyOtp: (...args: unknown[]) => auth.verifyOtp(...args),
    },
  }),
}))

import {
  SessionGuardHost,
  useReportSessionEnded,
} from "@/components/nabalens/session-guard-host"

const ME = { user: { id: "manager-1", email: "manager@example.test" } }

function RenameForm() {
  const report = useReportSessionEnded()
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <label>
        Your name
        <input name="name" defaultValue="" />
      </label>
      <button type="submit">Save</button>
      <button type="button" onClick={report}>
        Report
      </button>
    </form>
  )
}

function renderHost() {
  const user = userEvent.setup()
  render(
    <SessionGuardHost captchaRequired={false} captchaSiteKey={null}>
      <RenameForm />
    </SessionGuardHost>
  )
  return user
}

const nameField = () => screen.getByLabelText("Your name") as HTMLInputElement
const sheet = (name: RegExp | string = "Sign in again") =>
  screen.findByRole("dialog", { name }, { timeout: 3000 })

beforeEach(() => {
  auth.session = ME
  auth.error = null
  auth.signInWithOtp = vi.fn().mockResolvedValue({ error: null })
  auth.verifyOtp = vi.fn().mockResolvedValue({
    data: { session: {}, user: { id: ME.user.id } },
    error: null,
  })
  refresh.mockClear()
})

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  window.localStorage.clear()
})

async function signedInFirst() {
  // The host learns who the page belongs to from the auth client.
  await act(async () => {})
}

describe("SessionGuardHost", () => {
  it("stays out of the way while signed in", async () => {
    const user = renderHost()
    await signedInFirst()
    await user.type(nameField(), "Asha")
    await user.click(screen.getByRole("button", { name: "Save" }))
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("opens Sign in again over the page when a tap finds the session ended, keeping what was typed", async () => {
    const user = renderHost()
    await signedInFirst()
    await user.type(nameField(), "Asha Rai")
    auth.session = null
    await user.click(screen.getByRole("button", { name: "Save" }))

    const dialog = await sheet()
    expect(dialog.textContent).toContain(
      "You were signed out, so anything you tried since then wasn't saved."
    )
    expect(dialog.textContent).toContain("manager@example.test")
    expect(dialog.textContent).toContain(
      "This page stays open, with what you've entered."
    )
    // Nothing about photos on a manager or admin page.
    expect(dialog.textContent).not.toMatch(/photo|stopped/i)
    expect(nameField().value).toBe("Asha Rai")
  })

  it("signs the same person back in with the code, closes, refreshes data and keeps the input", async () => {
    const user = renderHost()
    await signedInFirst()
    await user.type(nameField(), "Asha Rai")
    auth.session = null
    await user.click(screen.getByRole("button", { name: "Save" }))
    await sheet()

    await user.click(screen.getByRole("button", { name: "Send sign-in link" }))
    await sheet("Check your email")
    expect(auth.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "manager@example.test",
        options: expect.objectContaining({ shouldCreateUser: false }),
      })
    )
    auth.session = ME
    await user.type(screen.getByLabelText("Sign-in code"), "123456")
    await user.click(screen.getByRole("button", { name: "Sign in with code" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(refresh).toHaveBeenCalledOnce()
    expect(nameField().value).toBe("Asha Rai")
  })

  it("closes when the link signs this browser in from another tab", async () => {
    const user = renderHost()
    await signedInFirst()
    auth.session = null
    await user.click(screen.getByRole("button", { name: "Save" }))
    await sheet()
    auth.session = ME
    act(() => {
      window.dispatchEvent(new Event("focus"))
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(refresh).toHaveBeenCalledOnce()
  })

  it("does not resume for a different account", async () => {
    const user = renderHost()
    await signedInFirst()
    auth.session = null
    await user.click(screen.getByRole("button", { name: "Save" }))
    await sheet()
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }))
    await sheet("Check your email")
    auth.verifyOtp.mockResolvedValue({
      data: { session: {}, user: { id: "someone-else" } },
      error: null,
    })
    await user.type(screen.getByLabelText("Sign-in code"), "123456")
    await user.click(screen.getByRole("button", { name: "Sign in with code" }))
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That code signed in a different account. Reload the page to continue as that account."
    )
    expect(refresh).not.toHaveBeenCalled()
  })

  it("after Not now, stays closed on taps but reopens when an action is refused for the ended session", async () => {
    const user = renderHost()
    await signedInFirst()
    auth.session = null
    await user.click(screen.getByRole("button", { name: "Save" }))
    await sheet()
    await user.click(screen.getByRole("button", { name: "Not now" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    await user.click(screen.getByRole("button", { name: "Save" }))
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(screen.queryByRole("dialog")).toBeNull()

    // The proxy's 401 for a Server Action, left unhandled by the caller.
    act(() => {
      window.dispatchEvent(
        Object.assign(new Event("unhandledrejection"), {
          reason: new Error(SESSION_ENDED_MESSAGE),
        })
      )
    })
    await sheet()
  })

  it("reopens when a screen reports a refused action", async () => {
    const user = renderHost()
    await signedInFirst()
    auth.session = null
    await user.click(screen.getByRole("button", { name: "Save" }))
    await sheet()
    await user.click(screen.getByRole("button", { name: "Not now" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await user.click(screen.getByRole("button", { name: "Report" }))
    await sheet()
  })

  it("opens when the auth client reports a sign-out", async () => {
    renderHost()
    await signedInFirst()
    auth.session = null
    act(() => auth.listener?.("SIGNED_OUT", null))
    await sheet()
  })

  it("never treats offline or an unreachable auth server as a sign-out", async () => {
    const user = renderHost()
    await signedInFirst()
    auth.session = null
    auth.error = { name: "AuthRetryableFetchError" }
    await user.click(screen.getByRole("button", { name: "Save" }))
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(screen.queryByRole("dialog")).toBeNull()

    auth.error = null
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event("focus"))
    })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(screen.queryByRole("dialog")).toBeNull()
    online.mockRestore()
  })

  it("without an email, links to sign in in a new tab and come back to this page", async () => {
    auth.session = { user: { id: "manager-1" } } as Session
    window.history.pushState({}, "", "/manager/account?tab=name")
    const user = renderHost()
    await signedInFirst()
    auth.session = null
    await user.click(screen.getByRole("button", { name: "Save" }))
    const dialog = await sheet()
    expect(dialog.textContent).toContain(
      "Sign in again in a new tab, then come back here."
    )
    const link = screen.getByRole("link", { name: "Sign in again" })
    expect(link.getAttribute("href")).toBe(
      "/login?next=%2Fmanager%2Faccount%3Ftab%3Dname"
    )
    expect(link.getAttribute("target")).toBe("_blank")
    window.history.pushState({}, "", "/")
  })

  it("ignores rejections that are not the ended session", async () => {
    renderHost()
    await signedInFirst()
    auth.session = null
    act(() => {
      window.dispatchEvent(
        Object.assign(new Event("unhandledrejection"), {
          reason: new Error("Something else"),
        })
      )
    })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

// Keep React in scope for the JSX transform used by this file.
void React
