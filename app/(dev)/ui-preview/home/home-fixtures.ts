// DEV FIXTURE: fake staff Home data for the UI preview route only. Not real
// staff, venues or media. Shapes follow lib/server/coverage/types.ts and
// lib/amenities/contract.ts; images are generated flat-colour SVGs.

import type { OurMenuProgress } from "@/components/nabalens/home/our-menu-card"
import type {
  CoveragePerson,
  DueView,
  MyAssignment,
  MyTasksView,
  PeriodView,
  RequirementView,
  SubmissionView,
} from "@/components/nabalens/tasks"
import type { MyAmenityTask } from "@/lib/amenities/contract"

import { sampleImage } from "../fixtures"

const VENUE = { id: "venue-a", name: "Sample venue A" }

const ME: CoveragePerson = {
  id: "staff-me",
  displayName: "Sample Sam",
  avatarUrl: null,
  department: "foh",
  jobTitle: "Bartender",
  active: true,
}

const COLLEAGUE: CoveragePerson = {
  id: "staff-alex",
  displayName: "Sample Alex",
  avatarUrl: null,
  department: "boh",
  jobTitle: "Chef",
  active: true,
}

const MANAGER = { id: "staff-morgan", displayName: "Sample Morgan" }

const PERIOD: PeriodView = {
  key: "2026-11",
  label: "November 2026",
  startsAt: "2026-11-01T00:00:00.000Z",
  endsAt: "2026-12-01T00:00:00.000Z",
  isCurrent: true,
  timeZone: "Europe/London",
}

function due(dueOn: string, label: string, overdue = false): DueView {
  return { dueOn, dueAt: `${dueOn}T23:59:00.000Z`, label, overdue }
}

let n = 0
function id(prefix: string) {
  n += 1
  return `${prefix}-${n}`
}

function submission(
  colour: string,
  overrides: Partial<SubmissionView> = {}
): SubmissionView {
  const image = sampleImage("Sample", colour, 400, 300)
  return {
    id: id("submission"),
    revision: 1,
    state: "submitted",
    origin: "submitted",
    venueId: VENUE.id,
    period: "2026-11",
    uploadedPeriod: "2026-11",
    requirement: null,
    asset: {
      id: id("asset"),
      thumbnailUrl: image,
      previewUrl: sampleImage("Sample (full)", colour, 1600, 1200),
      width: 1600,
      height: 1200,
      available: true,
    },
    author: { id: ME.id, displayName: ME.displayName, active: true },
    submittedById: ME.id,
    submittedAt: "2026-11-04T10:05:00.000Z",
    countsTowardMonthly: true,
    decision: null,
    archived: false,
    replacesSubmissionId: null,
    ...overrides,
  }
}

function requirement(
  overrides: Partial<RequirementView> = {}
): RequirementView {
  return {
    id: id("requirement"),
    venueId: VENUE.id,
    kind: "menu_section",
    title: "Starters",
    guidance: "Show three different starters on the pass.",
    photoTarget: 4,
    due: due("2026-11-30", "Due 30 Nov 2026"),
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
    revision: 1,
    ...overrides,
  }
}

function assignment(
  req: RequirementView,
  mine: Partial<Omit<MyAssignment, "requirement">> = {}
): MyAssignment {
  return {
    requirement: req,
    assigned: true,
    canSubmit: req.isCurrent,
    mySubmissions: [],
    myAccepted: 0,
    myPending: 0,
    ...mine,
  }
}

const OVERDUE = requirement({
  kind: "venue_specific",
  title: "Entrance and signage",
  guidance:
    "The front door and the pub sign from across the road, in daylight.",
  photoTarget: 2,
  due: due("2026-11-05", "Due 5 Nov 2026", true),
  progress: {
    target: 2,
    accepted: 0,
    pending: 0,
    needsAnotherPhoto: 1,
    evidenceRemoved: 0,
    satisfied: false,
    overdue: true,
  },
})

const STARTERS = requirement({
  due: due("2026-11-12", "Due 12 Nov 2026"),
})

const DESSERTS = requirement({
  title: "Desserts",
  guidance: "Each dessert plated, from the guest's side of the table.",
  photoTarget: 3,
  due: due("2026-11-28", "Due 28 Nov 2026"),
  progress: {
    target: 3,
    accepted: 3,
    pending: 0,
    needsAnotherPhoto: 0,
    evidenceRemoved: 0,
    satisfied: true,
    overdue: false,
  },
})

