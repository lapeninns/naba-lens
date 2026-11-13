// @vitest-environment jsdom
// B03 UI design §7.4: the Runs page renders its Start a dry run form. A
// Server Component may pass a Client Component only serializable props and
// Server Actions; a plain function prop makes the route fail to render.
import { cleanup, render, screen } from "@testing-library/react"
import { isValidElement, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
}))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/lib/auth", () => ({
  requireActiveAdmin: vi.fn(async () => ({
    id: "a1",
    displayName: "TEST Admin",
  })),
}))
// As the "use server" module exports it: a Server Reference, which may cross
// to a Client Component.
const SERVER_REFERENCE = Symbol.for("react.server.reference")
vi.mock("@/app/_knowledge/actions", () => ({
  reconcileAction: Object.assign(vi.fn(), {
    $$typeof: Symbol.for("react.server.reference"),
    $$id: "reconcileAction",
  }),
}))
vi.mock("@/lib/server/coverage", () => ({
  getCoverageActor: vi.fn(async () => ({
    ok: true,
    actor: {
      profile: { id: "a1" },
      db: {
        from: () => ({
          select: () => ({
            order: async () => ({
              data: [{ id: "v1", name: "TEST Venue" }],
              error: null,
            }),
          }),
        }),
      },
    },
  })),
}))
const knowledge = vi.hoisted(() => ({ listReconciliationRuns: vi.fn() }))
vi.mock("@/lib/knowledge-client/services", () => ({
  knowledgeServices: knowledge,
}))

import RunsPage from "@/app/admin/knowledge/runs/page"
import { StartDryRunForm } from "@/components/nabalens/knowledge/reconcile-controls"

beforeEach(() => {
  vi.clearAllMocks()
  knowledge.listReconciliationRuns.mockResolvedValue({
    ok: true,
    page: { items: [], nextCursor: null },
  })
})
afterEach(cleanup)

/** Every element in a rendered tree, children and element-valued props. */
function* elements(node: unknown): Generator<React.ReactElement> {
  if (Array.isArray(node)) {
    for (const n of node) yield* elements(n)
    return
  }
  if (!isValidElement(node)) return
  yield node
  for (const value of Object.values(node.props as Record<string, unknown>))
    yield* elements(value)
}

/** Whether React can send `value` from a Server to a Client Component. */
function crossesBoundary(value: unknown): boolean {
  if (typeof value === "function")
    return (value as { $$typeof?: symbol }).$$typeof === SERVER_REFERENCE
  if (
    value === null ||
    ["string", "number", "boolean", "undefined"].includes(typeof value)
  )
    return true
  if (Array.isArray(value)) return value.every(crossesBoundary)
  if (typeof value === "object")
    return Object.values(value as object).every(crossesBoundary)
  return false
}

async function page() {
  return RunsPage({ searchParams: Promise.resolve({}) })
}

describe("the Runs page", () => {
  it("passes Start a dry run only serializable props and its Server Action", async () => {
    const forms = [...elements(await page())].filter(
      (e) => e.type === StartDryRunForm
    )
    expect(forms).toHaveLength(1)
    const props = forms[0]!.props as Record<string, unknown>
    for (const [name, value] of Object.entries(props))
      expect(crossesBoundary(value), `prop ${name}`).toBe(true)
    expect(props.runBase).toBe("/admin/knowledge/runs")
  })

  it("renders the form and the empty runs list", async () => {
    render(await page())
    expect(screen.getByRole("button", { name: "Start dry run" })).toBeTruthy()
  })
})
