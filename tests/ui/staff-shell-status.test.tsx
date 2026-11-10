// @vitest-environment jsdom
// Every staff page's shell shows the same Home badge, Manage badge and avatar,
// from one loader whose reads run side by side (and alongside the page's).
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { cleanup, render } from "@testing-library/react"
import type * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { MyAmenityTask } from "@/lib/amenities/contract"

import { tasksView } from "./tasks-fixtures"

vi.mock("server-only", () => ({}))
// The B01 Home and badge; the B02 layout is tested in home-b02.test.tsx.
vi.stubEnv("NABALENS_HOME_LAYOUT", "b01")
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}))
vi.mock("@/app/_media/actions", () => ({
  deleteMedia: vi.fn(),
  readDeleteEvidence: vi.fn(async () => ({ status: "missing" })),
}))
vi.mock("@/app/staff/actions", () => ({ loadMyMedia: vi.fn() }))
vi.mock("@/app/_media/media-gallery", () => ({ MediaGallery: () => null }))
vi.mock("@/app/_media/use-media-uploader", () => ({
  useMediaUploader: () => ({}),
}))
vi.mock("@/app/_labels/label-editor-host", () => ({
  LabelEditorHost: () => null,
}))
const shell = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}))
vi.mock("@/components/nabalens/app-shell", () => ({
  AppShell: ({
    children,
    ...props
  }: { children: React.ReactNode } & Record<string, unknown>) => {
    shell.props = props
    return <div>{children}</div>
  },
}))
const PROFILE = {
  id: "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22",
  displayName: "TEST Sam",
  jobTitle: null,
  department: "foh",
  venueId: "v1",
  venue: { id: "v1", name: "TEST Inn", active: true },
  avatarPath: "7c2e/a.webp",
  work: null,
}
vi.mock("@/lib/auth", () => ({
  requireActiveStaff: vi.fn(async () => PROFILE),
  uploadBlockReason: () => null,
}))
const ACTOR = { profile: { id: PROFILE.id, role: "staff" } }
vi.mock("@/lib/server/media/context", () => ({
  getMediaActor: vi.fn(async () => ({ ok: true, actor: ACTOR })),
}))
vi.mock("@/lib/server/media/library", () => ({
  avatarUrl: (id: string, path: string | null) =>
    path ? `/api/avatars/${id}` : null,
  listOwnMedia: vi.fn(async () => ({ ok: true, items: [], nextCursor: null })),
  listOwnMediaByIds: vi.fn(async () => ({ ok: true, items: [] })),
}))
const coverage = vi.hoisted(() => ({
  getCoverageActor: vi.fn(),
  getCoverageScope: vi.fn(),
  getMyTasks: vi.fn(),
  getManagerReviewCount: vi.fn(),
  listMyMenuPhotoDecisions: vi.fn(),
}))
vi.mock("@/lib/server/coverage", () => coverage)
const amenities = vi.hoisted(() => ({ getMyAmenityTasks: vi.fn() }))
vi.mock("@/lib/server/amenities", () => amenities)
// No working list at this venue unless a test gives one: the legacy counts.
const knowledge = vi.hoisted(() => ({
  getWorkingList: vi.fn(),
  listMyFindings: vi.fn(),
}))
vi.mock("@/lib/knowledge-client/services", () => ({
  knowledgeServices: knowledge,
}))
const work = vi.hoisted(() => ({
  getLabelWork: vi.fn(),
  getCapabilities: vi.fn(),
}))
vi.mock("@/lib/work-client/services", () => ({ workServices: work }))

import {
  currentStaffShell,
  staffShellStatus,
} from "@/app/staff/_shell/shell-status"
import StaffNotFound from "@/app/staff/not-found"
import StaffPage from "@/app/staff/page"
import PhotoGuidePage from "@/app/staff/tasks/guide/page"

const check = (id: string) =>
  ({ id, progress: "needs_capture", entry: { position: 1 } }) as MyAmenityTask

function scope(canManageVenue: boolean) {
  return { ok: true, scope: { ...tasksView().scope, canManageVenue } }
}

