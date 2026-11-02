// Fixtures for the manager/admin coverage component tests. Shapes follow
// lib/server/coverage/types.ts; people carry no email or account fields.

import type {
  AmenityFactView,
  CoveragePerson,
  MenuCoverageView,
  MonthlyProgress,
  PeriodView,
  RequirementView,
  SubmissionView,
} from "@/lib/server/coverage/types"

export const VENUE = {
  id: "5b0d8f43-2a1e-4c5f-8d4b-0e7c9a3f1b11",
  name: "TEST Venue",
}

export const MANAGER_ID = "1a2b3c4d-1111-4aaa-8bbb-000000000001"
export const STAFF_ID = "1a2b3c4d-2222-4aaa-8bbb-000000000002"

export const PERIOD: PeriodView = {
  key: "2026-11",
  label: "November 2026",
  startsAt: "2026-11-01T00:00:00.000Z",
  endsAt: "2026-12-01T00:00:00.000Z",
  isCurrent: true,
  timeZone: "Europe/London",
}

export function person(
  overrides: Partial<CoveragePerson> = {}
): CoveragePerson {
  return {
    id: STAFF_ID,
    displayName: "TEST Sam",
    avatarUrl: null,
    department: "foh",
    jobTitle: "Bartender",
    active: true,
    ...overrides,
  }
}

export function submission(
  overrides: Partial<SubmissionView> = {}
): SubmissionView {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    revision: 1,
    state: "submitted",
    origin: "submitted",
    venueId: VENUE.id,
    period: "2026-11",
    uploadedPeriod: "2026-11",
    requirement: {
      id: "bbbbbbbb-0000-4000-8000-000000000001",
      title: "Bar area",
    },
    asset: {
      id: "cccccccc-0000-4000-8000-000000000001",
      thumbnailUrl:
        "/api/coverage/evidence/cccccccc-0000-4000-8000-000000000001/thumb",
      previewUrl:
        "/api/coverage/evidence/cccccccc-0000-4000-8000-000000000001/preview",
      width: 1200,
      height: 900,
      available: true,
    },
    author: { id: STAFF_ID, displayName: "TEST Sam", active: true },
    submittedById: STAFF_ID,
    submittedAt: "2026-11-02T10:00:00.000Z",
    countsTowardMonthly: true,
    decision: null,
    archived: false,
    replacesSubmissionId: null,
    ...overrides,
  }
}

export function requirement(
  overrides: Partial<RequirementView> = {}
): RequirementView {
  return {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    venueId: VENUE.id,
    kind: "service",
    title: "Bar area",
    guidance: null,
    photoTarget: 1,
    due: null,
    status: "needs_setup",
    statusReason: null,
    isCurrent: false,
    setupIssues: ["unconfirmed"],
    templateKey: "bar_area",
    menuSection: null,
    amenity: null,
    assigneeIds: [],
    assignees: [],
    needsReassignment: false,
    progress: {
      target: 1,
      accepted: 0,
      pending: 0,
      needsAnotherPhoto: 0,
      evidenceRemoved: 0,
      satisfied: false,
      overdue: false,
    },
    revision: 3,
    ...overrides,
  }
}

export function monthly(
  overrides: Partial<MonthlyProgress> = {}
): MonthlyProgress {
  return {
    targetId: "dddddddd-0000-4000-8000-000000000001",
    period: PERIOD,
    venue: VENUE,
    person: person(),
    isCurrentMember: true,
    isManager: false,
    status: "set",
    setupMissing: [],
    targetCount: 5,
    source: "manager",
    revision: 2,
    accepted: 2,
    pending: 1,
    needsAnotherPhoto: 0,
    lateAcceptances: 0,
    evidenceRemoved: 0,
    complete: false,
    due: {
      dueOn: "2026-11-30",
      dueAt: "2026-12-01T00:00:00.000Z",
      label: "Due 30 Nov 2026",
      overdue: false,
    },
    ...overrides,
  }
}

export function amenityFact(
  overrides: Partial<AmenityFactView> = {}
): AmenityFactView {
  return {
    id: null,
    templateKey: "dog_facilities",
    title: "Dog-related facilities and policy",
    presence: "unknown",
    facts: null,
    policy: null,
    confirmed: false,
    confirmedBy: null,
    confirmedAt: null,
    supportingAssets: [],
    revision: null,
    requirementId: "bbbbbbbb-0000-4000-8000-000000000009",
    ...overrides,
  }
}

export function menuView(
  overrides: Partial<MenuCoverageView> = {}
): MenuCoverageView {
  return {
    venue: VENUE,
    menuState: "current",
    activeVersion: {
      id: "eeeeeeee-0000-4000-8000-000000000002",
      title: "Winter menu",
      activatedAt: "2026-11-01T09:00:00.000Z",
      sections: [
        { sectionId: "s-1", name: "Starters", kind: "food", position: 0 },
        { sectionId: "s-2", name: "Cocktails", kind: "drinks", position: 1 },
      ],
    },
    draftPlan: null,
    currentPlan: null,
    draft: [],
    current: [],
    superseded: [],
    ...overrides,
  }
}
