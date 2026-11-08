import { readdirSync, readFileSync, statSync, existsSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SESSION_ENDED_MESSAGE } from "@/lib/auth/session-ended"

const session = vi.hoisted(() => ({ userId: null as string | null }))
vi.mock("@/lib/supabase/proxy", () => ({
  updateSession: async (request: NextRequest) => {
    const response = NextResponse.next({ request })
    // What @supabase/ssr does for a lapsed session: clear the auth cookie.
    if (!session.userId)
      response.cookies.set("sb-x-auth-token", "", { maxAge: 0 })
    response.headers.set("cache-control", "private, no-store")
    return { response, userId: session.userId }
  },
}))

const { proxy } = await import("@/proxy")

const ORIGIN = "http://127.0.0.1:3000"

function request(
  path: string,
  init: {
    method?: string
    headers?: Record<string, string>
    cookie?: string
  } = {}
) {
  const headers = new Headers(init.headers)
  if (init.cookie) headers.set("cookie", init.cookie)
  return new NextRequest(new URL(path, ORIGIN), {
    method: init.method ?? "GET",
    headers,
  })
}

const returnCookie = (res: Response) =>
  (res.headers.getSetCookie?.() ?? []).filter((c) =>
    c.startsWith("nl-return-to=")
  )

beforeEach(() => {
  session.userId = null
})

describe("proxy: signed out on an app page", () => {
  it("sends the visitor to /login with the page and query to return to", async () => {
    const res = await proxy(request("/manager/review?status=pending&sort=new"))
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get("location")!)
    expect(location.pathname).toBe("/login")
    expect(location.searchParams.get("next")).toBe(
      "/manager/review?status=pending&sort=new"
    )
    // The lapsed session's cookies and no-store still travel with it.
    expect(res.cookies.get("sb-x-auth-token")?.value).toBe("")
    expect(res.headers.get("cache-control")).toBe("private, no-store")
  })

  it("remembers the page in a validated, HttpOnly, Lax, short-lived cookie", async () => {
    const res = await proxy(request("/staff/tasks/t1"))
    const cookie = res.cookies.get("nl-return-to")
    expect(cookie).toMatchObject({
      value: "/staff/tasks/t1",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
    })
  })

  it("marks the cookie Secure on HTTPS", async () => {
    const res = await proxy(
      new NextRequest("https://lens.example/admin/menus/v1")
    )
    expect(res.cookies.get("nl-return-to")?.secure).toBe(true)
  })

  it("drops the router's _rsc cache-buster from the return path", async () => {
    const res = await proxy(
      request("/manager/review?status=pending&_rsc=abc123", {
        headers: { rsc: "1" },
      })
    )
    expect(new URL(res.headers.get("location")!).searchParams.get("next")).toBe(
      "/manager/review?status=pending"
    )
  })

  it("does not remember a prefetched page", async () => {
    for (const headers of [
      { "next-router-prefetch": "1", rsc: "1" },
      { "sec-purpose": "prefetch" },
    ] as Record<string, string>[]) {
      const res = await proxy(request("/staff/people", { headers }))
      expect(res.status).toBe(307)
      expect(returnCookie(res)).toEqual([])
    }
  })

  it("sends an unsafe path to plain /login and remembers nothing", async () => {
    for (const path of [
      "/staff/%5C%5Cevil.example",
      "/staff/%252F%252Fevil.example",
      "/staff/%0d%0aSet-Cookie:x=1",
      "/admin/https%3A%2F%2Fevil.example",
    ]) {
      const res = await proxy(request(path))
      expect(res.status, path).toBe(307)
      expect(new URL(res.headers.get("location")!).search, path).toBe("")
      expect(returnCookie(res), path).toEqual([])
    }
  })

  it("answers a form posted without JavaScript with 303, not a re-POST", async () => {
    const res = await proxy(
      request("/admin/staff", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      })
    )
    expect(res.status).toBe(303)
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login")
  })
})