beforeEach(() => {
  coverage.getCoverageActor.mockResolvedValue({ ok: true, actor: ACTOR })
  coverage.getCoverageScope.mockResolvedValue(scope(false))
  coverage.getMyTasks.mockResolvedValue({ ok: true, tasks: tasksView() })
  coverage.getManagerReviewCount.mockResolvedValue({ ok: true, count: 3 })
  coverage.listMyMenuPhotoDecisions.mockResolvedValue({ ok: true, states: [] })
  amenities.getMyAmenityTasks.mockResolvedValue({
    ok: true,
    tasks: [check("c1"), check("c2")],
  })
  knowledge.getWorkingList.mockResolvedValue({ ok: true, view: null })
  knowledge.listMyFindings.mockResolvedValue({
    ok: true,
    page: { items: [], nextCursor: null, hiddenEarlierVenues: [] },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  shell.props = null
})

describe("staffShellStatus", () => {
  it("counts amenity checks in Home's To do and reads no review count for staff", async () => {
    expect(await staffShellStatus(ACTOR as never, PROFILE)).toEqual({
      canManage: false,
      todoCount: 2,
      todoUnknown: false,
      reviewCount: undefined,
      avatarUrl: `/api/avatars/${PROFILE.id}`,
    })
    expect(coverage.getManagerReviewCount).not.toHaveBeenCalled()
  })

  it("counts a finding my manager asked about in Home's To do (B01-06)", async () => {
    knowledge.getWorkingList.mockResolvedValue({
      ok: true,
      view: {
        venue: { id: "v1", name: "The Old Crown" },
        slots: [
          {
            checkId: "c9",
            myLatest: { state: "needs_attention" },
          },
          { checkId: "c8", myLatest: { state: "awaiting_confirmation" } },
        ],
      },
    })
    expect(await staffShellStatus(ACTOR as never, PROFILE)).toMatchObject({
      todoCount: 3,
    })
  })

  it.each([
    ["refused", async () => ({ ok: false, code: "unavailable" })],
    [
      "throws",
      async () => {
        throw new Error("down")
      },
    ],
  ])(
    "gives no To do count, rather than a smaller one, when the working list read is %s",
    async (_, impl) => {
      knowledge.getWorkingList.mockImplementation(impl)
      expect(await staffShellStatus(ACTOR as never, PROFILE)).toMatchObject({
        todoCount: undefined,
        todoUnknown: true,
      })
    }
  )
  it("adds a manager's photos to review to To do and the Manage badge", async () => {
    coverage.getCoverageScope.mockResolvedValue(scope(true))
    expect(await staffShellStatus(ACTOR as never, PROFILE)).toMatchObject({
      canManage: true,
      reviewCount: 3,
      todoCount: 3,
    })
  })

  it.each([
    ["fails", () => ({ ok: false, code: "unavailable", status: 503 })],
    [
      "throws",
      () => {
        throw new Error("down")
      },
    ],
  ])(
    "gives no To do count, rather than none to do, when the amenity read %s",
    async (_, impl) => {
      amenities.getMyAmenityTasks.mockImplementation(async () => impl())
      expect(await staffShellStatus(ACTOR as never, PROFILE)).toMatchObject({
        todoCount: undefined,
      })
    }
  )

  it.each([
    ["fails", () => ({ ok: false, code: "unavailable", status: 503 })],
    [
      "throws",
      () => {
        throw new Error("down")
      },
    ],
  ])(
    "gives a manager no To do count, rather than one without reviews, when the review count %s",
    async (_, impl) => {
      coverage.getCoverageScope.mockResolvedValue(scope(true))
      coverage.getManagerReviewCount.mockImplementation(async () => impl())
      expect(await staffShellStatus(ACTOR as never, PROFILE)).toMatchObject({
        canManage: true,
        reviewCount: undefined,
        todoCount: undefined,
      })
    }
  )

  it("keeps Manage and the avatar when the task read fails, without a To do count", async () => {
    coverage.getCoverageScope.mockResolvedValue(scope(true))
    coverage.getMyTasks.mockRejectedValue(new Error("down"))
    amenities.getMyAmenityTasks.mockRejectedValue(new Error("down"))
    expect(await staffShellStatus(ACTOR as never, PROFILE)).toEqual({
      canManage: true,
      todoCount: undefined,
      todoUnknown: true,
      reviewCount: 3,
      avatarUrl: `/api/avatars/${PROFILE.id}`,
    })
  })
})

/** Every page.tsx under app/staff, outside the legacy Manage area. */
function staffPages(dir = join(process.cwd(), "app/staff")): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory())
      return name === "manage" ? [] : staffPages(path)
    return name === "page.tsx" ? [path] : []
  })
}

