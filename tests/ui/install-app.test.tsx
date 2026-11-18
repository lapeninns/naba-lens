// @vitest-environment jsdom
// FA-53 (spec §15.3): Me › Help and account offers Add to home screen only
// while the browser offers installation (`beforeinstallprompt`), hides it once
// installed or answered, shows Safari's steps on iOS only, and nothing when
// already opened from the home screen.
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  INSTALL_COPY,
  InstallApp,
  isIos,
  resetInstallPromptForTests,
} from "@/components/nabalens/me/install-app"

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

let standalone = false

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value: ua,
    configurable: true,
  })
}

function fireInstallPrompt(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true })
  const prompt = vi.fn(async () => {})
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  })
  act(() => {
    window.dispatchEvent(event)
  })
  return { event, prompt }
}

beforeEach(() => {
  standalone = false
  setUserAgent(ANDROID_CHROME)
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === "(display-mode: standalone)" && standalone,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
  resetInstallPromptForTests()
})

afterEach(() => {
  cleanup()
})

describe("InstallApp", () => {
  it("shows nothing until the browser offers installation", () => {
    render(<InstallApp />)
    expect(
      screen.queryByRole("heading", { name: INSTALL_COPY.title })
    ).toBeNull()
  })

  it("offers Add to home screen once beforeinstallprompt fires, and opens the browser's prompt", async () => {
    render(<InstallApp />)
    const { event, prompt } = fireInstallPrompt("accepted")
    expect(event.defaultPrevented).toBe(true)

    const button = screen.getByRole("button", { name: INSTALL_COPY.button })
    expect(screen.queryByRole("list")).toBeNull()
    await userEvent.click(button)
    expect(prompt).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole("button", { name: INSTALL_COPY.button })
    ).toBeNull()
  })

  it("keeps an event fired before Me was opened", () => {
    fireInstallPrompt()
    render(<InstallApp />)
    expect(
      screen.getByRole("button", { name: INSTALL_COPY.button })
    ).toBeTruthy()
  })

  it("hides the button when the prompt is dismissed", async () => {
    render(<InstallApp />)
    fireInstallPrompt("dismissed")
    await userEvent.click(
      screen.getByRole("button", { name: INSTALL_COPY.button })
    )
    expect(
      screen.queryByRole("heading", { name: INSTALL_COPY.title })
    ).toBeNull()
  })

  it("offers again only when the browser fires a new event after a dismissal", async () => {
    render(<InstallApp />)
    fireInstallPrompt("dismissed")
    await userEvent.click(
      screen.getByRole("button", { name: INSTALL_COPY.button })
    )
    expect(
      screen.queryByRole("button", { name: INSTALL_COPY.button })
    ).toBeNull()
    fireInstallPrompt()
    expect(
      screen.getByRole("button", { name: INSTALL_COPY.button })
    ).toBeTruthy()
  })

  it("never offers again once installed, even if an event arrives", async () => {
    render(<InstallApp />)
    fireInstallPrompt("accepted")
    await userEvent.click(
      screen.getByRole("button", { name: INSTALL_COPY.button })
    )
    fireInstallPrompt()
    expect(
      screen.queryByRole("heading", { name: INSTALL_COPY.title })
    ).toBeNull()
  })

  it("hides the button once the app is installed another way", () => {
    render(<InstallApp />)
    fireInstallPrompt()
    act(() => {
      window.dispatchEvent(new Event("appinstalled"))
    })
    expect(
      screen.queryByRole("button", { name: INSTALL_COPY.button })
    ).toBeNull()
  })

  it("shows Safari's steps on iPhone, with no button", () => {
    setUserAgent(IPHONE_SAFARI)
    render(<InstallApp />)
    expect(
      screen.getByRole("heading", { name: INSTALL_COPY.title })
    ).toBeTruthy()
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent)
    expect(steps).toEqual([...INSTALL_COPY.iosSteps])
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("shows nothing when opened from the home screen", () => {
    setUserAgent(IPHONE_SAFARI)
    standalone = true
    render(<InstallApp />)
    expect(
      screen.queryByRole("heading", { name: INSTALL_COPY.title })
    ).toBeNull()
  })

  it("uses the heading level it is given", () => {
    setUserAgent(IPHONE_SAFARI)
    render(<InstallApp headingLevel={4} />)
    expect(
      screen.getByRole("heading", { level: 4, name: INSTALL_COPY.title })
    ).toBeTruthy()
  })
})

describe("isIos", () => {
  it("knows iPhone, iPad (as a Mac with touch) and not Android or a Mac", () => {
    expect(isIos({ userAgent: IPHONE_SAFARI })).toBe(true)
    expect(
      isIos({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      })
    ).toBe(true)
    expect(
      isIos({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        platform: "MacIntel",
        maxTouchPoints: 0,
      })
    ).toBe(false)
    expect(isIos({ userAgent: ANDROID_CHROME })).toBe(false)
  })
})