describe("proxy: a Server Action posted without a session", () => {
  it("is refused on an app page with a plain-text 401 Next shows as the error", async () => {
    for (const path of [
      "/manager/review",
      "/manager/account",
      "/admin/staff/x",
      "/staff/tasks",
    ]) {
      const res = await proxy(
        request(path, { method: "POST", headers: { "next-action": "abc123" } })
      )
      expect(res.status, path).toBe(401)
      // Next reads the body only for exactly "text/plain".
      expect(res.headers.get("content-type"), path).toBe("text/plain")
      expect(await res.text(), path).toBe(SESSION_ENDED_MESSAGE)
      expect(res.headers.get("location"), path).toBeNull()
      expect(res.cookies.get("sb-x-auth-token")?.value, path).toBe("")
      expect(res.headers.get("cache-control"), path).toBe("private, no-store")
    }
  })

  it("passes through on every page reachable signed out, so their actions still run", async () => {
    for (const path of [
      "/",
      "/login",
      "/login?next=%2Fmanager%2Freview",
      "/login?error=link_invalid",
      "/auth/confirm?token_hash=x&type=email",
      "/auth/confirm/verify",
      "/auth/callback?code=x",
      "/auth/blocked",
      "/auth/logout",
      "/no-such-page",
    ]) {
      const res = await proxy(
        request(path, { method: "POST", headers: { "next-action": "abc123" } })
      )
      expect(res.status, path).toBe(200)
      expect(res.headers.get("x-middleware-next"), path).toBe("1")
      expect(returnCookie(res), path).toEqual([])
    }
  })
})

describe("proxy: signed in", () => {
  beforeEach(() => {
    session.userId = "user-1"
  })

  it("clears the remembered page once an app page opens", async () => {
    const res = await proxy(
      request("/staff/tasks", { cookie: "nl-return-to=%2Fadmin%2Fmenus" })
    )
    expect(res.headers.get("x-middleware-next")).toBe("1")
    const cleared = returnCookie(res)
    expect(cleared).toHaveLength(1)
    expect(cleared[0]).toMatch(/^nl-return-to=;/)
    expect(cleared[0]).toMatch(/Expires=Thu, 01 Jan 1970/)
  })

  it("clears it on any other signed-in request (blocked page, a second account's sign-in)", async () => {
    for (const path of ["/auth/blocked", "/login", "/auth/confirm/verify"]) {
      const res = await proxy(
        request(path, { cookie: "nl-return-to=%2Fstaff%2Ftasks%2Ft1" })
      )
      expect(returnCookie(res), path).toHaveLength(1)
    }
  })

  it("keeps it on / , which applies it after the role check", async () => {
    const res = await proxy(
      request("/", { cookie: "nl-return-to=%2Fstaff%2Ftasks%2Ft1" })
    )
    expect(returnCookie(res)).toEqual([])
  })

  it("sets no cookie when there is nothing to clear", async () => {
    expect(returnCookie(await proxy(request("/staff/tasks")))).toEqual([])
  })

  it("lets a signed-in Server Action through", async () => {
    const res = await proxy(
      request("/manager/review", {
        method: "POST",
        headers: { "next-action": "abc123" },
      })
    )
    expect(res.status).toBe(200)
  })
})

// Server Actions post to the page that called them, so only actions reachable
// from a public page can run signed out. Every module the public routes import
// (directly or not) is walked here: the login page's action is the only one,
// and it posts to /login, which the proxy passes through above.
describe("public pages reach only public Server Actions", () => {
  const root = resolve(__dirname, "../..")
  const entries: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(join(root, dir))) {
      const rel = join(dir, name)
      if (statSync(join(root, rel)).isDirectory()) walk(rel)
      else if (/\.tsx?$/.test(name)) entries.push(rel)
    }
  }
  walk("app/login")
  walk("app/auth")
  for (const file of [
    "app/page.tsx",
    "app/layout.tsx",
    "app/error.tsx",
    "app/global-error.tsx",
    "app/not-found.tsx",
  ])
    if (existsSync(join(root, file))) entries.push(file)

  function resolveImport(from: string, spec: string) {
    let base: string
    if (spec.startsWith("@/")) base = join(root, spec.slice(2))
    else if (spec.startsWith(".")) base = resolve(root, dirname(from), spec)
    else return null
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, "index.ts"),
      join(base, "index.tsx"),
    ])
      if (existsSync(candidate) && statSync(candidate).isFile())
        return relative(root, candidate)
    return null
  }

  it("finds app/login/actions.ts and nothing else", () => {
    const seen = new Set<string>()
    const actions = new Set<string>()
    const queue = [...entries]
    while (queue.length) {
      const file = queue.pop()!
      if (seen.has(file)) continue
      seen.add(file)
      const source = readFileSync(join(root, file), "utf8")
      if (
        /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(
          source
        )
      )
        actions.add(file)
      for (const match of source.matchAll(
        /(?:from|import)\s*\(?\s*["']([^"']+)["']/g
      )) {
        const next = resolveImport(file, match[1])
        if (next) queue.push(next)
      }
    }
    expect(seen.size).toBeGreaterThan(50)
    expect([...actions]).toEqual(["app/login/actions.ts"])
  })
})
