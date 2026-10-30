import { beforeEach, describe, expect, it, vi } from "vitest"

// Final review F9: the /admin and /staff layouts added another getAuthState()
// (claims plus a profile query) to every render. It is wrapped in React
// `cache()`, so one render pass reads once; outside a render (Server Functions,
// Route Handlers) and in the next request, every call reads afresh.
//
// The real react-server build of `cache`, with a request scope simulated the
// way React's Flight renderer provides one (the async dispatcher).
const { serverReact } = vi.hoisted(() => {
  // Hoisted above the imports, so builtins come from process directly.
  const { createRequire } = process.getBuiltinModule("node:module")
  const { dirname, join } = process.getBuiltinModule("node:path")
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve("react/package.json"))
  return {
    serverReact: require(
      join(root, "cjs/react.react-server.development.js")
    ) as {
      __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
        A: unknown
      }
    },
  }
})
vi.mock("react", () => serverReact)
vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))

const profileReads = vi.fn()
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: { claims: { sub: "u1", email: "a@nabalens.test" } },
        error: null,
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            profileReads()
            return {
              data: {
                id: "u1",
                display_name: "TEST",
                avatar_path: null,
                job_title: null,
                role: "admin",
                venue_id: null,
                active: true,
                venue: null,
              },
              error: null,
            }
          },
        }),
      }),
    }),
  }),
}))

const { getAuthState, requireActiveAdmin } = await import("@/lib/auth")

const internals =
  serverReact.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

/** Runs `work` inside one simulated render pass with its own cache. */
async function inRender<T>(work: () => Promise<T>): Promise<T> {
  const caches = new Map<() => unknown, unknown>()
  internals.A = {
    getCacheForType: (create: () => unknown) => {
      if (!caches.has(create)) caches.set(create, create())
      return caches.get(create)
    },
  }
  try {
    return await work()
  } finally {
    internals.A = null
  }
}

beforeEach(() => profileReads.mockClear())

describe("getAuthState per-request memo (final review F9)", () => {
  it("layout gate and page share one profile read per render", async () => {
    await inRender(async () => {
      await requireActiveAdmin() // layout
      await requireActiveAdmin() // page
      await getAuthState() // another component
    })
    expect(profileReads).toHaveBeenCalledTimes(1)
  })

  it("every request, Server Function and Route Handler reads afresh", async () => {
    await inRender(() => getAuthState())
    await inRender(() => getAuthState())
    expect(profileReads).toHaveBeenCalledTimes(2)
    // No render pass: no memo at all.
    await getAuthState()
    await getAuthState()
    expect(profileReads).toHaveBeenCalledTimes(4)
  })
})
