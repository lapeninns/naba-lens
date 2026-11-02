// Fixtures shaped like the coverage services' DTOs (lib/server/coverage/types.ts).
import type {
  CoveragePerson,
  DueView,
  MonthlyProgress,
  MyAssignment,
  MyTasksView,
  PeriodView,
  RequirementView,
  SubmissionView,
  SubmittablePhoto,
} from "@/components/nabalens/tasks"

export const VENUE = {
  id: "5b0d8f43-2a1e-4c5f-8d4b-0e7c9a3f1b11",
  name: "TEST Inn",
}

export const ME: CoveragePerson = {
  id: "7c2e1a90-4b3d-4e8f-9a1c-2d5e6f7a8b22",
  displayName: "TEST Sam",
  avatarUrl: null,
  department: "foh",
  jobTitle: "Bartender",
  active: true,
}

export const MANAGER = {
  id: "1a2b3c4d-0000-4000-8000-000000000001",
  displayName: "TEST Morgan",
}

export const COLLEAGUE: CoveragePerson = {
  id: "1a2b3c4d-0000-4000-8000-000000000002",
  displayName: "TEST Alex",
  avatarUrl: null,
  department: "boh",
  jobTitle: "Chef",
  active: true,
}

export const NOVEMBER: PeriodView = {
  key: "2026-11",
  label: "November 2026",
  startsAt: "2026-11-01T00:00:00.000Z",
  endsAt: "2026-12-01T00:00:00.000Z",
  isCurrent: true,
  timeZone: "Europe/London",
}

export function due(overrides: Partial<DueView> = {}): DueView {
  return {
    dueOn: "2026-11-30",
    dueAt: "2026-12-01T00:00:00.000Z",
    label: "Due 30 Nov 2026",
    overdue: false,
    ...overrides,
  }
}

export function monthly(
  overrides: Partial<MonthlyProgress> = {}
): MonthlyProgress {
  return {
    targetId: "2f000000-0000-4000-8000-000000000001",
    period: NOVEMBER,
    venue: VENUE,
    person: ME,
    isCurrentMember: true,
    isManager: false,
    status: "set",
    setupMissing: [],
    targetCount: 5,
    source: "manager",
    revision: 1,
    accepted: 3,
    pending: 1,
    needsAnotherPhoto: 0,
    lateAcceptances: 0,
    evidenceRemoved: 0,
    complete: false,
    due: due(),
    ...overrides,
  }
}

let n = 0
export function uuid(prefix = "3e"): string {
  n += 1
  return `${prefix}000000-0000-4000-8000-${String(n).padStart(12, "0")}`
}

export function submission(
  overrides: Partial<SubmissionView> = {}
): SubmissionView {
  const assetId = uuid("5b")
  return {
    id: uuid("4a"),
    revision: 1,
    state: "submitted",
    origin: "submitted",
    venueId: VENUE.id,
    period: "2026-11",
    uploadedPeriod: "2026-11",
    requirement: null,
    asset: {
      id: assetId,
      thumbnailUrl: `/api/coverage/evidence/${assetId}/thumb`,
      previewUrl: `/api/coverage/evidence/${assetId}/preview`,
      width: 1600,
      height: 1200,
      available: true,
    },
    author: { id: ME.id, displayName: ME.displayName, active: true },
    submittedById: ME.id,
    submittedAt: "2026-11-02T10:05:00.000Z",
    countsTowardMonthly: true,
    decision: null,
    archived: false,
    replacesSubmissionId: null,
    ...overrides,
  }
}

export function needsAnother(
  reason: string,
  overrides: Partial<SubmissionView> = {}
): SubmissionView {
  return submission({
    state: "needs_another_photo",
    decision: {
      decision: "needs_another_photo",
      reason,
      decidedAt: "2026-11-03T09:00:00.000Z",
      decidedBy: MANAGER,
      selfReview: false,
      lateAcceptance: false,
    },
    ...overrides,
  })
}

export function requirement(
  overrides: Partial<RequirementView> = {}
): RequirementView {
  return {
    id: uuid("6c"),
    venueId: VENUE.id,
    kind: "menu_section",
    title: "Starters",
    guidance: "Show three different starters on the pass.",
    photoTarget: 4,
    due: due(),
    status: "active",
    statusReason: null,
    isCurrent: true,
    setupIssues: [],
    templateKey: null,
    menuSection: null,
    amenity: null,
    assigneeIds: [ME.id, COLLEAGUE.id],
    assignees: [ME, COLLEAGUE],
    needsReassignment: false,
    progress: {
      target: 4,
      accepted: 1,
      pending: 1,
      needsAnotherPhoto: 0,
      evidenceRemoved: 0,
      satisfied: false,
      overdue: false,
    },
    revision: 2,
    ...overrides,
  }
}

export function assignment(
  overrides: Partial<RequirementView> = {},
  mine: Partial<Omit<MyAssignment, "requirement">> = {}
): MyAssignment {
  const req = requirement(overrides)
  return {
    requirement: req,
    assigned: true,
    canSubmit: req.isCurrent,
    mySubmissions: [],
    myAccepted: 1,
    myPending: 1,
    ...mine,
  }
}

export function tasksView(overrides: Partial<MyTasksView> = {}): MyTasksView {
  return {
    scope: {
      role: "staff",
      setup: { complete: true, missing: [] },
      venue: { ...VENUE, active: true },
      managedVenue: null,
      canSubmit: true,
      canManageVenue: false,
      canManageGrants: false,
      canViewGroupOverview: false,
    },
    period: NOVEMBER,
    monthly: monthly(),
    assignments: [],
    needsAnotherPhoto: [],
    pendingReview: 1,
    ...overrides,
  }
}

export function photo(
  overrides: Partial<SubmittablePhoto> = {}
): SubmittablePhoto {
  const assetId = overrides.assetId ?? uuid("7d")
  return {
    assetId,
    thumbnailUrl: `/api/media/${assetId}/thumb`,
    previewUrl: `/api/media/${assetId}/preview`,
    width: 1600,
    height: 1200,
    uploadedAt: "2026-11-02T10:00:00.000Z",
    uploadedPeriod: "2026-11",
    uploader: { id: ME.id, displayName: ME.displayName, active: true },
    countsTowardMonthly: true,
    live: null,
    eligible: true,
    reason: null,
    ...overrides,
  }
}

export const PROFILE = {
  displayName: "TEST Sam",
  venueName: VENUE.name,
  department: "foh" as const,
  hasAvatar: true,
}
