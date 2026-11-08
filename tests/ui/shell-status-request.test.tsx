// @vitest-environment jsdom
// A page and the staff not-found render in the same request share the shell
// status reads, even though each builds its own actor for the same person.
import type * as React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { tasksView } from "./tasks-fixtures"

type Entry = { args: unknown[]; value: unknown }
const request = vi.hoisted(() => ({
  calls: new Map<unknown, Entry[]>(),
}))
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>()
  return {
    ...react,
    // React's server cache: one result per request for the same arguments,
    // matched by identity. The client build used in tests does not memoise.
    cache:
      <A extends unknown[], R>(fn: (...args: A) => R) =>
      (...args: A): R => {
        const entries = request.calls.get(fn) ?? []
        request.calls.set(fn, entries)
        const hit = entries.find(
          (e) =>
            e.args.length === args.length &&
            e.args.every((a, i) => Object.is(a, args[i]))
        )
        if (hit) return hit.value as R
        const value = fn(...args)
        entries.push({ args, value })
        return value
      },
  }
})
vi.mock("server-only", () => ({}))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}))
const PROFILE = { id: "me", displayName: "TEST Sam", avatarPath: null }
vi.mock("@/lib/auth", () => ({
  requireActiveStaff: vi.fn(async () => PROFILE),
}))
vi.mock("@/lib/server/media/library", () => ({ avatarUrl: () => null }))
const coverage = vi.hoisted(() => ({
  getCoverageActor: vi.fn(),
  getCoverageScope: vi.fn(),
  getManagerReviewCount: vi.fn(),
  getMyTasks: vi.fn(),
}))
vi.mock("@/lib/server/coverage", () => coverage)
const amenities = vi.hoisted(() => ({ getMyAmenityTasks: vi.fn() }))
vi.mock("@/lib/server/amenities", () => amenities)

import { staffShellStatus } from "@/app/staff/_shell/shell-status"
import StaffNotFound from "@/app/staff/not-found"

const actorOf = (id: string) => ({ profile: { id, avatarPath: null } })

beforeEach(() => {
  request.calls = new Map()
  vi.clearAllMocks()
  coverage.getCoverageScope.mockResolvedValue({
    ok: true,
    scope: { ...tasksView().scope, canManageVenue: true },
  })
  coverage.getManagerReviewCount.mockResolvedValue({ ok: true, count: 3 })
  coverage.getMyTasks.mockResolvedValue({ ok: true, tasks: tasksView() })
  amenities.getMyAmenityTasks.mockResolvedValue({ ok: true, tasks: [] })
})

describe("shell status within one request", () => {
  it("reads once when a page and the staff not-found render share a request", async () => {
    const pageActor = actorOf("me")
    // The not-found render builds a new actor for the same person.
    coverage.getCoverageActor.mockResolvedValue({
      ok: true,
      actor: actorOf("me"),
    })
    await staffShellStatus(pageActor as never, PROFILE)
    await StaffNotFound()
    expect(coverage.getMyTasks).toHaveBeenCalledTimes(1)
    expect(amenities.getMyAmenityTasks).toHaveBeenCalledTimes(1)
    expect(coverage.getCoverageScope).toHaveBeenCalledTimes(1)
    expect(coverage.getManagerReviewCount).toHaveBeenCalledTimes(1)
    // Every read ran as the page's own actor for that person.
    expect(coverage.getMyTasks).toHaveBeenCalledWith(pageActor)
  })

  it("never shares one person's reads with another", async () => {
    await staffShellStatus(actorOf("me") as never, PROFILE)
    const other = actorOf("someone-else")
    await staffShellStatus(other as never, {
      id: "someone-else",
      avatarPath: null,
    })
    expect(coverage.getMyTasks).toHaveBeenCalledTimes(2)
    expect(coverage.getMyTasks).toHaveBeenLastCalledWith(other)
  })
})
