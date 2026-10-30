import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  createClient: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }))
vi.mock("@/lib/supabase/env", () => ({ getSiteUrl: () => "https://app.test" }))

import { requestSignInLink } from "@/app/login/actions"
import {
  getLoginCaptchaConfig,
  normaliseCaptchaToken,
} from "@/lib/auth/captcha"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})

function configure(key = "site-key") {
  vi.stubEnv("AUTH_CAPTCHA_ENABLED", "true")
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", key)
  mocks.signInWithOtp.mockResolvedValue({ error: null })
  mocks.createClient.mockResolvedValue({
    auth: { signInWithOtp: mocks.signInWithOtp },
  })
}

describe("login CAPTCHA", () => {
  it("defaults to disabled for fixtures, while a site key always enables it", () => {
    vi.stubEnv("AUTH_CAPTCHA_ENABLED", "")
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "")
    expect(getLoginCaptchaConfig()).toEqual({ enabled: false, siteKey: null })
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", " public-key ")
    expect(getLoginCaptchaConfig()).toEqual({
      enabled: true,
      siteKey: "public-key",
    })
  })

  it("rejects missing, non-string and oversized tokens before reaching Auth", async () => {
    configure()
    for (const token of [undefined, " ", 12, "a".repeat(2049)]) {
      expect(
        await requestSignInLink("staff@example.test", token as never)
      ).toHaveProperty("error")
    }
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(normaliseCaptchaToken(" token ")).toBe("token")
  })

  it("fails closed when the enabled deployment omitted its public key", async () => {
    configure("")
    expect(await requestSignInLink("staff@example.test", "token")).toEqual({
      error: "Sign-in verification is unavailable. Please try again later.",
    })
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it("passes a valid token once and returns a recoverable CAPTCHA failure", async () => {
    configure()
    mocks.signInWithOtp.mockResolvedValue({
      error: { code: "captcha_failed", status: 400 },
    })
    expect(
      await requestSignInLink(" Staff@Example.Test ", " token ")
    ).toHaveProperty("error")
    expect(mocks.signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email: "staff@example.test",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://app.test/auth/callback",
        captchaToken: "token",
      },
    })
  })

  it("preserves the disabled local login without forwarding arbitrary tokens", async () => {
    configure("")
    vi.stubEnv("AUTH_CAPTCHA_ENABLED", "")
    expect(
      await requestSignInLink("staff@example.test", "unused-token")
    ).toEqual({})
    expect(mocks.signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email: "staff@example.test",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://app.test/auth/callback",
      },
    })
  })

  it("allows only Turnstile's documented script/frame origin when enabled", async () => {
    configure()
    vi.resetModules()
    const { default: nextConfig } = await import("../../next.config")
    expect(nextConfig.logging).toMatchObject({ serverFunctions: false })
    const rules = await nextConfig.headers!()
    const csp = rules[0].headers.find(
      (header) => header.key === "Content-Security-Policy"
    )!.value
    expect(csp).toMatch(
      /script-src[^;]* https:\/\/challenges\.cloudflare\.com(?:;|$)/
    )
    expect(csp).toContain("frame-src 'self' https://challenges.cloudflare.com;")
    expect(csp).not.toMatch(/connect-src[^;]*challenges\.cloudflare/)
    expect(csp).not.toContain("https://*.cloudflare.com")
  })

  it("does not load third-party challenge origins when fixtures disable CAPTCHA", async () => {
    configure("")
    vi.stubEnv("AUTH_CAPTCHA_ENABLED", "")
    vi.resetModules()
    const { default: nextConfig } = await import("../../next.config")
    const rules = await nextConfig.headers!()
    const csp = rules[0].headers.find(
      (header) => header.key === "Content-Security-Policy"
    )!.value
    expect(csp).not.toContain("challenges.cloudflare.com")
  })
})
