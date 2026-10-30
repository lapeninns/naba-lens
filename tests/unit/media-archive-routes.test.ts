import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  status: vi.fn(),
  admin: vi.fn(() => ({})),
  config: vi.fn(() => ({}) as object | null),
  cleanup: vi.fn(),
}))
vi.mock("@/lib/server/archive/config", () => ({
  readArchiveConfig: mocks.config,
}))
vi.mock("@/lib/server/archive/audit", () => ({
  runArchiveAudit: mocks.audit,
  archiveStatus: mocks.status,
}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }))
vi.mock("@/lib/server/lifecycle", () => ({ runCleanup: mocks.cleanup }))

import { GET as runAudit } from "@/app/api/internal/media-archive/route"
import { GET as readStatus } from "@/app/api/internal/media-archive/status/route"
import { GET as runCleanup } from "@/app/api/internal/cleanup/route"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  mocks.config.mockReturnValue({})
})
const secret = "fixture-secret-".repeat(4)
const monitorSecret = "fixture-monitor-".repeat(4)
function request(authorized = true, credential = secret) {
  return new Request("https://fixture.example/api/internal/media-archive", {
    headers: authorized ? { authorization: `Bearer ${credential}` } : {},
  })
}

describe("private archive operational endpoints", () => {
  it("never creates a privileged client or starts a copy for unsigned requests", async () => {
    vi.stubEnv("CLEANUP_SECRET", secret)
    for (const endpoint of [runAudit, readStatus]) {
      const response = await endpoint(request(false))
      expect(response.status).toBe(401)
      expect(response.headers.get("cache-control")).toContain("no-store")
    }
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it("fails closed when the operational secret is absent", async () => {
    vi.stubEnv("CLEANUP_SECRET", "")
    vi.stubEnv("MEDIA_ARCHIVE_MONITOR_SECRET", "")
    expect((await runAudit(request())).status).toBe(503)
    expect((await readStatus(request())).status).toBe(503)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it("grants the monitor credential only read-only status access", async () => {
    vi.stubEnv("CLEANUP_SECRET", secret)
    vi.stubEnv("MEDIA_ARCHIVE_MONITOR_SECRET", monitorSecret)
    mocks.status.mockResolvedValueOnce({ ok: true, status: "current" })
    const read = await readStatus(request(true, monitorSecret))
    expect(read.status).toBe(200)
    expect(read.headers.get("cache-control")).toBe("private, no-store")
    expect(mocks.status).toHaveBeenCalledOnce()
    vi.clearAllMocks()
    const mutate = await runAudit(request(true, monitorSecret))
    expect(mutate.status).toBe(401)
    expect((await runCleanup(request(true, monitorSecret))).status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.cleanup).not.toHaveBeenCalled()
  })
  it("keeps cleanup access working and rejects missing or short monitor tokens", async () => {
    vi.stubEnv("CLEANUP_SECRET", secret)
    vi.stubEnv("MEDIA_ARCHIVE_MONITOR_SECRET", "too-short")
    mocks.status.mockResolvedValueOnce({ ok: true, status: "current" })
    expect((await readStatus(request())).status).toBe(200)
    expect((await readStatus(request(true, "too-short"))).status).toBe(401)
    expect((await readStatus(request(false))).status).toBe(401)
  })
  it("reports partial audit and stale status as unavailable", async () => {
    vi.stubEnv("CLEANUP_SECRET", secret)
    mocks.audit.mockResolvedValueOnce({
      status: "completed",
      complete: false,
      checked: 50,
    })
    mocks.status.mockResolvedValueOnce({ ok: false, status: "stale" })
    expect((await runAudit(request())).status).toBe(503)
    expect((await readStatus(request())).status).toBe(503)
  })
  it("skips only explicitly verified disabled staging without a privileged client", async () => {
    vi.stubEnv("CLEANUP_SECRET", secret)
    vi.stubEnv("VERCEL_ENV", "production")
    vi.stubEnv("NABALENS_ENVIRONMENT", "staging")
    mocks.config.mockReturnValue(null)
    const response = await runAudit(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "disabled", skipped: true })
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it("fails closed before creating a client for invalid hosted identity", async () => {
    vi.stubEnv("CLEANUP_SECRET", secret)
    mocks.config.mockImplementationOnce(() => {
      throw new Error("archive_environment_project_mismatch")
    })
    const silence = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect((await runAudit(request())).status).toBe(500)
      expect(mocks.admin).not.toHaveBeenCalled()
      expect(mocks.audit).not.toHaveBeenCalled()
    } finally {
      silence.mockRestore()
    }
  })
  it("does not expose provider exceptions in its response", async () => {
    vi.stubEnv("CLEANUP_SECRET", secret)
    mocks.audit.mockRejectedValueOnce(
      new Error("private-object-path and credential")
    )
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const response = await runAudit(request())
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: "archive_audit_failed" })
      expect(consoleError).toHaveBeenCalledWith("media archive audit failed")
    } finally {
      consoleError.mockRestore()
    }
  })
})
