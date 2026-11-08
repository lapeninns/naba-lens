import { afterEach, describe, expect, it, vi } from "vitest"

import {
  homePathFor,
  loginHref,
  RETURN_TO_COOKIE,
  RETURN_TO_PARAM,
  returnPathFor,
  returnToCookieOptions,
  safeReturnPath,
  type AppRole,
} from "@/lib/auth/routes"

describe("safeReturnPath keeps app pages", () => {
  it.each([
    "/staff",
    "/staff/tasks/4f1c2d3e-0000-4000-8000-000000000001",
    "/staff/manage/amenities/abc",
    "/staff/caf%C3%A9",
    "/manager",
    "/manager/review?status=pending&sort=new",
    "/manager/review?q=a%20b",
    "/manager/review?q=100%25",
    "/admin",
    "/admin/menus/0f8f6b2e-1111-4111-8111-111111111111",
  ])("%s", (path) => {
    expect(safeReturnPath(path)).toBe(path)
  })
})

describe("safeReturnPath refuses", () => {
  it.each<[string, unknown]>([
    // Not a string, empty or too long.
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["an array (repeated ?next=)", ["/staff"]],
    ["empty", ""],
    ["over 1024 characters", `/staff/${"a".repeat(1100)}`],
    // Not relative, or protocol-relative.
    ["a bare word", "staff/tasks"],
    ["protocol-relative", "//evil.example"],
    ["protocol-relative into an app path", "//evil.example/staff"],
    ["an absolute https URL", "https://evil.example/staff"],
    ["an absolute same-site URL", "http://127.0.0.1:3000/staff"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["a leading space", " /staff"],
    // Backslashes, raw and encoded.
    ["slash-backslash", "/\\evil.example"],
    ["double backslash", "\\\\evil.example"],
    ["a backslash inside", "/staff\\..\\api"],
    ["an encoded backslash", "/staff/%5C%5Cevil.example"],
    ["a lower-case encoded backslash", "/staff/%5cevil"],
    // Encoded and double-encoded slashes and dot segments.
    ["an encoded //", "/%2F%2Fevil.example"],
    ["an encoded // inside an app path", "/staff/%2F%2Fevil.example"],
    ["a double-encoded //", "/staff/%252F%252Fevil.example"],
    ["a triple-encoded //", "/staff/%25252F%25252Fevil.example"],
    ["more encoding layers than allowed", "/staff/%2525252F"],
    ["an encoded-slash escape from the area", "/staff%2F..%2F..%2Fapi"],
    ["a dot segment", "/staff/../admin"],
    ["a single-dot segment", "/staff/./tasks"],
    ["an encoded dot segment", "/staff/%2e%2e/api"],
    ["a double-encoded dot segment", "/staff/%252e%252e/%252e%252e/api"],
    ["a trailing encoded dot segment", "/staff/%252e%252e"],
    // Schemes hidden in the path.
    ["a scheme in the path", "/staff/javascript:alert(1)"],
    ["an encoded scheme", "/staff/https%3A%2F%2Fevil.example"],
    // Control characters, raw and encoded, in path and query.
    ["a raw newline", "/staff/tasks\n"],
    ["a raw tab", "/staff\t/tasks"],
    ["a raw NUL", "/staff/\u0000"],
    ["an encoded CRLF", "/staff/%0d%0aSet-Cookie:x=1"],
    ["an encoded NUL", "/staff/%00"],
    ["an encoded DEL", "/staff/%7F"],
    ["a double-encoded CRLF", "/staff/%250d%250a"],
    ["an encoded CRLF in the query", "/manager/review?x=%0d%0aSet-Cookie:x=1"],
    ["a malformed escape", "/staff/%zz"],
    ["a malformed escape in the query", "/staff?q=%E0%A4%A"],
    ["non-ASCII", "/staff/café"],
    ["a fragment", "/staff/tasks#top"],
    // Outside the app areas: sign-in, auth and API paths.
    ["the site root", "/"],
    ["/login", "/login"],
    ["/login with a nested next", "/login?next=/staff"],
    ["/auth/confirm", "/auth/confirm?token_hash=x&type=email"],
    ["/auth/callback", "/auth/callback?code=x"],
    ["/auth/logout", "/auth/logout"],
    ["/api", "/api/library"],
    ["/api/internal", "/api/internal/cleanup"],
    ["a look-alike prefix", "/staffroom"],
    ["another look-alike prefix", "/managers"],
    ["a different case", "/STAFF/tasks"],
    ["an at-sign host trick", "/admin@evil.example"],
  ])("%s", (_name, raw) => {
    expect(safeReturnPath(raw)).toBeNull()
  })
})

describe("returnPathFor (applied after sign-in)", () => {
  const roles: AppRole[] = ["staff", "manager", "admin"]

  it("returns each role to a page in its own area", () => {
    expect(returnPathFor("staff", "/staff/tasks/t1")).toBe("/staff/tasks/t1")
    expect(returnPathFor("manager", "/manager/review?status=pending")).toBe(
      "/manager/review?status=pending"
    )
    expect(returnPathFor("admin", "/admin/menus/v1")).toBe("/admin/menus/v1")
  })

  it("sends a wrong-role path to the role's home, never into another area", () => {
    expect(returnPathFor("staff", "/admin/menus/v1")).toBe("/staff/tasks")
    expect(returnPathFor("staff", "/manager/review")).toBe("/staff/tasks")
    expect(returnPathFor("manager", "/staff/tasks/t1")).toBe("/manager")
    expect(returnPathFor("manager", "/admin")).toBe("/manager")
    expect(returnPathFor("admin", "/manager/review")).toBe("/admin")
    expect(returnPathFor("admin", "/staff/manage")).toBe("/admin")
  })

  it("sends anything unsafe or missing to the role's home", () => {
    for (const role of roles) {
      for (const raw of [undefined, "", "//evil.example", "/login", "/api/x"]) {
        expect(returnPathFor(role, raw), `${role} ${String(raw)}`).toBe(
          homePathFor(role)
        )
      }
    }
  })
})

describe("loginHref", () => {
  it("links to /login, carrying a safe return path encoded", () => {
    expect(loginHref()).toBe("/login")
    expect(loginHref(null)).toBe("/login")
    expect(loginHref("/manager/review?status=pending")).toBe(
      `/login?${RETURN_TO_PARAM}=%2Fmanager%2Freview%3Fstatus%3Dpending`
    )
  })

  it("drops an unsafe return path", () => {
    for (const raw of ["//evil.example", "https://evil.example", "/login"]) {
      expect(loginHref(raw), raw).toBe("/login")
    }
  })
})

describe("return cookie", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("is HttpOnly, Lax, site-wide and short-lived", () => {
    expect(RETURN_TO_COOKIE).toBe("nl-return-to")
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3000")
    expect(returnToCookieOptions()).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 3600,
    })
  })

  it("is Secure on HTTPS and on an HTTPS site behind a TLS proxy", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3000")
    expect(returnToCookieOptions(true).secure).toBe(true)
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://lens.example")
    expect(returnToCookieOptions(false).secure).toBe(true)
  })
})
