// @vitest-environment jsdom
// Sign-out lands on /login?signed_out=1 from every shell; the login card host
// removes unsent amenity drafts there, so a shared device keeps none.
import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LoginCardHost } from "@/app/login/login-card-host"

vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({}) }))

const DRAFT = "nabalens.amenity-draft.v2:user-1:check-1"

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem(DRAFT, "{}")
  window.localStorage.setItem("nabalens.amenity-draft.v1:check-2", "{}")
  window.localStorage.setItem("nabalens.other", "kept")
})
afterEach(cleanup)

const host = (signedOut: boolean) => (
  <LoginCardHost onSubmit={async () => {}} signedOut={signedOut} />
)

describe("amenity drafts at sign-out", () => {
  it("removes every amenity draft after signing out", () => {
    render(host(true))
    expect(Object.keys(window.localStorage)).toEqual(["nabalens.other"])
  })

  it("keeps drafts on a plain visit to sign in (an expired session)", () => {
    render(host(false))
    expect(window.localStorage.getItem(DRAFT)).toBe("{}")
  })
})
