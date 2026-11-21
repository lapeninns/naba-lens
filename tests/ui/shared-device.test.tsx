// @vitest-environment jsdom
// Shared-device mode (spec §3.2, AC36; app/login/shared-device.ts): on a
// device marked shared, any arrival at sign in removes what the last person
// left, also when their session ended without signing out. A personal
// device keeps an expired session's drafts for the same person.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LoginCardHost } from "@/app/login/login-card-host"
import {
  DEVICE_MODE_KEY,
  readDeviceMode,
  shouldWipeOnSignIn,
  writeDeviceMode,
} from "@/app/login/shared-device"

vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({}) }))

const DRAFT = "nabalens.amenity-draft.v2:user-1:check-1"

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.localStorage.setItem(DRAFT, "{}")
  window.localStorage.setItem("nabalens-upload-keys", "{}")
  window.localStorage.setItem("nabalens.match.last-place", "bar")
  window.sessionStorage.setItem("nabalens.task-submit-intents", "{}")
  window.sessionStorage.setItem("other-app", "kept")
})
afterEach(cleanup)

const host = (signedOut: boolean) => (
  <LoginCardHost onSubmit={async () => {}} signedOut={signedOut} />
)

describe("device mode", () => {
  it("is personal unless shared was chosen here", () => {
    expect(readDeviceMode()).toBe("personal")
    writeDeviceMode("shared")
    expect(readDeviceMode()).toBe("shared")
    writeDeviceMode("personal")
    expect(window.localStorage.getItem(DEVICE_MODE_KEY)).toBeNull()
  })

  it("wipes on every sign-out, and on any arrival when shared", () => {
    expect(shouldWipeOnSignIn("personal", true)).toBe(true)
    expect(shouldWipeOnSignIn("personal", false)).toBe(false)
    expect(shouldWipeOnSignIn("shared", false)).toBe(true)
  })
})

describe("sign in on a shared device", () => {
  it("removes drafts, upload keys and the tab's working copies after a session ended", async () => {
    writeDeviceMode("shared")
    render(host(false))
    await vi.waitFor(() =>
      expect(window.localStorage.getItem(DRAFT)).toBeNull()
    )
    expect(window.localStorage.getItem("nabalens-upload-keys")).toBeNull()
    expect(window.localStorage.getItem("nabalens.match.last-place")).toBeNull()
    expect(
      window.sessionStorage.getItem("nabalens.task-submit-intents")
    ).toBeNull()
    expect(window.sessionStorage.getItem("other-app")).toBe("kept")
    // The choice itself stays with the device.
    expect(readDeviceMode()).toBe("shared")
    expect(
      screen.getByRole("checkbox", { name: "This is a shared device" })
    ).toHaveProperty("ariaChecked", "true")
  })

  it("keeps a personal device's drafts after a session ended", () => {
    render(host(false))
    expect(window.localStorage.getItem(DRAFT)).toBe("{}")
    expect(window.sessionStorage.getItem("nabalens.task-submit-intents")).toBe(
      "{}"
    )
  })

  it("sits before Send sign-in link, so it is read first (R6)", () => {
    render(host(false))
    const box = screen.getByRole("checkbox", {
      name: "This is a shared device",
    })
    const send = screen.getByRole("button", { name: "Send sign-in link" })
    expect(
      box.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it("remembers the choice for this device", () => {
    render(host(false))
    const box = screen.getByRole("checkbox", {
      name: "This is a shared device",
    })
    fireEvent.click(box)
    expect(readDeviceMode()).toBe("shared")
    fireEvent.click(box)
    expect(readDeviceMode()).toBe("personal")
  })
})
