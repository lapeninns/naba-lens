// @vitest-environment jsdom
// G2: every route that captures a working-list question renders the knowledge
// form (staff, manager account, legacy grant, admin), and every route keeps
// the legacy form for a question that isn't on a working list. Renders the
// real capture screen and form.
import { cleanup, render, screen } from "@testing-library/react"
import { cloneElement, isValidElement, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/staff/tasks/amenities/c",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
}))

const access = vi.hoisted(() => ({
  workspaceManagerContext: vi.fn(),
  managerAccess: vi.fn(),
  adminVenueContext: vi.fn(),
}))
vi.mock("@/app/staff/manage/_shared/context", () => access)
vi.mock("@/app/staff/manage/_shared/frame", () => ({
  NotManagerPage: () => null,
}))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/lib/auth", () => ({
  requireActiveStaff: vi.fn(async () => ({
    id: "s1",
    avatarPath: null,
    displayName: "TEST Sam",
    venue: { id: "v1", name: "The Old Crown" },
  })),
}))
vi.mock("@/lib/server/coverage", () => ({
  getCoverageActor: vi.fn(async () => ({ ok: true, actor: { profile: {} } })),
}))
vi.mock("@/app/staff/_shell/shell-status", () => ({
  staffShellStatus: vi.fn(async () => ({ canManage: false })),
}))

const services = vi.hoisted(() => ({
  getCheck: vi.fn(),
  listSubmittableAssets: vi.fn(),
}))
vi.mock("@/lib/server/amenities", () => services)
vi.mock("@/app/_amenities/actions", () => ({
  listSubmittableAssetsAction: vi.fn(),
  submitFindingAction: vi.fn(),
}))
vi.mock("@/app/_knowledge/actions", () => ({
  submitKnowledgeFindingAction: vi.fn(),
  saveKnowledgeDraftAction: vi.fn(),
  discardKnowledgeDraftAction: vi.fn(),
}))
const knowledge = vi.hoisted(() => ({
  getKnowledgeCheck: vi.fn(),
  getDraft: vi.fn(),
}))
vi.mock("@/lib/knowledge-client/services", () => ({
  knowledgeServices: knowledge,
}))
vi.mock("@/app/_media/use-media-uploader", () => ({
  useMediaUploader: () => ({}),
}))

import AdminCapturePage from "@/app/admin/coverage/[venueId]/amenities/[checkId]/capture/page"
import ManagerCapturePage from "@/app/manager/amenities/[checkId]/capture/page"
import ManageCapturePage from "@/app/staff/manage/amenities/[checkId]/capture/page"
import StaffCapturePage from "@/app/staff/tasks/amenities/[checkId]/page"
import type { CheckDetail } from "@/lib/amenities/contract"
import type { QuestionView, WorkingSlot } from "@/lib/knowledge-client/contract"

import { DARTS, MANAGER, VENUE, detail } from "./amenities-manage-fixtures"

async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve))
  if (!isValidElement(node)) return node
  const { type } = node
  const props = node.props as Record<string, unknown>
  if (typeof type === "function" && type.constructor.name === "AsyncFunction") {
    return resolve(await (type as (p: unknown) => Promise<ReactNode>)(props))
  }
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (isValidElement(value) || Array.isArray(value))
      next[key] = await resolve(value as ReactNode)
  }
  if (Object.keys(next).length === 0) return node
  // Children go back as arguments, as JSX wrote them: an array prop would be
  // a list to React and want keys.
  const { children, ...rest } = next
  return Array.isArray(children)
    ? cloneElement(node, rest, ...(children as ReactNode[]))
    : cloneElement(node, next)
}

async function show(page: Promise<ReactNode>) {
  return render(<>{await resolve(await page)}</>)
}

const STEP_FREE = {
  ...DARTS,
  entry: { ...DARTS.entry, key: "step_free_entrance" },
}

function slot(over: Partial<WorkingSlot> = {}): WorkingSlot {
  return {
    checkId: DARTS.id,
    key: "step_free_entrance",
    question: DARTS.entry.question,
    category: DARTS.entry.category,
    evidenceRule: "photo",
    progress: "needs_capture",
    slotRevision: 12,
    answerInUse: {
      status: "unavailable",
      reason: "unknown",
      detail: "not_checked",
      value: null,
      savedAt: null,
      sentAt: null,
      confirmation: { state: "not_required", self: false, at: null, by: null },
    },
    previousAnswer: null,
    latestAttempt: null,
    assignee: null,
    mode: "answer",
    requiresConfirmation: true,
    myLatest: null,
    myDraft: null,
    othersPending: 0,
    closedAssignment: null,
    ...over,
  }
}

function inScope(canSelfConfirm = true): QuestionView {
  return {
    inScope: true,
    slot: slot(),
    capture: {
      id: STEP_FREE.id,
      venueId: STEP_FREE.venueId,
      status: "active",
      progress: "needs_capture",
      recheckReason: null,
      revision: 12,
      entry: {
        key: STEP_FREE.entry.key,
        category: STEP_FREE.entry.category,
        question: STEP_FREE.entry.question,
        captureBrief: STEP_FREE.entry.captureBrief,
        evidenceRule: "photo",
      },
    },
    venue: { id: VENUE.id, name: VENUE.name },
    pending: [],
    permissions: {
      canContribute: true,
      canReportChange: false,
      canConfirm: true,
      canSelfConfirm,
      canRequestDetail: true,
      canDecline: true,
    },
    history: [],
  }
}

function ctx(mode: "manager" | "workspace" | "admin", basePath: string) {
  return {
    mode,
    actor: { profile: { id: MANAGER.id } },
    viewerId: MANAGER.id,
    viewerName: MANAGER.displayName,
    venue: VENUE,
    venueId: VENUE.id,
    basePath,
    coverage: null,
  }
}

