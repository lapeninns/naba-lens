import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`)
  },
}))
vi.mock("@/lib/server/menu-photos", () => ({}))

const { failedRead } = await import("@/app/manager/load-overview")

describe("a manager page whose read finds the session ended", () => {
  it("sends the manager to sign in and back to the page asked for", () => {
    expect(() =>
      failedRead("unauthenticated", undefined, "/manager/review?status=all")
    ).toThrow("REDIRECT /login?next=%2Fmanager%2Freview%3Fstatus%3Dall")
    expect(() => failedRead("unauthenticated")).toThrow("REDIRECT /login")
  })

  it("still sends a refusal to Overview and other failures to the error page", () => {
    expect(() => failedRead("not_permitted", "x", "/manager/menu")).toThrow(
      "REDIRECT /manager"
    )
    expect(() => failedRead("unavailable", "the overview")).toThrow(
      "Could not load the overview: unavailable"
    )
  })
})
