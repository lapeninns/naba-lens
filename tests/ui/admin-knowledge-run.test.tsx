// @vitest-environment jsdom
// B03 UI design §7.4: a run page offers Import only for a fresh dry run.
import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
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
vi.mock("@/app/_knowledge/actions", () => ({ reconcileAction: vi.fn() }))
vi.mock("@/lib/server/coverage", () => ({
  getCoverageActor: vi.fn(async () => ({
    ok: true,
    actor: {
      profile: { id: "a1" },
      db: {
        from: () => ({
          select: () => ({ order: async () => ({ data: [], error: null }) }),
        }),
      },
    },
  })),
}))
const knowledge = vi.hoisted(() => ({ getReconciliationRun: vi.fn() }))
vi.mock("@/lib/knowledge-client/services", () => ({
  knowledgeServices: knowledge,
}))

import RunPage from "@/app/admin/knowledge/runs/[runId]/page"

const RUN = "8e000000-0000-4000-8000-000000000001"
const counts = {
  candidates: 5,
  proposals: 3,
  corroborating: 1,
  conflicting: 1,
  alreadyApplied: 0,
  skipped: 0,
}
const run = (startedAt: string, mode: "dry_run" | "apply" = "dry_run") => ({
  ok: true,
  run: {
    runId: RUN,
    kind: "legacy",
    mode,
    venueId: null,
    dryRunId: null,
    startedAt,
    counts,
    wouldCreate: [],
    conflicts: [],
    sourceRevisions: { legacy: 4 },
  },
})

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

async function show() {
  render(await RunPage({ params: Promise.resolve({ runId: RUN }) }))
}

describe("a run page", () => {
  it("says what the dry run found and offers Import while it's fresh", async () => {
    knowledge.getReconciliationRun.mockResolvedValue(
      run(new Date(Date.now() - 60 * 60 * 1000).toISOString())
    )
    await show()
    expect(
      screen.getByText(
        "3 would be imported for managers to decide · 0 skipped · 1 disagree with what's recorded · 1 agree and would be recorded as seen"
      )
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Import 3 for managers to decide" })
    ).toBeTruthy()
    expect(screen.getByText("legacy: 4")).toBeTruthy()
  })

  it("asks for a new dry run once it's a day old, and never offers Import on an applied run", async () => {
    knowledge.getReconciliationRun.mockResolvedValue(
      run(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString())
    )
    await show()
    expect(screen.queryByRole("button", { name: /^Import/ })).toBeNull()
    expect(
      screen.getByText(
        "A dry run under 24 hours old is needed before importing."
      )
    ).toBeTruthy()
    cleanup()
    knowledge.getReconciliationRun.mockResolvedValue(
      run(new Date().toISOString(), "apply")
    )
    await show()
    expect(screen.queryByRole("button", { name: /^Import/ })).toBeNull()
  })
})