const params = Promise.resolve({ checkId: DARTS.id, venueId: VENUE.id })
const pages = {
  staff: () => StaffCapturePage({ params }),
  manager: () => ManagerCapturePage({ params }),
  "legacy grant": () => ManageCapturePage({ params }),
  admin: () => AdminCapturePage({ params }),
} as const

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  access.workspaceManagerContext.mockResolvedValue(ctx("workspace", "/manager"))
  access.managerAccess.mockResolvedValue({
    ok: true,
    ctx: ctx("manager", "/staff/manage"),
  })
  access.adminVenueContext.mockResolvedValue(
    ctx("admin", `/admin/coverage/${VENUE.id}`)
  )
  services.getCheck.mockResolvedValue({
    ok: true,
    detail: detail({ check: STEP_FREE }),
  })
  services.listSubmittableAssets.mockResolvedValue({ ok: true, assets: [] })
  knowledge.getDraft.mockResolvedValue({ ok: true, draft: null })
})

describe("capture routes on a working-list question (G2)", () => {
  it.each(Object.keys(pages) as (keyof typeof pages)[])(
    "%s capture renders the knowledge form",
    async (name) => {
      knowledge.getKnowledgeCheck.mockResolvedValue({
        ok: true,
        view: inScope(),
      })
      await show(pages[name]())
      expect(knowledge.getKnowledgeCheck).toHaveBeenCalledWith(
        expect.anything(),
        { checkId: DARTS.id, venueName: expect.any(String) }
      )
      expect(
        screen.getByRole("radio", { name: "Couldn't establish" })
      ).toBeTruthy()
      expect(
        screen.getByText(`You're answering for ${VENUE.name}.`)
      ).toBeTruthy()
      if (name === "staff") {
        expect(
          screen.queryByRole("group", { name: /Who confirms this answer/ })
        ).toBeNull()
      } else {
        // Managers and admins choose who confirms step-free entrance (D4).
        expect(
          screen.getByRole("group", { name: /Who confirms this answer/ })
        ).toBeTruthy()
      }
    }
  )

  it.each(Object.keys(pages) as (keyof typeof pages)[])(
    "%s capture keeps the legacy form off the working list",
    async (name) => {
      knowledge.getKnowledgeCheck.mockResolvedValue({
        ok: true,
        view: { inScope: false },
      })
      await show(pages[name]())
      expect(
        screen.queryByRole("radio", { name: "Couldn't establish" })
      ).toBeNull()
      expect(screen.getByRole("radio", { name: "Not applicable" })).toBeTruthy()
    }
  )

  it("opens the knowledge form to staff who aren't assigned", async () => {
    const unassigned: CheckDetail = detail({
      check: { ...STEP_FREE, assignee: null },
      permissions: {
        canAssign: false,
        canArchive: false,
        canRestore: false,
        canReopen: false,
        canSubmit: false,
        canAttachLegacy: false,
      },
    })
    services.getCheck.mockResolvedValue({ ok: true, detail: unassigned })
    knowledge.getKnowledgeCheck.mockResolvedValue({ ok: true, view: inScope() })
    await show(pages.staff())
    expect(screen.getByRole("button", { name: "Submit finding" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Save for later" })).toBeTruthy()
  })

  it("renders a working-list question for unassigned staff through the knowledge read, never the amenity read (F1)", async () => {
    // amenity_can_read refuses an unassigned person: the page must not 404.
    services.getCheck.mockResolvedValue({
      ok: false,
      code: "not_found",
      status: 404,
      message: "This check could not be found.",
    })
    knowledge.getKnowledgeCheck.mockResolvedValue({ ok: true, view: inScope() })
    await show(pages.staff())
    expect(services.getCheck).not.toHaveBeenCalled()
    expect(
      screen.getByRole("heading", { level: 1, name: STEP_FREE.entry.question })
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Submit finding" })).toBeTruthy()
    expect(
      screen.getByRole("radio", { name: "Couldn't establish" })
    ).toBeTruthy()
  })

  it("staff still use the amenity read for a question off the working list", async () => {
    knowledge.getKnowledgeCheck.mockResolvedValue({
      ok: true,
      view: { inScope: false },
    })
    await show(pages.staff())
    expect(services.getCheck).toHaveBeenCalledWith(expect.anything(), {
      checkId: DARTS.id,
    })
  })

  it.each(["manager", "legacy grant", "admin"] as const)(
    "%s capture keeps the amenity read on a working-list question",
    async (name) => {
      knowledge.getKnowledgeCheck.mockResolvedValue({
        ok: true,
        view: inScope(),
      })
      await show(pages[name]())
      expect(services.getCheck).toHaveBeenCalledWith(expect.anything(), {
        checkId: DARTS.id,
      })
    }
  )

  it("falls back to the legacy form when the knowledge read throws", async () => {
    knowledge.getKnowledgeCheck.mockRejectedValue(new Error("network"))
    await show(pages.staff())
    expect(
      screen.queryByRole("radio", { name: "Couldn't establish" })
    ).toBeNull()
    expect(screen.getByRole("radio", { name: "Not applicable" })).toBeTruthy()
  })

  it("falls back to the legacy form when the knowledge read fails", async () => {
    knowledge.getKnowledgeCheck.mockResolvedValue({
      ok: false,
      code: "unavailable",
      status: 503,
      message: "down",
    })
    await show(pages.manager())
    expect(
      screen.queryByRole("radio", { name: "Couldn't establish" })
    ).toBeNull()
  })
})
