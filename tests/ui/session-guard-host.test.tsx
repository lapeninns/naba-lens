// @vitest-environment jsdom
import * as React from "react"
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
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
  useClaimSignIn,
  useReportSessionEnded,
} from "@/components/nabalens/session-guard-host"
import { useSessionGuard } from "@/components/nabalens/session-guard"
import { UploadDialog } from "@/components/nabalens/upload-dialog"
import type { Uploader } from "@/components/nabalens/upload-queue"

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

  it("refreshes only after the sheet has closed, so focus goes back first", async () => {
    // A refreshed page may remove the element the sheet hands focus back to.
    // At the moment of the refresh the sheet must already be gone.
    const seenAtRefresh: { dialogOpen: boolean }[] = []
    refresh.mockImplementation(() => {
      seenAtRefresh.push({ dialogOpen: screen.queryByRole("dialog") !== null })
    })
    const user = renderHost()
    await signedInFirst()
    auth.session = null
    await user.click(screen.getByRole("button", { name: "Save" }))
    await sheet()
    auth.session = ME
    act(() => {
      window.dispatchEvent(new Event("focus"))
    })
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(seenAtRefresh).toEqual([{ dialogOpen: false }])
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("stays open, without refreshing, while offline or unsure", async () => {
    const user = renderHost()
    await signedInFirst()
    auth.session = null
    await user.click(screen.getByRole("button", { name: "Save" }))
    await sheet()

    // Offline: the lenient check would say "signed in"; closing must not.
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event("focus"))
    })
    // The auth server cannot be reached and there is no session.
    online.mockRestore()
    auth.error = { name: "AuthRetryableFetchError" }
    act(() => {
      window.dispatchEvent(new Event("focus"))
    })
    await new Promise((resolve) => setTimeout(resolve, 3500))
    expect(screen.getByRole("dialog", { name: "Sign in again" })).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })

  it("stays open when another account is signed in from another tab", async () => {
    const user = renderHost()
    await signedInFirst()
    auth.session = null
    await user.click(screen.getByRole("button", { name: "Save" }))
    await sheet()
    auth.session = { user: { id: "someone-else", email: "x@example.test" } }
    act(() => {
      window.dispatchEvent(new Event("focus"))
    })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(screen.getByRole("dialog", { name: "Sign in again" })).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
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

function Claimer({ claimed }: { claimed: boolean }) {
  useClaimSignIn(claimed)
  return null
}

describe("SessionGuardHost with a screen that has its own Sign in again", () => {
  function renderClaimed(claimed: boolean) {
    const ui = (on: boolean) => (
      <SessionGuardHost captchaRequired={false} captchaSiteKey={null}>
        <RenameForm />
        <Claimer claimed={on} />
      </SessionGuardHost>
    )
    const view = render(ui(claimed))
    return {
      user: userEvent.setup(),
      claim: (on: boolean) => view.rerender(ui(on)),
    }
  }

  it("keeps the page's sheet closed while the screen claims it; after, a refused action opens it", async () => {
    const { user, claim } = renderClaimed(true)
    await signedInFirst()
    auth.session = null
    await user.click(screen.getByRole("button", { name: "Save" }))
    await new Promise((resolve) => setTimeout(resolve, 1300))
    expect(screen.queryByRole("dialog")).toBeNull()

    // The screen's own Sign in again was dismissed: a tap stays quiet, as
    // after the page's "Not now"; a refused action opens the page's.
    claim(false)
    await user.click(screen.getByRole("button", { name: "Save" }))
    await new Promise((resolve) => setTimeout(resolve, 1300))
    expect(screen.queryByRole("dialog")).toBeNull()
    await user.click(screen.getByRole("button", { name: "Report" }))
    expect(await sheet()).toBeTruthy()
  })

  it("closes the page's sheet when the screen claims it", async () => {
    const { user, claim } = renderClaimed(false)
    await signedInFirst()
    auth.session = null
    await user.click(screen.getByRole("button", { name: "Save" }))
    await sheet()
    claim(true)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })
})

describe("SessionGuardHost while a streamed page is still arriving", () => {
  it("never changes its context value when the session is reported, and renders the page once", async () => {
    const seen: unknown[] = []
    let pageRenders = 0
    function Page() {
      pageRenders++
      seen.push(useSessionGuard())
      return <p>Page</p>
    }
    // The page element is created once, as a layout's children are.
    const page = <Page />
    render(
      <SessionGuardHost captchaRequired={false} captchaSiteKey={null}>
        {page}
      </SessionGuardHost>
    )
    // A context change above a Suspense boundary still waiting for streamed
    // content makes React render it again in the browser and leave the
    // server's copy behind, so the value must survive the auth events.
    await signedInFirst()
    act(() => auth.listener?.("TOKEN_REFRESHED", ME))
    expect(new Set(seen).size).toBe(1)
    expect(pageRenders).toBe(1)
    expect(screen.getAllByText("Page")).toHaveLength(1)
    const guard = seen[0] as { email: string | null; userId: string | null }
    expect(guard.email).toBe("manager@example.test")
    expect(guard.userId).toBe("manager-1")
  })
})

describe("SessionGuardHost around the upload sheet", () => {
  it("after Not now and closing the sheet, a refused action opens the page's Sign in again", async () => {
    const held: { reject: (e: Error) => void }[] = []
    const upload: Uploader = () =>
      new Promise<void>((_, reject) => {
        held.push({ reject })
      })
    function Page() {
      const [open, setOpen] = React.useState(true)
      return (
        <UploadDialog
          open={open}
          onOpenChange={setOpen}
          uploader={upload}
          limits={{
            maxBatchFiles: 10,
            maxParallelUploads: 1,
            maxPhotoBytes: 20 * 1024 * 1024,
            maxVideoBytes: 200 * 1024 * 1024,
          }}
          keepRunningWhenClosed
        />
      )
    }
    render(
      <SessionGuardHost captchaRequired={false} captchaSiteKey={null}>
        <Page />
      </SessionGuardHost>
    )
    const user = userEvent.setup()
    await signedInFirst()
    await user.upload(screen.getByLabelText("Choose photos or videos"), [
      new File([new Uint8Array(64)], "a.jpg", { type: "image/jpeg" }),
    ])
    await user.click(screen.getByRole("button", { name: "Upload 1 file" }))
    await waitFor(() => expect(held).toHaveLength(1))

    // The session ends mid-upload: the sheet's own Sign in again, alone.
    auth.session = null
    await act(async () => held[0].reject(new Error("Sign in to continue.")))
    const uploads = await sheet()
    expect(uploads.textContent).toMatch(/stopped|photo|upload/i)
    expect(
      screen.getAllByRole("dialog", { name: "Sign in again" })
    ).toHaveLength(1)

    await user.click(within(uploads).getByRole("button", { name: "Not now" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Sign in again" })).toBeNull()
    )
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    // A Server Action refused for the ended session elsewhere on the page.
    act(() => {
      window.dispatchEvent(
        Object.assign(new Event("unhandledrejection"), {
          reason: new Error(SESSION_ENDED_MESSAGE),
        })
      )
    })
    const page = await sheet()
    expect(page.textContent).toContain(
      "This page stays open, with what you've entered."
    )
  })
})
