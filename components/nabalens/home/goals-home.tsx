import type { Department } from "@/lib/config/departments"

import {
  FindingSentNotice,
  type FindingSentCopy,
} from "../amenities/capture/finding-sent-notice"
import { Notice } from "../notice"
import { PageHeader } from "../page-header"
import type { MediaItem } from "../types"
import { ColleaguePosts } from "../tasks/colleague-posts"
import { PhotosSentNotice } from "../tasks/photos-sent-notice"
import { SetupChecklist } from "../tasks/setup-checklist"
import {
  RULE_SENTENCE,
  sentNotice,
  type JustSent,
} from "../tasks/tasks-overview"
import { ReadFailed, ReviewCard, WelcomeCard } from "../tasks/todo-list"
import type { CoverageScope, MonthlyProgress, PeriodView } from "../tasks/types"
import {
  goalsPrimary,
  type OurMenuGoal,
  type RetakeNote,
} from "./goals-home-model"
import { OtherJobsRow } from "./other-jobs-row"
import { OUR_MENU_HEADING_ID, OurMenuGoalCard } from "./our-menu-goal-card"
import { RetakeNoteSlot } from "./retake-note-slot"
import { YourMonthCard } from "./your-month-card"

// TEMP copy (G-1): G-5 moves these into the copy files.
const READ_FAILED = {
  notes: "We couldn't check requests for another photo.",
  otherJobs: "We couldn't check your other jobs.",
  review: "We couldn't check photos to review.",
} as const

/**
 * Staff Home on the goals layout (goals-not-tasks G-1, v0.5 rule 21): the
 * setup notice, the retake note, Our menu with the dishes still needed, Your
 * month and colleagues' photos. Named slots keep the welcome entry, Other
 * jobs (decision 10) and Photos to review for legacy-grant reviewers. No
 * assignment, due date or Overdue for food and drink work, no share box, and
 * one main action (decision 12).
 */
export function GoalsHome({
  scope,
  period,
  profile,
  monthly,
  ourMenu,
  notes,
  notesError = false,
  otherJobs,
  otherJobsError = false,
  reviewCount = 0,
  reviewError = false,
  canAdd,
  blocked = null,
  welcomeHref = null,
  justSent = null,
  findingSent = null,
  colleagues = [],
  tasksPath,
  portfolioPath,
  otherJobsHref = `${tasksPath}/all`,
  photosPath = "/staff/community",
  peoplePath = "/staff/people",
}: {
  scope: CoverageScope
  period: PeriodView
  profile: {
    displayName: string
    venueName: string | null
    department: Department | null
    hasAvatar: boolean
  }
  monthly: MonthlyProgress | null
  ourMenu: OurMenuGoal
  notes: readonly RetakeNote[]
  /** The notes couldn't all be read: say so, never "no notes". */
  notesError?: boolean
  otherJobs: number
  otherJobsError?: boolean
  /** Photos waiting for this reviewer (legacy grant); 0 for everyone else. */
  reviewCount?: number
  reviewError?: boolean
  /** The person can add photos now. */
  canAdd: boolean
  /** Why photos can't be added, when they can't. */
  blocked?: string | null
  welcomeHref?: string | null
  justSent?: JustSent | null
  findingSent?: string | { question: string; copy: FindingSentCopy } | null
  colleagues?: MediaItem[]
  tasksPath: string
  portfolioPath: string
  otherJobsHref?: string
  photosPath?: string
  peoplePath?: string
}) {
  const primary = goalsPrimary({ notes, menu: ourMenu, canAdd })
  const sent =
    typeof findingSent === "string"
      ? { question: findingSent, copy: undefined }
      : findingSent

  return (
    <div className="mx-auto grid w-full max-w-feed min-w-0 gap-gutter">
      <PageHeader
        scope={[scope.venue?.name, period.label]}
        venueScope={Boolean(scope.venue)}
        title="Home"
        className="pb-1 md:pb-2"
      />

      {justSent ? (
        <PhotosSentNotice>{sentNotice(justSent)}</PhotosSentNotice>
      ) : null}

      {sent ? (
        <FindingSentNotice
          question={sent.question}
          copy={sent.copy}
          returnFocusId={OUR_MENU_HEADING_ID}
        />
      ) : null}

      {/* Setup notice: no venue, team or name. */}
      <SetupChecklist
        setup={scope.setup}
        profile={profile}
        editProfileHref={`${portfolioPath}?edit=profile`}
      />

      {blocked ? <Notice role="status">{blocked}</Notice> : null}

      {/* Slot: the welcome entry. */}
      {welcomeHref ? (
        <ul className="grid">
          <WelcomeCard href={welcomeHref} primary={false} />
        </ul>
      ) : null}

      {/* Slot: the retake note (content owned by G-3). */}
      {notesError ? (
        <ReadFailed retryHref={tasksPath}>{READ_FAILED.notes}</ReadFailed>
      ) : null}
      <RetakeNoteSlot
        notes={notes}
        primaryKey={primary?.kind === "reshoot" ? primary.noteKey : null}
        canSubmit={scope.canSubmit}
        tasksPath={tasksPath}
        portfolioPath={portfolioPath}
      />

      <OurMenuGoalCard
        menu={ourMenu}
        venueName={scope.venue?.name ?? null}
        canAdd={canAdd}
        primary={primary}
      />

      <YourMonthCard monthly={monthly} monthHref={`${tasksPath}/month`} />

      <p className="max-w-reading px-1 text-meta text-ink-muted">
        {RULE_SENTENCE}
      </p>

      {/* Slot: Other jobs (decision 10). */}
      {otherJobsError ? (
        <ReadFailed retryHref={tasksPath}>{READ_FAILED.otherJobs}</ReadFailed>
      ) : null}
      <OtherJobsRow count={otherJobs} href={otherJobsHref} />

      {/* Slot: Photos to review, for legacy-grant reviewers. */}
      {reviewError ? (
        <ReadFailed retryHref={tasksPath}>{READ_FAILED.review}</ReadFailed>
      ) : reviewCount > 0 ? (
        <ul className="grid">
          <ReviewCard
            count={reviewCount}
            venueName={scope.venue?.name ?? null}
            primary={false}
          />
        </ul>
      ) : null}

      <div className="mt-3 empty:hidden">
        <ColleaguePosts
          items={colleagues}
          photosHref={photosPath}
          peopleHref={peoplePath}
        />
      </div>
    </div>
  )
}
