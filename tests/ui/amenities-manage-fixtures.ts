// Fixtures for the manager/admin amenity component tests, typed from the
// contract (lib/amenities/contract.ts).

import type {
  CatalogueEntry,
  CatalogueOption,
  CheckDetail,
  CheckSummary,
  SubmissionView,
  VenueAmenitiesView,
} from "@/lib/amenities/contract"

export const VENUE = {
  id: "5b0d8f43-2a1e-4c5f-8d4b-0e7c9a3f1b11",
  name: "TEST Venue",
}
export const BASE = "/staff/manage"
export const STAFF = {
  id: "1a2b3c4d-2222-4aaa-8bbb-000000000002",
  displayName: "TEST Sam",
}
export const MANAGER = {
  id: "1a2b3c4d-1111-4aaa-8bbb-000000000001",
  displayName: "TEST Manager",
}

export function entry(overrides: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return {
    key: "darts",
    category: "Games",
    question: "Is there a dartboard?",
    captureBrief: "Photograph the dartboard and the oche.",
    evidenceRule: "photo",
    isCore: false,
    position: 30,
    version: 1,
    ...overrides,
  }
}

export function check(overrides: Partial<CheckSummary> = {}): CheckSummary {
  return {
    id: "c0000000-0000-4000-8000-000000000001",
    venueId: VENUE.id,
    entry: entry(),
    status: "active",
    progress: "needs_capture",
    answer: "to_check",
    assignee: null,
    answeredBy: null,
    answeredAt: null,
    recheckReason: null,
    notes: null,
    revision: 3,
    updatedAt: "2026-11-05T10:00:00.000Z",
    ...overrides,
  }
}

const STEP_FREE = entry({
  key: "step_free_entrance",
  category: "Access",
  question: "Is there a step-free entrance?",
  captureBrief: "Film the route from the street to the door.",
  evidenceRule: "video",
  isCore: true,
  position: 1,
})
const WIFI = entry({
  key: "guest_wifi",
  category: "Facilities",
  question: "Is there guest Wi-Fi?",
  captureBrief: "Photograph the sign with the password covered.",
  evidenceRule: "both",
  isCore: true,
  position: 4,
})

export const DARTS = check()
export const STEP_FREE_CHECK = check({
  id: "c0000000-0000-4000-8000-000000000002",
  entry: STEP_FREE,
  progress: "needs_recheck",
  answer: "yes",
  assignee: STAFF,
  answeredBy: STAFF,
  answeredAt: "2026-11-02T09:30:00.000Z",
  recheckReason: "Conditions changed: new ramp",
})
export const WIFI_CHECK = check({
  id: "c0000000-0000-4000-8000-000000000003",
  entry: WIFI,
  progress: "complete",
  answer: "yes",
  assignee: STAFF,
  answeredBy: STAFF,
  answeredAt: "2026-11-04T15:00:00.000Z",
})
export const ARCHIVED = check({
  id: "c0000000-0000-4000-8000-000000000004",
  entry: entry({
    key: "pool_table",
    question: "Is there a pool table?",
    position: 31,
  }),
  status: "archived",
  revision: 7,
})

export function view(
  overrides: Partial<VenueAmenitiesView> = {}
): VenueAmenitiesView {
  return {
    venue: VENUE,
    enabled: true,
    canEnable: false,
    active: [DARTS, STEP_FREE_CHECK, WIFI_CHECK],
    archived: [ARCHIVED],
    recentlyCompleted: [WIFI_CHECK],
    counts: { needs_capture: 1, needs_recheck: 1, complete: 1 },
    ...overrides,
  }
}

export const CATALOGUE: CatalogueOption[] = [
  { ...STEP_FREE, existing: { checkId: STEP_FREE_CHECK.id, status: "active" } },
  { ...WIFI, existing: { checkId: WIFI_CHECK.id, status: "active" } },
  {
    ...entry({
      key: "high_chairs",
      category: "Families",
      question: "Are high chairs available?",
      captureBrief: "Photograph a high chair.",
      position: 20,
    }),
    existing: null,
  },
  {
    ...entry({
      key: "baby_changing",
      category: "Families",
      question: "Is there baby changing?",
      captureBrief: "Photograph the changing table.",
      evidenceRule: "either",
      position: 21,
    }),
    existing: null,
  },
  {
    ...entry({
      key: "pool_table",
      question: "Is there a pool table?",
      position: 31,
    }),
    existing: { checkId: ARCHIVED.id, status: "archived" },
  },
]

export function submission(
  overrides: Partial<SubmissionView> = {}
): SubmissionView {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    answer: "yes",
    finding: "Router in the back bar; signal good in the garden.",
    limitations: "Not tested upstairs.",
    reason: null,
    submittedBy: STAFF,
    submittedAt: "2026-11-04T15:00:00.000Z",
    templateVersion: 1,
    evidenceRule: "both",
    evidence: [
      {
        assetId: "a0000000-0000-4000-8000-000000000001",
        kind: "photo",
        available: true,
        thumbUrl: "/api/amenities/evidence/a1/thumb",
        previewUrl: "/api/amenities/evidence/a1/preview",
        streamUrl: null,
      },
      {
        assetId: "a0000000-0000-4000-8000-000000000002",
        kind: "video",
        available: true,
        thumbUrl: null,
        previewUrl: null,
        streamUrl: "/api/amenities/evidence/a2/stream",
      },
      {
        assetId: "a0000000-0000-4000-8000-000000000003",
        kind: "photo",
        available: false,
        thumbUrl: null,
        previewUrl: null,
        streamUrl: null,
      },
    ],
    wifi: {
      testSpot: "Garden table 4",
      testedOn: "2026-11-04",
      downloadMbps: 52,
      uploadMbps: 11,
    },
    isCurrent: true,
    ...overrides,
  }
}

export function detail(overrides: Partial<CheckDetail> = {}): CheckDetail {
  return {
    check: WIFI_CHECK,
    submissions: [
      submission(),
      submission({
        id: "50000000-0000-4000-8000-000000000002",
        answer: "no",
        finding: null,
        limitations: null,
        reason: "Router was broken that week.",
        submittedAt: "2026-10-01T10:00:00.000Z",
        evidence: [],
        wifi: null,
        isCurrent: false,
      }),
    ],
    events: [
      {
        id: "e2",
        kind: "assigned",
        actor: MANAGER,
        at: "2026-11-03T09:00:00.000Z",
        reason: null,
        detail: { assigneeId: STAFF.id },
      },
      {
        id: "e1",
        kind: "added",
        actor: null,
        at: "2026-11-01T09:00:00.000Z",
        reason: null,
        detail: { source: "enable" },
      },
    ],
    assigneeOptions: [
      { id: STAFF.id, displayName: STAFF.displayName, jobTitle: "Bartender" },
      { id: MANAGER.id, displayName: MANAGER.displayName, jobTitle: null },
    ],
    permissions: {
      canAssign: true,
      canArchive: true,
      canRestore: false,
      canReopen: true,
      canSubmit: true,
      canAttachLegacy: true,
    },
    ...overrides,
  }
}
