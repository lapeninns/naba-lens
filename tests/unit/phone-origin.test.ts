import { describe, expect, it } from "vitest"

import { canUseFixtureSignIn } from "@/lib/dev/phone-origin.mjs"
import { readArchiveConfig } from "@/lib/server/archive/config"

describe("fixture sign-in gate", () => {
  it.each([
    "http://localhost:61421",
    "http://127.0.0.1:61421",
    "http://[::1]:61421",
    "http://10.0.0.20:61421",
    "http://172.16.0.5:61421",
    "http://172.31.255.1:61421",
    "http://192.168.1.128:61421",
    "http://[fd00::1]:61421",
  ])("allows a development stack at %s only in development", (url) => {
    expect(canUseFixtureSignIn("development", url)).toBe(true)
    expect(canUseFixtureSignIn("production", url)).toBe(false)
    expect(canUseFixtureSignIn("test", url)).toBe(false)
    expect(canUseFixtureSignIn(undefined, url)).toBe(false)
  })

  it.each([
    undefined,
    "not a URL",
    "file://localhost/config",
    "http://0.0.0.0:61421",
    "http://172.15.0.1:61421",
    "http://172.32.0.1:61421",
    "http://100.64.0.1:61421",
    "https://project.supabase.co",
    "http://localhost.example.test",
    "http://192.168.1.128.example.test",
    "http://127.0.0.1@project.supabase.co",
    "http://example.test@127.0.0.1",
  ])("refuses a nonlocal or invalid target (%s)", (url) => {
    expect(canUseFixtureSignIn("development", url)).toBe(false)
  })
})

describe("phone development archive configuration", () => {
  const env = {
    NODE_ENV: "development",
    NEXT_PUBLIC_SUPABASE_URL: "http://192.168.1.128:61421",
    NABALENS_PHONE_HOST: "192.168.1.128",
    MEDIA_ARCHIVE_MODE: "disabled",
  }

  it("treats only the launcher's matching development host like loopback", () => {
    expect(readArchiveConfig(env)).toBeNull()
    expect(() =>
      readArchiveConfig({ ...env, NABALENS_PHONE_HOST: "10.0.0.1" })
    ).toThrow("archive_environment_not_configured")
    expect(() =>
      readArchiveConfig({
        ...env,
        NEXT_PUBLIC_SUPABASE_URL: "http://203.0.113.2:61421",
        NABALENS_PHONE_HOST: "203.0.113.2",
      })
    ).toThrow("archive_environment_not_configured")
  })

  it("preserves hosted checks even when given the phone development host", () => {
    expect(() => readArchiveConfig({ ...env, NODE_ENV: "production" })).toThrow(
      "archive_environment_not_configured"
    )
    expect(() => readArchiveConfig({ ...env, VERCEL_ENV: "preview" })).toThrow(
      "archive_environment_not_configured"
    )
    expect(() =>
      readArchiveConfig({
        ...env,
        NABALENS_ENVIRONMENT: "production",
        MEDIA_ARCHIVE_PRODUCTION_PROJECT_REF: "abcdefghijklmnopqrst",
      })
    ).toThrow("archive_production_requires_retention")
  })
})
