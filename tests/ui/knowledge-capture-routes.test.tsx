// @vitest-environment jsdom
// G2: every route that captures a working-list question renders the knowledge
// form (staff, manager account, legacy grant, admin), and every route keeps
// the legacy form for a question that isn't on a working list. Renders the
// real capture screen and form.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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
const amenityActions = vi.hoisted(() => ({
  listSubmittableAssetsAction: vi.fn(),
  submitFindingAction: vi.fn(),
}))
vi.mock("@/app/_amenities/actions", () => amenityActions)
const actions = vi.hoisted(() => ({
  submitKnowledgeFindingAction: vi.fn(),
  saveKnowledgeDraftAction: vi.fn(),
  discardKnowledgeDraftAction: vi.fn(),
  listKnowledgeAssetsAction: vi.fn(),
}))
vi.mock("@/app/_knowledge/actions", () => actions)
const knowledge = vi.hoisted(() => ({
  getKnowledgeCheck: vi.fn(),
  getDraft: vi.fn(),
  listKnowledgeAssets: vi.fn(),
  getQuestion: vi.fn(),
  listPlaces: vi.fn(),
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

const OWN_PHOTO = "7d000000-0000-4000-8000-0000000000aa"

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
  knowledge.listKnowledgeAssets.mockResolvedValue({ ok: true, assets: [] })
  knowledge.getDraft.mockResolvedValue({ ok: true, draft: null })
  knowledge.getQuestion.mockResolvedValue({ ok: true, question: null })
})

describe("capture routes and the question registry (B03 UI §2.1)", () => {
  const registry = (over: Record<string, unknown>) => ({
    ok: true,
    question: {
      key: "step_free_entrance",
      lifecycle: "supported",
      supersededBy: null,
      valueSchema: { name: "presence", version: 1 },
      ...over,
    },
  })

  it.each(Object.keys(pages) as (keyof typeof pages)[])(
    "%s capture keeps today's form for a version 1 schema, reading the question's key",
    async (name) => {
      knowledge.getKnowledgeCheck.mockResolvedValue({
        ok: true,
        view: inScope(),
      })
      knowledge.getQuestion.mockResolvedValue(registry({}))
      await show(pages[name]())
      expect(knowledge.getQuestion).toHaveBeenCalledWith(expect.anything(), {
        key: "step_free_entrance",
      })
      expect(
        screen.getByRole("radio", { name: "Couldn't establish" })
      ).toBeTruthy()
    }
  )

  it.each(Object.keys(pages) as (keyof typeof pages)[])(
    "%s capture shows a notice and no form for a schema this build doesn't know",
    async (name) => {
      knowledge.getKnowledgeCheck.mockResolvedValue({
        ok: true,
        view: inScope(),
      })
      knowledge.getQuestion.mockResolvedValue(
        registry({ valueSchema: { name: "policy", version: 1 } })
      )
      await show(pages[name]())
      expect(
        screen.getByText(
          "This question has a newer form than this screen knows. Reload to get it."
        )
      ).toBeTruthy()
      expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy()
      expect(screen.queryByRole("radio")).toBeNull()
      expect(screen.queryByRole("button", { name: /Submit/ })).toBeNull()
      expect(
        screen.queryByRole("button", { name: "Save for later" })
      ).toBeNull()
    }
  )

  it("loads the venue's places for a facility question and shows its detail after Yes", async () => {
    knowledge.getKnowledgeCheck.mockResolvedValue({ ok: true, view: inScope() })
    knowledge.getQuestion.mockResolvedValue(
      registry({ valueSchema: { name: "facility", version: 1 } })
    )
    knowledge.listPlaces.mockResolvedValue({
      ok: true,
      venueId: VENUE.id,
      places: [
        {
          subjectId: "5a000000-0000-4000-8000-000000000001",
          kind: "area",
          label: "⟨Back bar⟩",
          active: true,
        },
        {
          subjectId: "5a000000-0000-4000-8000-000000000002",
          kind: "area",
          label: "⟨Old room⟩",
          active: false,
        },
      ],
    })
    await show(pages.staff())
    expect(knowledge.listPlaces).toHaveBeenCalledWith(expect.anything(), {
      venueId: VENUE.id,
    })
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }))
    const where = screen.getByRole("group", { name: "Where is it?" })
    expect(
      within(where).getByRole("checkbox", { name: "⟨Back bar⟩" })
    ).toBeTruthy()
    expect(within(where).queryByText("⟨Old room⟩")).toBeNull()
    expect(screen.getByLabelText("When did you check?")).toBeTruthy()
  })

  it.each([
    ["staff", "Ask your manager to add entrances under Places."],
    ["manager", "Add entrances under Places."],
  ] as const)(
    "%s capture of step-free entrance lists the venue's entrances from Places",
    async (name, ask) => {
      knowledge.getKnowledgeCheck.mockResolvedValue({
        ok: true,
        view: inScope(),
      })
      knowledge.getQuestion.mockResolvedValue(
        registry({
          valueSchema: { name: "accessibility", version: 1 },
          features: [],
        })
      )
      knowledge.listPlaces.mockResolvedValue({
        ok: true,
        venueId: VENUE.id,
        places: [],
      })
      await show(pages[name]())
      fireEvent.click(screen.getByRole("radio", { name: "No" }))
      expect(
        screen.getByRole("group", { name: "Which entrances did you check?" })
      ).toBeTruthy()
      expect(
        screen.getByText(
          `No entrances are listed for ${VENUE.name} yet. ${ask}`
        )
      ).toBeTruthy()
      expect(screen.queryByText("Features")).toBeNull()
    }
  )

  it("says a question isn't asked any more, with no form", async () => {
    knowledge.getKnowledgeCheck.mockResolvedValue({ ok: true, view: inScope() })
    knowledge.getQuestion.mockResolvedValue(registry({ lifecycle: "retired" }))
    await show(pages.staff())
    expect(
      screen.getByText(
        "This question isn't asked any more. Its earlier answers are kept."
      )
    ).toBeTruthy()
    expect(screen.queryByRole("radio")).toBeNull()
  })

  it("keeps today's form when the registry read fails or doesn't exist yet", async () => {
    knowledge.getKnowledgeCheck.mockResolvedValue({ ok: true, view: inScope() })
    knowledge.getQuestion.mockRejectedValueOnce(new Error("network"))
    await show(pages.staff())
    expect(screen.getByRole("button", { name: "Submit finding" })).toBeTruthy()
    cleanup()
    knowledge.getQuestion.mockResolvedValueOnce({ ok: true, question: null })
    await show(pages.staff())
    expect(screen.getByRole("button", { name: "Submit finding" })).toBeTruthy()
  })
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

  it("lists an unassigned staff member's own media through the knowledge read, with own-media thumbnails (F1)", async () => {
    services.getCheck.mockResolvedValue({
      ok: false,
      code: "not_found",
      status: 404,
      message: "This check could not be found.",
    })
    services.listSubmittableAssets.mockResolvedValue({
      ok: false,
      code: "not_permitted",
      status: 403,
      message: "refused",
    })
    knowledge.getKnowledgeCheck.mockResolvedValue({ ok: true, view: inScope() })
    knowledge.listKnowledgeAssets.mockResolvedValue({
      ok: true,
      assets: [
        {
          assetId: OWN_PHOTO,
          kind: "photo",
          createdAt: "2026-11-05T10:00:00.000Z",
          source: "own",
          thumbUrl: `/api/media/${OWN_PHOTO}/thumb`,
        },
      ],
    })
    const { container } = await show(pages.staff())
    expect(knowledge.listKnowledgeAssets).toHaveBeenCalledWith(
      expect.anything(),
      { checkId: DARTS.id }
    )
    expect(services.listSubmittableAssets).not.toHaveBeenCalled()
    const srcs = [...container.querySelectorAll("img")].map((img) =>
      img.getAttribute("src")
    )
    expect(srcs).toContain(`/api/media/${OWN_PHOTO}/thumb`)
    expect(srcs.some((src) => src?.includes("/api/amenities/evidence/"))).toBe(
      false
    )
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("reloads the list through the knowledge action after a failed read (F1)", async () => {
    knowledge.getKnowledgeCheck.mockResolvedValue({ ok: true, view: inScope() })
    knowledge.listKnowledgeAssets.mockResolvedValue({
      ok: false,
      code: "unavailable",
      status: 503,
      message: "We couldn't load your photos and videos.",
    })
    actions.listKnowledgeAssetsAction.mockResolvedValue({
      ok: true,
      assets: [],
    })
    await show(pages.staff())
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain(
      "We couldn't load your photos and videos."
    )
    await userEvent.click(
      within(alert).getByRole("button", { name: /Try again/ })
    )
    expect(actions.listKnowledgeAssetsAction).toHaveBeenCalledWith({
      checkId: DARTS.id,
    })
    expect(amenityActions.listSubmittableAssetsAction).not.toHaveBeenCalled()
  })

  it.each(["manager", "legacy grant", "admin"] as const)(
    "%s capture keeps the amenity media list on a working-list question",
    async (name) => {
      knowledge.getKnowledgeCheck.mockResolvedValue({
        ok: true,
        view: inScope(),
      })
      await show(pages[name]())
      expect(services.listSubmittableAssets).toHaveBeenCalled()
      expect(knowledge.listKnowledgeAssets).not.toHaveBeenCalled()
    }
  )

  it("staff keep the amenity media list off the working list", async () => {
    knowledge.getKnowledgeCheck.mockResolvedValue({
      ok: true,
      view: { inScope: false },
    })
    await show(pages.staff())
    expect(services.listSubmittableAssets).toHaveBeenCalled()
    expect(knowledge.listKnowledgeAssets).not.toHaveBeenCalled()
  })

  it("shows an assignee the reopen reason on a reopened working-list question (L1)", async () => {
    services.getCheck.mockResolvedValue({
      ok: true,
      detail: detail({
        check: {
          ...STEP_FREE,
          progress: "needs_recheck",
          recheckReason: "The ramp was removed",
        },
      }),
    })
    const view = inScope()
    if (!view.inScope) throw new Error("in scope")
    knowledge.getKnowledgeCheck.mockResolvedValue({
      ok: true,
      view: {
        ...view,
        slot: {
          ...view.slot,
          progress: "needs_recheck",
          assignee: { firstName: "Sam", isMe: true },
        },
        capture: { ...view.capture, progress: "needs_recheck" },
      },
    })
    await show(pages.staff())
    expect(screen.getByText("The ramp was removed")).toBeTruthy()
  })

  it("reads the reopen reason only for the assignee", async () => {
    const view = inScope()
    if (!view.inScope) throw new Error("in scope")
    knowledge.getKnowledgeCheck.mockResolvedValue({
      ok: true,
      view: {
        ...view,
        slot: { ...view.slot, progress: "needs_recheck" },
        capture: { ...view.capture, progress: "needs_recheck" },
      },
    })
    await show(pages.staff())
    expect(services.getCheck).not.toHaveBeenCalled()
  })

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