describe("staff pages", () => {
  const pages = staffPages().filter((path) =>
    readFileSync(path, "utf8").includes("<AppShell")
  )

  it("covers every staff page with a shell", () => {
    expect(pages.map((p) => relative(process.cwd(), p)).sort()).toEqual([
      "app/staff/community/page.tsx",
      "app/staff/menu/page.tsx",
      "app/staff/page.tsx",
      "app/staff/people/[id]/page.tsx",
      "app/staff/people/page.tsx",
      "app/staff/profile/page.tsx",
      "app/staff/tasks/[requirementId]/page.tsx",
      "app/staff/tasks/amenities/[checkId]/page.tsx",
      "app/staff/tasks/guide/page.tsx",
      "app/staff/tasks/month/page.tsx",
      "app/staff/tasks/page.tsx",
    ])
  })

  it.each(pages.map((p) => [relative(process.cwd(), p), p]))(
    "%s gives its shell the shared status",
    (_, path) => {
      const source = readFileSync(path, "utf8")
      expect(source).toMatch(/import \{[^}]*\bstaffShellStatus\b/)
      const tags = source.match(/<AppShell\b[^>]*>/g) ?? []
      expect(tags.length).toBeGreaterThan(0)
      for (const tag of tags) {
        expect(tag).toMatch(/\{\.\.\.(shell|shellStatus)\}/)
        // Nothing overrides the shared status with a value of its own.
        expect(tag).not.toMatch(
          /\b(canManage|todoCount|reviewCount|avatarUrl)=/
        )
      }
    }
  )

  it.each([
    ["app/staff/manage/_shared/frame.tsx", 2],
    ["app/staff/not-found.tsx", 1],
  ])("%s gives its staff shell the shared status", (path, staffShells) => {
    const source = readFileSync(join(process.cwd(), path), "utf8")
    expect(source).toMatch(/import \{[^}]*\bcurrentStaffShell\b/)
    const tags = (source.match(/<AppShell\b[^>]*>/g) ?? []).filter((tag) =>
      tag.includes('variant="staff"')
    )
    expect(tags).toHaveLength(staffShells)
    for (const tag of tags) {
      expect(tag).toMatch(/\{\.\.\.shell\}/)
      expect(tag).not.toMatch(/\b(todoCount|avatarUrl)=/)
    }
  })

  it("renders the guide with the Home badge, the Manage badge and the avatar", async () => {
    coverage.getCoverageScope.mockResolvedValue(scope(true))
    render(await PhotoGuidePage())
    expect(shell.props).toMatchObject({
      variant: "staff",
      canManage: true,
      todoCount: 3,
      reviewCount: 3,
      avatarUrl: `/api/avatars/${PROFILE.id}`,
    })
  })
})

describe("Me", () => {
  it("reads menu decisions without waiting for the review count", async () => {
    coverage.getCoverageScope.mockResolvedValue(scope(true))
    let release!: (value: unknown) => void
    coverage.getManagerReviewCount.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const page = StaffPage()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(coverage.listMyMenuPhotoDecisions).toHaveBeenCalled()
    release({ ok: true, count: 1 })
    render(await page)
    expect(shell.props).toMatchObject({ canManage: true, reviewCount: 1 })
  })
})

describe("currentStaffShell", () => {
  it("is the signed-in person's status", async () => {
    coverage.getCoverageActor.mockResolvedValueOnce({
      ok: true,
      actor: { ...ACTOR, profile: PROFILE },
    })
    expect(await currentStaffShell()).toEqual({
      canManage: false,
      todoCount: 2,
      todoUnknown: false,
      reviewCount: undefined,
      avatarUrl: `/api/avatars/${PROFILE.id}`,
    })
  })

  it.each([
    ["refused", () => ({ ok: false, code: "unavailable", message: "x" })],
    [
      "throws",
      () => {
        throw new Error("down")
      },
    ],
  ])("never fails when the account read is %s", async (how, impl) => {
    coverage.getCoverageActor.mockImplementationOnce(async () => impl())
    expect(await currentStaffShell()).toEqual({
      canManage: false,
      todoCount: undefined,
      // A refusal is no account to count for; a failure is a count unknown.
      todoUnknown: how === "throws",
      reviewCount: undefined,
      avatarUrl: null,
    })
  })

  it("keeps the staff not-found page up, with the counts when they can be read", async () => {
    coverage.getCoverageActor.mockResolvedValueOnce({
      ok: true,
      actor: { ...ACTOR, profile: PROFILE },
    })
    render(await StaffNotFound())
    expect(shell.props).toMatchObject({ variant: "staff", todoCount: 2 })
    cleanup()
    coverage.getCoverageActor.mockRejectedValueOnce(new Error("down"))
    const { getByRole } = render(await StaffNotFound())
    expect(getByRole("link", { name: "Go to Home" })).toBeTruthy()
    expect(shell.props).toMatchObject({
      variant: "staff",
      todoCount: undefined,
    })
  })
})

