import type { NextConfig } from "next"
import { getLoginCaptchaConfig } from "./lib/auth/captcha"

/**
 * Baseline security headers (docs/reviews/wave3-review.md finding 7). The CSP is
 * static (no nonces, see node_modules/next/dist/docs/01-app/02-guides/
 * content-security-policy.md "Without Nonces"), so pages can stay statically
 * rendered; it is a backstop against injected scripts, framing and exfiltration.
 *
 * The browser talks to Supabase for application data:
 *   - connect-src: Auth, signed PUT and TUS uploads;
 *   - img-src / media-src: the app's /api/media/* and /api/avatars/* routes
 *     redirect to 60 s signed Storage URLs.
 * blob: and data: cover local upload previews (object URLs) and inline images.
 * NEXT_PUBLIC_SUPABASE_URL must be set when building, like the client code itself.
 * Configured Turnstile adds only its documented script/frame origin.
 */
const isDev = process.env.NODE_ENV === "development"

function supabaseOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

function contentSecurityPolicy(): string {
  const supabase = supabaseOrigin()
  const remote = supabase ? ` ${supabase}` : ""
  const secure = supabase?.startsWith("https://") ?? false
  const turnstile = getLoginCaptchaConfig().enabled
    ? " https://challenges.cloudflare.com"
    : ""
  const directives = [
    "default-src 'self'",
    // Next's inline bootstrap scripts need 'unsafe-inline' without nonces; React
    // dev tooling needs 'unsafe-eval' in development only.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${turnstile}`,
    `frame-src 'self'${turnstile}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data:${remote}`,
    `media-src 'self' blob:${remote}`,
    "font-src 'self' data:",
    `connect-src 'self'${remote}${isDev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only when Supabase itself is HTTPS: upgrading a local http://127.0.0.1
    // stack would break local development and tests.
    ...(secure && !isDev ? ["upgrade-insecure-requests"] : []),
  ]
  return directives.join("; ")
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera for in-app capture (upload dialog), same origin only; nothing else.
  {
    key: "Permissions-Policy",
    value:
      "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
  },
  { key: "X-Frame-Options", value: "DENY" },
]

const nextConfig: NextConfig = {
  // Next 16 development logs include Server Function arguments by default.
  // Sign-in arguments contain single-use CAPTCHA tokens and email addresses.
  logging: { serverFunctions: false },
  experimental: {
    serverActions: {
      // v0.3 menu drafts: MENU_IMPORT_LIMITS.documentMaxBytes (3 MiB) plus
      // protocol overhead. Every action still authorises and validates its own
      // input; the default 1 MB rejected valid large drafts (final review I-2).
      bodySizeLimit: "4mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
}

export default nextConfig
