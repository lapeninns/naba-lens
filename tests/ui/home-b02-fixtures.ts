// Amenity check and working-list fixtures for the B02 Home tests.
import type { MyAmenityTask } from "@/lib/amenities/contract"
import type { WorkingSlot } from "@/lib/knowledge-client/contract"

export function amenityCheck(
  id: string,
  overrides: Partial<MyAmenityTask> = {}
): MyAmenityTask {
  return {
    id,
    progress: "needs_capture",
    recheckReason: null,
    entry: {
      key: id,
      question: `Question ${id}?`,
      category: "Access",
      evidenceRule: "photo_required",
      position: 1,
    },
    ...overrides,
  } as MyAmenityTask
}

export function slot(
  checkId: string,
  overrides: Partial<WorkingSlot> = {}
): WorkingSlot {
  return {
    checkId,
    key: checkId,
    question: `Slot ${checkId}?`,
    category: "Access",
    evidenceRule: "photo_required",
    progress: "needs_capture",
    slotRevision: 1,
    answerInUse: {
      status: "unavailable",
      reason: null,
      detail: "not_checked",
      value: null,
      savedAt: null,
      sentAt: null,
      confirmation: { state: "none", self: false, at: null, by: null },
    },
    previousAnswer: null,
    latestAttempt: null,
    assignee: null,
    mode: "answer",
    requiresConfirmation: false,
    myLatest: null,
    myDraft: null,
    othersPending: 0,
    closedAssignment: null,
    ...overrides,
  } as WorkingSlot
}
