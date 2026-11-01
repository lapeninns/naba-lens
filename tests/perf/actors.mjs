// Sessions and MediaActors for the perf harness. Signs in the generated PERF
// people through the same magic-link token path as tests/load/run.mjs, and builds
// the MediaActor the app builds per request (lib/server/media/context.ts), with
// every PostgREST/Storage request counted and timed.
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"

export async function signIn(env, email) {
  const service = createClient(env.apiUrl, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: link, error } = await service.auth.admin.generateLink({
    type: "magiclink",
    email,
  })
  if (error) throw error
  const jar = new Map()
  const ssr = createServerClient(env.apiUrl, env.publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) =>
        list.forEach(({ name, value }) =>
          value ? jar.set(name, value) : jar.delete(name)
        ),
    },
  })
  const { data, error: vErr } = await ssr.auth.verifyOtp({
    type: "email",
    token_hash: link.properties.hashed_token,
  })
  if (vErr) throw vErr
  return {
    userId: data.user.id,
    email,
    accessToken: data.session.access_token,
    cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; "),
  }
}

/** A request log shared by every client of one actor. */
export function requestLog() {
  const entries = []
  return {
    entries,
    reset: () => (entries.length = 0),
    snapshot: () => ({
      requests: entries.length,
      requestMs: entries.reduce((a, e) => a + e.ms, 0),
      errors: entries.filter((e) => e.status >= 400).map((e) => ({
        status: e.status,
        path: e.path,
        body: e.body,
      })),
    }),
  }
}

function instrumentedFetch(log) {
  return async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    const t = performance.now()
    const res = await fetch(input, init)
    const entry = {
      ms: performance.now() - t,
      status: res.status,
      path: url.pathname.replace(/^\/rest\/v1\//, "").replace(/^\/storage\/v1\//, "storage/"),
    }
    if (res.status >= 400) {
      entry.body = (await res.clone().text()).slice(0, 300)
    }
    log.entries.push(entry)
    return res
  }
}

/** The MediaActor of a signed-in PERF person, plus its request log. */
export function makeActor(env, session, profile) {
  const log = requestLog()
  const clientFor = (key, token) =>
    createClient(env.apiUrl, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: instrumentedFetch(log),
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    })
  return {
    log,
    actor: {
      profile: {
        id: session.userId,
        email: session.email,
        displayName: profile.displayName,
        avatarPath: null,
        jobTitle: null,
        role: profile.role,
        venueId: profile.venueId,
        venue: null,
        active: true,
      },
      db: clientFor(env.publishableKey, session.accessToken),
      service: clientFor(env.serviceKey, null),
      storage: { url: env.apiUrl, serviceKey: env.serviceKey },
    },
  }
}

/** Runs `fn` `warm + n` times; returns per-iteration wall ms and request stats. */
export async function timeIt(fn, { warm = 3, n = 20, log } = {}) {
  const rows = []
  for (let i = 0; i < warm + n; i++) {
    log?.reset()
    const t = performance.now()
    let result
    try {
      result = await fn()
    } catch (e) {
      result = { threw: String(e?.message ?? e) }
    }
    const ms = performance.now() - t
    if (i >= warm) {
      rows.push({ ms, ...(log?.snapshot() ?? {}), result })
    }
  }
  return rows
}
