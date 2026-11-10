// @vitest-environment jsdom
// X-01 / UP-21: the offline banner's times say what they measure.
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ pathname: "/manager/amenities" }))
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: vi.fn() }),
}))

import {
  LayoutOfflineShell,
  OFFLINE_COPY,
  OfflineNotice,
  OfflineShell,
  offlineTime,
} from "@/components/nabalens/offline-notice"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  nav.pathname = "/manager/amenities"
})

function setOnline(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online)
}

function goOffline() {
  setOnline(false)
  act(() => {
    window.dispatchEvent(new Event("offline"))
  })
}

const banner = () =>
  screen
    .queryAllByRole("alert")
    .find((el) => el.textContent?.includes(OFFLINE_COPY.title))

// 09:30 London (GMT in November).
const LOADED = "2026-11-10T09:30:00.000Z"

describe("offline banner times", () => {
  it("says when the page was loaded and when the connection dropped", () => {
    setOnline(true)
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-10T10:05:00.000Z"))
    render(
      <OfflineShell loadedAt={LOADED}>
        <p>Page</p>
      </OfflineShell>
    )
    goOffline()
    expect(banner()?.textContent).toContain(
      "Loaded at 09:30. You've been offline since 10:05."
    )
    vi.useRealTimers()
  })

  it("never names a time for a page that loaded already offline", () => {
    setOnline(false)
    render(
      <OfflineShell loadedAt={LOADED}>
        <p>Page</p>
      </OfflineShell>
    )
    const text = banner()?.textContent ?? ""
    expect(text).toContain(OFFLINE_COPY.loadedOffline)
    expect(text).not.toMatch(/\d{2}:\d{2}/)
  })

  it("takes a refresh's new render time", () => {
    setOnline(true)
    const { rerender } = render(
      <OfflineShell loadedAt={LOADED}>
        <p>Page</p>
      </OfflineShell>
    )
    rerender(
      <OfflineShell loadedAt="2026-11-10T09:45:00.000Z">
        <p>Page</p>
      </OfflineShell>
    )
    goOffline()
    expect(banner()?.textContent).toContain("Loaded at 09:45.")
  })

  it("drops a layout's time once its page changes, until the next refresh", () => {
    setOnline(true)
    const { rerender } = render(
      <LayoutOfflineShell loadedAt={LOADED}>
        <p>Page</p>
      </LayoutOfflineShell>
    )
    nav.pathname = "/manager/review"
    rerender(
      <LayoutOfflineShell loadedAt={LOADED}>
        <p>Another page</p>
      </LayoutOfflineShell>
    )
    goOffline()
    expect(banner()?.textContent).not.toContain("Loaded at")
    expect(banner()?.textContent).toMatch(/You've been offline since \d{2}:\d{2}\./)
  })

  it("uses the time a page's own notice brings under a layout", () => {
    setOnline(true)
    render(
      <LayoutOfflineShell>
        <OfflineNotice loadedAt={LOADED} />
      </LayoutOfflineShell>
    )
    goOffline()
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(banner()?.textContent).toContain("Loaded at 09:30.")
  })

  it("adds the date when it isn't today, and the year when it isn't this year", () => {
    const now = new Date("2026-11-10T12:00:00.000Z")
    expect(offlineTime(new Date("2026-11-10T08:00:00.000Z"), now)).toBe("08:00")
    expect(offlineTime(new Date("2026-11-09T22:15:00.000Z"), now)).toBe(
      "22:15 on 9 Nov"
    )
    expect(offlineTime(new Date("2025-12-31T23:00:00.000Z"), now)).toBe(
      "23:00 on 31 Dec 2025"
    )
  })
})
