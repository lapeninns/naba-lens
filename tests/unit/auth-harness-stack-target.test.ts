import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ exec: vi.fn() }))
vi.mock("node:child_process", () => ({ execFileSync: mocks.exec }))

const CONNECTION_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_DB_URL",
  "SUPABASE_JWT_SECRET",
] as const
const API = "http://127.0.0.1:59991"
const DB = "postgresql://postgres:fixture@127.0.0.1:59992/postgres"
const STATUS = { API_URL: API, DB_URL: DB, JWT_SECRET: "fixture-jwt-secret" }
beforeEach(() => {
  vi.resetModules()
  mocks.exec.mockReset()
  for (const key of CONNECTION_ENV) vi.stubEnv(key, undefined)
})
afterEach(() => vi.unstubAllEnvs())
function cliStatus(status = STATUS) {
  mocks.exec.mockImplementation((command: string) =>
    command === "supabase" ? JSON.stringify(status) : "1\n"
  )
}

describe("auth integration harness stack selection", () => {
  it.each(CONNECTION_ENV.filter((key) => !key.endsWith("URL")))(
    "refuses partial credentials in %s without invoking SQL",
    async (key) => {
      vi.stubEnv(key, "fixture-value")
      const { localSql } = await import("../integration/auth-support")
      expect(() => localSql("select 1")).toThrow(/refusing/i)
      expect(mocks.exec).not.toHaveBeenCalled()
    }
  )
  it("requires both direct values to be nonempty", async () => {
    vi.stubEnv("SUPABASE_DB_URL", DB)
    vi.stubEnv("SUPABASE_JWT_SECRET", " ")
    const { localSql } = await import("../integration/auth-support")
    expect(() => localSql("select 1")).toThrow(
      "partial direct-database configuration"
    )
    expect(mocks.exec).not.toHaveBeenCalled()
  })
  it("uses a complete explicit database configuration without default discovery", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", API)
    vi.stubEnv("SUPABASE_DB_URL", DB)
    vi.stubEnv("SUPABASE_JWT_SECRET", "fixture-jwt-secret")
    mocks.exec.mockReturnValue("1\n")
    const { localSql } = await import("../integration/auth-support")
    expect(localSql("select 1")).toBe("1")
    expect(mocks.exec).toHaveBeenCalledOnce()
    expect(mocks.exec.mock.calls[0][0]).toBe("psql")
    expect(mocks.exec.mock.calls[0][1][0]).toBe(DB)
  })
  it("allows the documented default workflow when discovered and configured APIs match exactly", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", API)
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fixture-public-key")
    cliStatus()
    const { localSql } = await import("../integration/auth-support")
    expect(localSql("select 1")).toBe("1")
    expect(mocks.exec.mock.calls.map((call) => call[0])).toEqual([
      "supabase",
      "psql",
    ])
    expect(mocks.exec.mock.calls[1][1][0]).toBe(DB)
  })
  it("fails before SQL when isolated API credentials do not match default CLI status", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:59993")
    cliStatus()
    const { localSql } = await import("../integration/auth-support")
    expect(() => localSql("update auth.users set updated_at = now()")).toThrow(
      "does not match CLI status API_URL"
    )
    expect(mocks.exec.mock.calls.map((call) => call[0])).toEqual(["supabase"])
  })
  it("checks signing and cached status against the current configured API", async () => {
    cliStatus()
    const { localSql, resignAccessToken } =
      await import("../integration/auth-support")
    expect(localSql("select 1")).toBe("1")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:59993")
    const token = `fixture.${Buffer.from(JSON.stringify({ sub: "fixture", iat: 1 })).toString("base64url")}.fixture`
    expect(() => resignAccessToken(token, -1)).toThrow(
      "does not match CLI status API_URL"
    )
    expect(() => localSql("select 2")).toThrow(
      "does not match CLI status API_URL"
    )
    expect(mocks.exec).toHaveBeenCalledTimes(2)
  })
  it("does not accept conflicting configured API identities", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", API)
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:59993")
    const { localSql } = await import("../integration/auth-support")
    expect(() => localSql("select 1")).toThrow("Conflicting explicit")
    expect(mocks.exec).not.toHaveBeenCalled()
  })
})