describe("Me: Your findings (B01-06)", () => {
  it("shows the history on Me when there is some", async () => {
    knowledge.listMyFindings.mockResolvedValue({
      ok: true,
      page: {
        items: [
          {
            findingRef: { type: "contribution", id: "f1" },
            checkId: "c1",
            question: "Is there parking on site?",
            venue: { id: "v1", name: "TEST Inn" },
            answer: "yes",
            kind: "finding",
            state: "current",
            noLongerUsed: null,
            stateReason: null,
            managerNote: null,
            detailRequestId: null,
            unknownPreset: null,
            answeredBy: null,
            sentAt: "2026-11-05T10:00:00.000Z",
            savedAt: null,
            decidedAt: null,
            recognition: { kind: "pending" },
          },
        ],
        nextCursor: null,
        hiddenEarlierVenues: [],
      },
    })
    const { getByRole } = render(await StaffPage())
    expect(getByRole("region", { name: "Your findings" })).toBeTruthy()
    expect(
      getByRole("heading", { level: 3, name: "Is there parking on site?" })
    ).toBeTruthy()
  })

  it("leaves it out at a venue with no questions and nothing sent, even when the read fails", async () => {
    knowledge.listMyFindings.mockRejectedValue(new Error("down"))
    const { queryByRole } = render(await StaffPage())
    expect(queryByRole("region", { name: /Your findings/ })).toBeNull()
  })
})

describe("staffShellStatus on the B02 Home", () => {
  const request = (photoId: string, canRetake: boolean | undefined) => ({
    photoId,
    assetId: `a-${photoId}`,
    itemId: "i1",
    itemName: "Fish pie",
    variantId: null,
    variantName: null,
    state: "better_photo_requested",
    isPrimary: false,
    reason: "Too dark",
    canRetake,
  })

  beforeEach(() => {
    vi.stubEnv("NABALENS_HOME_LAYOUT", "b02")
    work.getLabelWork.mockResolvedValue({
      status: "ok",
      value: { needsLabels: 2, needsAttention: 1 },
    })
    work.getCapabilities.mockResolvedValue({
      status: "ok",
      value: { canLabel: true },
    })
    // D13: only a dish still on the menu asks anything of me.
    coverage.listMyMenuPhotoDecisions.mockResolvedValue({
      ok: true,
      states: [request("p1", true), request("p2", false), request("p3", undefined)],
    })
  })
  afterEach(() => vi.stubEnv("NABALENS_HOME_LAYOUT", "b01"))

  it("counts checks, label work and better-photo requests I can take", async () => {
    expect(await staffShellStatus(ACTOR as never, PROFILE)).toMatchObject({
      todoCount: 2 + 3 + 1,
      todoUnknown: false,
    })
    expect(coverage.listMyMenuPhotoDecisions).toHaveBeenCalledWith(ACTOR, {
      requestsOnly: true,
    })
  })

  it("leaves labels out before the B02 database, or for an account that can't label", async () => {
    work.getLabelWork.mockResolvedValue({ status: "missing" })
    expect(await staffShellStatus(ACTOR as never, PROFILE)).toMatchObject({
      todoCount: 3,
    })
    vi.clearAllMocks()
    work.getLabelWork.mockResolvedValue({
      status: "ok",
      value: { needsLabels: 2, needsAttention: 1 },
    })
    work.getCapabilities.mockResolvedValue({
      status: "ok",
      value: { canLabel: false },
    })
    expect(await staffShellStatus(ACTOR as never, PROFILE)).toMatchObject({
      todoCount: 3,
    })
  })

  it.each([
    [
      "the labels read fails",
      () =>
        work.getLabelWork.mockResolvedValue({
          status: "failed",
          failure: { ok: false, code: "unavailable", status: 503, message: "" },
        }),
    ],
    [
      "the better-photo read fails",
      () =>
        coverage.listMyMenuPhotoDecisions.mockResolvedValue({
          ok: false,
          code: "unavailable",
        }),
    ],
    [
      "the better-photo read throws",
      () =>
        coverage.listMyMenuPhotoDecisions.mockRejectedValue(new Error("down")),
    ],
  ])("is unknown, never smaller, when %s", async (_, fail) => {
    fail()
    expect(await staffShellStatus(ACTOR as never, PROFILE)).toMatchObject({
      todoCount: undefined,
      todoUnknown: true,
    })
  })
})
