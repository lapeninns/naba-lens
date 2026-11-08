// @vitest-environment jsdom
// Screens that catch a Server Action's rejection must not turn the proxy's
// "signed out" refusal into a lost-connection message: they say nothing was
// saved and open Sign in again, even after the person chose "Not now" (the
// host only hears of rejections nobody caught).
import * as React from "react"
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SESSION_ENDED_MESSAGE } from "@/lib/auth/session-ended"

type Session = { user: { id: string; email: string } } | null
const auth = vi.hoisted(() => ({ session: null as Session }))
const refresh = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}))
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: auth.session },
        error: null,
      }),
      onAuthStateChange: (
        listener: (event: string, session: Session) => void
      ) => {
        queueMicrotask(() => listener("INITIAL_SESSION", auth.session))
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signInWithOtp: vi.fn(),
      verifyOtp: vi.fn(),
    },
  }),
}))
vi.mock("@/app/manager/actions", () => ({
  decideMenuPhotoAction: vi.fn(async () => {
    throw new Error(SESSION_ENDED_MESSAGE)
  }),
}))

import { NETWORK_ERROR as AMENITY_NETWORK_ERROR } from "@/components/nabalens/amenities/manage/use-amenity-action"
import { useAmenityAction } from "@/components/nabalens/amenities/manage/use-amenity-action"
import { ReasonDialog } from "@/components/nabalens/coverage/reason-dialog"
import {
  NETWORK_ERROR,
  useCoverageAction,
} from "@/components/nabalens/coverage/use-coverage-action"
import { useDecision } from "@/components/nabalens/manager/review/use-decision"
import { SessionGuardHost } from "@/components/nabalens/session-guard-host"

const ME = { user: { id: "manager-1", email: "manager@example.test" } }

/** The proxy's answer to a Server Action posted without a session. */
const signedOut = async (): Promise<never> => {
  throw new Error(SESSION_ENDED_MESSAGE)
}
/** A reply that never arrived. */
const lostReply = async (): Promise<never> => {
  throw new TypeError("Failed to fetch")
}

function Poke() {
  return <button type="button">Poke</button>
}

function CoverageSave({ call }: { call: () => Promise<never> }) {
  const action = useCoverageAction()
  const [code, setCode] = React.useState("")
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const result = await action.run(call, "Saved.")
          setCode(result.ok ? "ok" : result.code)
        }}
      >
        Save change
      </button>
      <p data-testid="notice">{action.notice?.text}</p>
      <p data-testid="code">{code}</p>
    </>
  )
}

function AmenitySave({ call }: { call: () => Promise<never> }) {
  const action = useAmenityAction()
  return (
    <>
      <button type="button" onClick={() => void action.run(call, "Saved.")}>
        Save change
      </button>
      <p data-testid="notice">{action.notice?.text}</p>
    </>
  )
}

function ReasonScreen({ confirm }: { confirm: () => Promise<never> }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open revoke
      </button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Revoke access"
        label="Reason"
        confirmLabel="Revoke"
        pendingLabel="Revoking…"
        onConfirm={confirm}
      />
    </>
  )
}

function renderInHost(children: React.ReactNode) {
  const user = userEvent.setup()
  render(
    <SessionGuardHost captchaRequired={false} captchaSiteKey={null}>
      <Poke />
      {children}
    </SessionGuardHost>
  )
  return user
}

const sheet = () =>
  screen.findByRole("dialog", { name: "Sign in again" }, { timeout: 3000 })
const noSheet = () =>
  expect(screen.queryByRole("dialog", { name: "Sign in again" })).toBeNull()

/** Signed out, the person saw Sign in again and chose Not now. */
async function dismissedSignIn(user: ReturnType<typeof userEvent.setup>) {
  await act(async () => {})
  auth.session = null
  await user.click(screen.getByRole("button", { name: "Poke" }))
  await sheet()
  await user.click(screen.getByRole("button", { name: "Not now" }))
  await waitFor(noSheet)
}

beforeEach(() => {
  auth.session = ME
  refresh.mockClear()
})
afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
})

describe("useCoverageAction", () => {
  it("after Not now, a write refused for the ended session says so and reopens Sign in again", async () => {
    const user = renderInHost(<CoverageSave call={signedOut} />)
    await dismissedSignIn(user)
    await user.click(screen.getByRole("button", { name: "Save change" }))
    await sheet()
    expect(screen.getByTestId("notice").textContent).toBe(SESSION_ENDED_MESSAGE)
    expect(screen.getByTestId("notice").textContent).not.toBe(NETWORK_ERROR)
  })

  it("a lost reply still says the change couldn't be confirmed, without Sign in again", async () => {
    const user = renderInHost(<CoverageSave call={lostReply} />)
    await dismissedSignIn(user)
    await user.click(screen.getByRole("button", { name: "Save change" }))
    await waitFor(() =>
      expect(screen.getByTestId("notice").textContent).toBe(NETWORK_ERROR)
    )
    expect(screen.getByTestId("code").textContent).toBe("network")
    await new Promise((resolve) => setTimeout(resolve, 1200))
    noSheet()
  })
})

describe("useAmenityAction", () => {
  it("after Not now, a write refused for the ended session says so and reopens Sign in again", async () => {
    const user = renderInHost(<AmenitySave call={signedOut} />)
    await dismissedSignIn(user)
    await user.click(screen.getByRole("button", { name: "Save change" }))
    await sheet()
    expect(screen.getByTestId("notice").textContent).toBe(SESSION_ENDED_MESSAGE)
    expect(screen.getByTestId("notice").textContent).not.toBe(
      AMENITY_NETWORK_ERROR
    )
  })
})

describe("useDecision", () => {
  it("carries the signed-out copy for a decision refused for the ended session", async () => {
    const { result } = renderHook(() => useDecision("pending"))
    const outcome = await result.current({
      action: "accept",
      assetId: "a-1",
      itemId: "i-1",
    } as Parameters<typeof result.current>[0])
    expect(outcome).toEqual({
      ok: false,
      code: "network",
      message: SESSION_ENDED_MESSAGE,
    })
  })
})

describe("ReasonDialog", () => {
  it("after Not now, a confirm refused for the ended session says nothing was saved and reopens Sign in again", async () => {
    const user = renderInHost(<ReasonScreen confirm={signedOut} />)
    await dismissedSignIn(user)
    await user.click(screen.getByRole("button", { name: "Open revoke" }))
    await user.type(screen.getByLabelText("Reason"), "Left the venue")
    await user.click(screen.getByRole("button", { name: "Revoke" }))
    await sheet()
    expect(document.body.textContent).toContain(SESSION_ENDED_MESSAGE)
    expect(document.body.textContent).not.toContain("We couldn't confirm")
  })
})
