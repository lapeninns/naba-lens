import type { MyAmenityTask } from "@/lib/amenities/contract"
import type { Department } from "@/lib/config/departments"
import type { WorkingList } from "@/lib/knowledge-client/contract"

import { AmenityTaskList } from "../amenities/capture/amenity-task-list"
import {
  FindingSentNotice,
  type FindingSentCopy,
} from "../amenities/capture/finding-sent-notice"
import { EmptyState } from "../empty-state"
import { ContributeCard } from "../home/contribute-card"
import { OurMenuCard, type OurMenuProgress } from "../home/our-menu-card"
import { WorkingListSection } from "../knowledge/working-list"
import { Notice } from "../notice"
import { PageHeader } from "../page-header"
import { CountBadge } from "../status-chip"
import type { MediaItem } from "../types"
import { AssignmentList } from "./assignment-list"
import { ColleaguePosts } from "./colleague-posts"
import { FirstRunEntry } from "./first-run-entry"
import { MonthlyProgressCard } from "./monthly-progress-card"
import { PhotosSentNotice } from "./photos-sent-notice"
import { TODO_HEADING_ID, todoItems, TodoSection } from "./todo-list"
import type { CoverageScope, MyTasksView } from "./types"

/** Why sending is paused (no venue, or an inactive venue), or null. */
export function submitBlockedCopy(scope: CoverageScope): string | null {
  if (scope.canSubmit) return null
  if (!scope.venue) {
    return "You can't send photos until an admin assigns your venue."
  }
  return "Sending photos is paused because your venue isn't taking photos right now. Ask an admin to check your venue."
}

/** A send the person just made, announced above To do. */
export type JustSent =
  | { kind: "sent"; count: number; taskTitle: string | null }
  | { kind: "replaced"; taskTitle: string | null }

export const RULE_SENTENCE =
  "Ready photos are already in Photos and on your profile. Review decides whether they count, not whether they are shared."

export function sentNotice(justSent: JustSent) {
  const task = justSent.taskTitle ?? "this month's photos"
  return justSent.kind === "replaced"
    ? `Your new photo for ${task} is waiting for review.`
    : `${justSent.count === 1 ? "1 photo" : `${justSent.count} photos`} sent to ${task}. A reviewer reviews ${justSent.count === 1 ? "it" : "them"} next.`
}

