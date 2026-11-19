// The hourly notification route (app/api/internal/notifications): the
// scheduler's bearer secret is required, the response holds counts only, and
// a failed run answers 500 so the cron history shows it.
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock("@/lib/server/notifications", () => ({
  runNotificationJobs: mocks.run,
}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }))

import { GET, POST } from "@/app/api/internal/notifications/route"

const SECRET = "x".repeat(40)
const request = (token?: string) =>
  new Request("http://localhost/api/internal/notifications", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })

beforeEach(() => {
  mocks.run.mockReset()
  vi.stubEnv("CLEANUP_SECRET", SECRET)
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("notification route", () => {
  it("refuses a missing or wrong secret, and says when none is configured", async () => {
    expect((await GET(request())).status).toBe(401)
    expect((await GET(request("y".repeat(40)))).status).toBe(401)
    vi.stubEnv("CLEANUP_SECRET", "")
    expect((await GET(request(SECRET))).status).toBe(503)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it("runs the job and returns counts", async () => {
    mocks.run.mockResolvedValue({
      ok: true,
      report: { digests: 1, exceptions: 0, resolved: 2 },
    })
    const response = await POST(request(SECRET))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: "succeeded",
      digests: 1,
      exceptions: 0,
      resolved: 2,
    })
    expect(response.headers.get("Cache-Control")).toContain("no-store")
  })

  it("answers 500 on a failed run", async () => {
    mocks.run.mockResolvedValue({
      ok: false,
      errorCode: "notification_job_failed",
    })
    expect((await GET(request(SECRET))).status).toBe(500)
    mocks.run.mockRejectedValue(new Error("down"))
    expect((await GET(request(SECRET))).status).toBe(500)
  })
})
