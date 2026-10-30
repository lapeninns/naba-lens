// Shared harness for tests/integration/auth-*.test.ts (not a test file itself).
//
// These suites drive the app's real Route Handlers, Server Functions, pages and
// proxy() against the local Supabase stack, as separate signed-in people. A
// `Browser` is a cookie jar; while a call runs inside `browser.run(...)`, the
// mocked `next/headers` cookies() reads and writes that jar, exactly as Next
// would for one browser's request. Sessions come from real magic links (the
// login Server Function → Mailpit → GET /auth/confirm), never from the service
// role, so @supabase/ssr writes the same cookies a real browser holds.
//
// Each test file must install the mocks before importing app code:
//   vi.mock("server-only", () => ({}))
//   vi.mock("next/headers", () => import("./auth-support").then((m) => m.nextHeadersMock()))
//   vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))

import { createHmac } from "node:crypto"
import { execFileSync } from "node:child_process"

import { NextRequest } from "next/server"

import type { Db } from "../support/identities"
import { getLocalSupabaseEnv } from "../support/local-supabase"

type StoredCookie = { name: string; value: string }

export class Browser {
  readonly jar = new Map<string, string>()

  constructor(readonly label: string) {}

  /** Runs `fn` as a request from this browser (cookies() reads/writes this jar). */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = current
    current = this
    try {
      return await fn()
    } finally {
      current = previous
    }
  }

  cookieHeader(): string {
    return [...this.jar].map(([n, v]) => `${n}=${v}`).join("; ")
  }

  authCookies(): StoredCookie[] {
    return [...this.jar]
      .filter(
        ([name]) => name.startsWith("sb-") && name.includes("-auth-token")
      )
      .map(([name, value]) => ({ name, value }))
  }

  /** Applies a response's Set-Cookie list (as a browser would). */
  absorb(cookies: { name: string; value: string; maxAge?: number }[]) {
    for (const c of cookies) {
      if (c.maxAge === 0 || c.value === "") this.jar.delete(c.name)
      else this.jar.set(c.name, c.value)
    }
  }
}

let current: Browser | null = null

function activeJar(): Browser {
  if (!current) {
    throw new Error("cookies() called outside browser.run(...) in a test")
  }
  return current
}

/** Module body for vi.mock("next/headers"). */
export function nextHeadersMock() {
  const store = {
    getAll: () =>
      [...activeJar().jar].map(([name, value]) => ({ name, value })),
    get: (name: string) => {
      const value = activeJar().jar.get(name)
      return value === undefined ? undefined : { name, value }
    },
    has: (name: string) => activeJar().jar.has(name),
    set: (
      name: string | { name: string; value: string; maxAge?: number },
      value?: string,
      options?: { maxAge?: number }
    ) => {
      const c =
        typeof name === "string"
          ? { name, value: value ?? "", maxAge: options?.maxAge }
          : name
      activeJar().absorb([c])
    },
    delete: (name: string) => {
      activeJar().jar.delete(name)
    },
  }
  return {
    cookies: async () => store,
    headers: async () => new Headers(),
    draftMode: async () => ({ isEnabled: false }),
  }
}

// ---------------------------------------------------------------------------
// Next control flow
// ---------------------------------------------------------------------------

/**
 * Runs a page/Server Function and reports where Next's redirect() sent it, or
 * `null` when it returned normally. Any other error is rethrown.
 */
export async function redirectOf(
  fn: () => Promise<unknown>
): Promise<{ location: string | null; value: unknown }> {
  try {
    return { location: null, value: await fn() }
  } catch (error) {
    const digest = (error as { digest?: unknown })?.digest
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) {
      return { location: digest.split(";")[2] ?? null, value: undefined }
    }
    throw error
  }
}

export const APP_ORIGIN = "http://127.0.0.1:3000"

export function appRequest(
  browser: Browser,
  path: string,
  init: RequestInit = {}
): NextRequest {
  const headers = new Headers(init.headers)
  const cookie = browser.cookieHeader()
  if (cookie) headers.set("cookie", cookie)
  return new NextRequest(new URL(path, APP_ORIGIN), { ...init, headers })
}

// ---------------------------------------------------------------------------
// Real magic links via Mailpit
// ---------------------------------------------------------------------------

function mailpit(): string {
  const url = getLocalSupabaseEnv().mailpitUrl
  if (!url) throw new Error("Mailpit URL unavailable for the local stack")
  return url
}

type MailSummary = { ID: string; Subject: string }

async function messagesTo(email: string): Promise<MailSummary[]> {
  const search = await fetch(
    `${mailpit()}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=50`
  ).then((r) => r.json())
  return (search.messages ?? []) as MailSummary[]
}

export async function mailCount(email: string, subject?: RegExp) {
  const all = await messagesTo(email)
  return subject
    ? all.filter((m) => subject.test(m.Subject)).length
    : all.length
}

/**
 * Waits for a new email to `email` (more than `seen` messages) and returns the
 * /auth/confirm path from its link, relative to the site origin.
 */