/** Staff Home: the one thing to do next, this month's photos, then all tasks. */
export function TasksOverview({
  tasks,
  profile,
  tasksPath,
  portfolioPath,
  justSent = null,
  colleagues = [],
  photosPath = "/staff/community",
  peoplePath = "/staff/people",
  welcomeHref = null,
  reviewCount = 0,
  reviewError = false,
  contribute = null,
  ourMenu = null,
  amenityTasks = [],
  findingSent = null,
  workingList = null,
  workingListError = false,
  onDismissClosed,
  alsoPending = null,
}: {
  tasks: MyTasksView
  profile: {
    displayName: string
    venueName: string | null
    department: Department | null
    hasAvatar: boolean
  }
  /** "/staff/tasks" */
  tasksPath: string
  /** Me ("/staff"); its Edit profile opens with `?edit=profile`. */
  portfolioPath: string
  justSent?: JustSent | null
  /** Newest colleague photos, shown below To do. */
  colleagues?: MediaItem[]
  photosPath?: string
  peoplePath?: string
  /** The first-run screen, offered to new starters; null to hide it. */
  welcomeHref?: string | null
  /** Photos waiting for this manager; 0 for everyone else. */
  reviewCount?: number
  /** A manager's photos to review couldn't be counted. */
  reviewError?: boolean
  /** The role-aware "add photos" card; null to hide it. */
  contribute?: { prompt: string; blocked: string | null } | null
  /** The venue's menu photo progress; null to hide the card (no venue). */
  ourMenu?: OurMenuProgress | null
  /** Amenity checks assigned to me: counted in To do, listed after it. Null when they couldn't be read. */
  amenityTasks?: MyAmenityTask[] | null
  /**
   * The amenity check whose finding was just sent: its question (a legacy
   * check, now complete) or its question and what happened to the finding.
   */
  findingSent?: string | { question: string; copy: FindingSentCopy } | null
  /** My venue's working list (B01-06); null when the venue has none. */
  workingList?: WorkingList | null
  /** The working list couldn't be read: To do may be incomplete. */
  workingListError?: boolean
  /** S13: hides a closed assignment from the working list. */
  onDismissClosed?: (input: { eventId: number }) => Promise<unknown>
  /** This month's findings outside the target number (§4.7). */
  alsoPending?: { awaitingConfirmation: number; unknownRecorded: number } | null
}) {
  const { scope, period, monthly, assignments, needsAnotherPhoto } = tasks
  const blocked = submitBlockedCopy(scope)
  const replacing = new Set(
    needsAnotherPhoto.flatMap((s) => (s.requirement ? [s.requirement.id] : []))
  )
  const items = todoItems(
    tasks,
    new Date(),
    reviewCount,
    amenityTasks ?? [],
    workingList?.slots ?? []
  )
  // Working-list questions are listed there; the old list keeps the rest.
  const onList = new Set(workingList?.slots.map((slot) => slot.checkId))
  const offList = (amenityTasks ?? []).filter((task) => !onList.has(task.id))
  const sent =
    typeof findingSent === "string"
      ? { question: findingSent, copy: undefined }
      : findingSent

  return (
    <div className="mx-auto grid w-full max-w-(--size-feed) min-w-0 gap-(--gutter)">
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
          returnFocusId={TODO_HEADING_ID}
        />
      ) : null}

      {/* The share box comes first; Start here sits between it and To do. */}
      {contribute ? (
        <ContributeCard
          prompt={contribute.prompt}
          blocked={contribute.blocked}
        />
      ) : null}

      {welcomeHref ? <FirstRunEntry href={welcomeHref} /> : null}

      {blocked && scope.venue ? <Notice role="status">{blocked}</Notice> : null}

      <TodoSection
        items={items}
        scope={scope}
        profile={profile}
        tasksPath={tasksPath}
        portfolioPath={portfolioPath}
        amenityError={amenityTasks === null || workingListError}
        reviewError={reviewError}
      />

      {workingList ? (
        <WorkingListSection list={workingList} onDismiss={onDismissClosed} />
      ) : null}

      <AmenityTaskList tasks={offList} />

      <div className="mt-3 grid gap-(--gutter)">
        <MonthlyProgressCard
          monthly={monthly}
          periodLabel={period.label}
          addHref={`${tasksPath}/month`}
          canSubmit={scope.canSubmit}
          alsoPending={alsoPending}
        />

        <p className="max-w-(--size-reading) px-1 text-meta text-ink-muted">
          {RULE_SENTENCE}
        </p>
      </div>

      {ourMenu ? (
        <OurMenuCard progress={ourMenu} venueName={scope.venue?.name ?? null} />
      ) : null}

      <div className="mt-3 empty:hidden">
        <ColleaguePosts
          items={colleagues}
          photosHref={photosPath}
          peopleHref={peoplePath}
        />
      </div>

      <section
        aria-labelledby="all-tasks-heading"
        className="mt-3 grid gap-(--gutter)"
      >
        <div className="grid gap-1 px-1 pt-2">
          <h2
            id="all-tasks-heading"
            className="font-display text-section-title [overflow-wrap:anywhere] text-ink"
          >
            All tasks
          </h2>
          <p className="max-w-(--size-reading) text-body text-ink-muted">
            Tasks assigned to you at {scope.venue?.name ?? "your venue"}.
            Overdue tasks still take photos.
          </p>
        </div>
        <h3 className="flex items-center gap-2 px-1 text-item-title text-ink">
          Assigned to you
          <CountBadge count={assignments.length} label="tasks" />
        </h3>
        {assignments.length > 0 ? (
          <AssignmentList
            assignments={assignments}
            tasksPath={tasksPath}
            needsAnotherPhoto={replacing}
          />
        ) : (
          <EmptyState
            variant="done"
            className="rounded-card bg-surface px-4 shadow-card"
            title="Nothing is assigned to you this month."
            description={`Your manager assigns tasks at ${scope.venue?.name ?? "your venue"}. You can still add photos to your profile.`}
          />
        )}
      </section>
    </div>
  )
}