const GARDEN = requirement({
  kind: "venue_specific",
  title: "Beer garden",
  guidance: "Wide shot of the garden seating, then one of the covered area.",
  photoTarget: 2,
  due: null,
  progress: {
    target: 2,
    accepted: 0,
    pending: 1,
    needsAnotherPhoto: 0,
    evidenceRemoved: 0,
    satisfied: false,
    overdue: false,
  },
})

const NEEDS_ANOTHER = submission("#8a6d2f", {
  state: "needs_another_photo",
  requirement: { id: OVERDUE.id, title: OVERDUE.title },
  decision: {
    decision: "needs_another_photo",
    reason:
      "The sign is cut off at the top. Step back so the whole sign and the door are in frame.",
    decidedAt: "2026-11-06T09:00:00.000Z",
    decidedBy: MANAGER,
    selfReview: false,
    lateAcceptance: false,
  },
})

const MONTHLY_NEEDS_ANOTHER = submission("#6e4a5a", {
  state: "needs_another_photo",
  decision: {
    decision: "needs_another_photo",
    reason: "A bit dark. Try again near the window with the lights on.",
    decidedAt: "2026-11-07T15:30:00.000Z",
    decidedBy: MANAGER,
    selfReview: false,
    lateAcceptance: false,
  },
})

export function homeTasksView(): MyTasksView {
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
    period: PERIOD,
    monthly: {
      targetId: "target-1",
      period: PERIOD,
      venue: VENUE,
      person: ME,
      isCurrentMember: true,
      isManager: false,
      status: "set",
      setupMissing: [],
      targetCount: 5,
      source: "manager",
      revision: 1,
      accepted: 2,
      pending: 1,
      needsAnotherPhoto: 1,
      lateAcceptances: 0,
      evidenceRemoved: 0,
      complete: false,
      due: due("2026-11-30", "Due 30 Nov 2026"),
    },
    assignments: [
      assignment(OVERDUE, {
        mySubmissions: [NEEDS_ANOTHER],
      }),
      assignment(STARTERS, {
        myAccepted: 1,
        myPending: 1,
        mySubmissions: [
          submission("#3f6b5a", {
            requirement: { id: STARTERS.id, title: STARTERS.title },
          }),
        ],
      }),
      assignment(GARDEN, { myPending: 1 }),
      assignment(DESSERTS, { myAccepted: 2 }),
    ],
    needsAnotherPhoto: [NEEDS_ANOTHER, MONTHLY_NEEDS_ANOTHER],
    pendingReview: 2,
  }
}

function amenity(
  key: string,
  category: string,
  question: string,
  overrides: Partial<MyAmenityTask> = {}
): MyAmenityTask {
  return {
    id: `check-${key}`,
    venueId: VENUE.id,
    entry: {
      key,
      category,
      question,
      captureBrief: "Show it as a guest would find it.",
      evidenceRule: "photo",
      isCore: true,
      position: 1,
      version: 1,
    },
    status: "active",
    progress: "needs_capture",
    answer: "to_check",
    assignee: { id: ME.id, displayName: ME.displayName },
    answeredBy: null,
    answeredAt: null,
    recheckReason: null,
    notes: null,
    revision: 1,
    updatedAt: "2026-11-05T10:00:00.000Z",
    ...overrides,
  }
}

export const HOME_AMENITY_TASKS: MyAmenityTask[] = [
  amenity("guest_wifi", "Facilities", "Is there guest Wi-Fi?", {
    progress: "needs_recheck",
    answer: "yes",
    recheckReason: "Password or QR visible",
    entry: {
      key: "guest_wifi",
      category: "Facilities",
      question: "Is there guest Wi-Fi?",
      captureBrief: "Photo of the Wi-Fi sign with the password covered.",
      evidenceRule: "photo",
      isCore: true,
      position: 4,
      version: 1,
    },
  }),
  amenity("step_free_entrance", "Access", "Is there a step-free entrance?", {
    entry: {
      key: "step_free_entrance",
      category: "Access",
      question: "Is there a step-free entrance?",
      captureBrief: "Film the route in from the car park to the bar.",
      evidenceRule: "video",
      isCore: true,
      position: 1,
      version: 1,
    },
  }),
  amenity("on_site_parking", "Getting here", "Is there on-site parking?"),
]

export const HOME_OUR_MENU: OurMenuProgress = {
  state: "ready",
  covered: 12,
  total: 40,
}

export const HOME_PROFILE = {
  displayName: ME.displayName,
  venueName: VENUE.name,
  department: "foh" as const,
  hasAvatar: false,
}