export async function nextConfirmLink(
  email: string,
  seen: number
): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const messages = await messagesTo(email)
    if (messages.length > seen) {
      const message = await fetch(
        `${mailpit()}/api/v1/message/${messages[0].ID}`
      ).then((r) => r.json())
      const match = String(message.HTML).match(
        /href="[^"]*(\/auth\/confirm\?[^"]+)"/
      )
      if (!match) throw new Error("Email has no /auth/confirm link")
      return match[1].replace(/&amp;/g, "&")
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`No new email arrived for ${email}`)
}

/**
 * The /auth/confirm link the magic-link email would contain for `email`, issued
 * with the admin API. Same token_hash and expiry rules as the emailed link, but
 * it does not count against the stack's hourly /otp email quota (2 by default).
 */
export async function issueSignInLink(
  service: Db,
  email: string
): Promise<string> {
  const { data, error } = await service.auth.admin.generateLink({
    type: "magiclink",
    email,
  })
  if (error || !data?.properties) throw error ?? new Error("No link issued")
  return `/auth/confirm?token_hash=${data.properties.hashed_token}&type=email`
}

export function tokenHashOf(confirmPath: string): string {
  const hash = new URL(confirmPath, APP_ORIGIN).searchParams.get("token_hash")
  if (!hash) throw new Error("Link has no token_hash")
  return hash
}

// ---------------------------------------------------------------------------
// Direct database access for time travel (local stack only)
// ---------------------------------------------------------------------------

type StackStatus = { DB_URL?: string; JWT_SECRET?: string }
let status: StackStatus | null = null

function stackStatus(): StackStatus {
  if (status) return status
  if (process.env.SUPABASE_DB_URL && process.env.SUPABASE_JWT_SECRET) {
    status = {
      DB_URL: process.env.SUPABASE_DB_URL,
      JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
    }
    return status
  }
  const raw = execFileSync("supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
  status = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1))
  return status!
}

function localDbUrl(): string {
  const url = stackStatus().DB_URL
  if (!url) throw new Error("Set SUPABASE_DB_URL for the local stack")
  const host = new URL(url).hostname
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Refusing to touch non-local database host ${host}`)
  }
  return url
}

/** Runs SQL as postgres on the LOCAL stack (psql). Values must be test-made UUIDs. */
export function localSql(sql: string): string {
  return execFileSync(
    "psql",
    [localDbUrl(), "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim()
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Makes every outstanding email link for this user older than the stack's
 * otp_expiry (1 h), as if the person opened it two hours later.
 */
export function ageEmailLinks(userId: string, hours = 2) {
  if (!UUID.test(userId)) throw new Error("not a uuid")
  localSql(
    `update auth.users set
       recovery_sent_at = recovery_sent_at - interval '${hours} hours',
       confirmation_sent_at = confirmation_sent_at - interval '${hours} hours',
       invited_at = invited_at - interval '${hours} hours'
     where id = '${userId}';
     update auth.one_time_tokens set created_at = created_at - interval '${hours} hours'
     where user_id = '${userId}';`
  )
}

// ---------------------------------------------------------------------------
// Expired access tokens
// ---------------------------------------------------------------------------

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url")
}

/**
 * The same access token re-signed with the local stack's legacy HS256 secret
 * (which PostgREST and Auth still accept; the anon key is such a token), with
 * `exp` moved by `expiresInSeconds`. A negative value is what a browser holds
 * once its one-hour token has lapsed. Local user tokens are ES256 and the CLI's
 * private key is not available, hence the re-signing.
 */
export function resignAccessToken(
  token: string,
  expiresInSeconds: number
): string {
  const payload = token.split(".")[1]
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  const now = Math.floor(Date.now() / 1000)
  claims.exp = now + expiresInSeconds
  claims.iat = Math.min(claims.iat ?? now, claims.exp - 3600)
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const body = `${header}.${b64url(JSON.stringify(claims))}`
  const secret = stackStatus().JWT_SECRET
  if (!secret) throw new Error("Set SUPABASE_JWT_SECRET for the local stack")
  const sig = createHmac("sha256", secret).update(body).digest()
  return `${body}.${b64url(sig)}`
}

/** Decodes @supabase/ssr's session cookie(s) (`base64-` JSON, possibly chunked). */
export function readSessionCookie(browser: Browser): {
  name: string
  session: Record<string, unknown> & {
    access_token: string
    refresh_token: string
    expires_at: number
  }
} {
  const cookies = browser
    .authCookies()
    .filter((c) => !c.name.includes("code-verifier"))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
  if (cookies.length === 0) throw new Error("No session cookie")
  const base = cookies[0].name.replace(/\.\d+$/, "")
  const raw = cookies.map((c) => c.value).join("")
  const json = raw.startsWith("base64-")
    ? Buffer.from(raw.slice(7), "base64url").toString("utf8")
    : decodeURIComponent(raw)
  return { name: base, session: JSON.parse(json) }
}

/** Replaces the browser's session cookie(s) with `session`. */
export function writeSessionCookie(
  browser: Browser,
  name: string,
  session: object
) {
  for (const key of [...browser.jar.keys()]) {
    if (key === name || key.startsWith(`${name}.`)) browser.jar.delete(key)
  }
  browser.jar.set(
    name,
    `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`
  )
}
