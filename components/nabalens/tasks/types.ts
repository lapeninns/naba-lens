// Staff task view types: the coverage services' DTOs (type-only, safe for
// client components) plus the action shapes the task UI calls.

import type {
  CoverageResult,
  Page,
  SkippedPhoto,
  SubmittablePhoto,
  SubmittedPhoto,
} from "@/lib/server/coverage/types"

export type {
  AssetIneligibleReason,
  CoverageErrorCode,
  CoverageFailure,
  CoveragePerson,
  CoverageResult,
  CoverageScope,
  CoverageVenue,
  DueView,
  Instant,
  LocalDate,
  MonthlyProgress,
  MonthlySetupGap,
  MyAssignment,
  MyMonthView,
  MyTasksView,
  Page,
  PeriodKey,
  PeriodView,
  ProfileSetupGap,
  RequirementKind,
  RequirementProgress,
  RequirementStatus,
  RequirementView,
  SkippedPhoto,
  SubmissionOrigin,
  SubmissionState,
  SubmissionView,
  SubmitPhotosInput,
  SubmittablePhoto,
  SubmittablePhotosInput,
  SubmittedPhoto,
} from "@/lib/server/coverage/types"

export type SubmitPhotosResult = CoverageResult<{
  submitted: SubmittedPhoto[]
  skipped: SkippedPhoto[]
  replayed: boolean
}>

export type SubmittablePhotosResult = CoverageResult<Page<SubmittablePhoto>>
