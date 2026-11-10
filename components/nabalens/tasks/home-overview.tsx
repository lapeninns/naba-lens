import type { MyAmenityTask } from "@/lib/amenities/contract"
import type { Department } from "@/lib/config/departments"
import type { WorkingList } from "@/lib/knowledge-client/contract"
import type { LabelWork } from "@/lib/work-client/contract"
import { withoutTodo } from "@/lib/work-client/todo"

import { AmenityTaskList } from "../amenities/capture/amenity-task-list"
import {
  FindingSentNotice,
  type FindingSentCopy,
} from "../amenities/capture/finding-sent-notice"
import { EmptyState } from "../empty-state"
import { ContributeCard } from "../home/contribute-card"
import type { OurMenuProgress } from "../home/our-menu-card"
import { ThisMonthCard } from "../home/this-month-card"
import { WorkingListSection } from "../knowledge/working-list"
import { Notice } from "../notice"
import { PageHeader } from "../page-header"
import { CountBadge } from "../status-chip"
import type { MediaItem } from "../types"
import { AssignmentList } from "./assignment-list"
import { ColleaguePosts } from "./colleague-posts"
import { FirstRunEntry } from "./first-run-entry"
import { NextActions } from "./next-actions"
import {
  checkKey,
  nextActions,
  taskKey,
  tasksInTodo,
  type RetakeRequest,
} from "./next-actions-model"
import { PhotosSentNotice } from "./photos-sent-notice"
import {
  RULE_SENTENCE,
  sentNotice,
  submitBlockedCopy,
  type JustSent,
} from "./tasks-overview"
import { TODO_HEADING_ID } from "./todo-list"
import type { MyTasksView } from "./types"

const NO_REPLACEMENT_CHIPS: ReadonlySet<string> = new Set()

const moreInTodo = (count: number) =>
  `${count} more ${count === 1 ? "is" : "are"} in To do.`

/**
 * Staff Home on the B02 layout (design §3): To do around next actions, each
 * piece of work in one place, then one compact progress card. The B01 Home
 * is TasksOverview.
 */
export function HomeOverview({
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
  labelWork = null,
  labelWorkError = false,
  retakes = [],
  alsoThisMonth = null,
}: {
  tasks: MyTasksView
  profile: {
    displayName: string
    venueName: string | null
    department: Department | null
    hasAvatar: boolean
  }
  tasksPath: string
  portfolioPath: string
  justSent?: JustSent | null
  colleagues?: MediaItem[]
  photosPath?: string
  peoplePath?: string
  welcomeHref?: string | null
  reviewCount?: number
  reviewError?: boolean
  contribute?: { prompt: string; blocked: string | null } | null
  ourMenu?: OurMenuProgress | null
  /** Null when they couldn't be read. */
  amenityTasks?: MyAmenityTask[] | null
  findingSent?: string | { question: string; copy: FindingSentCopy } | null
  workingList?: WorkingList | null
  workingListError?: boolean
  onDismissClosed?: (input: { eventId: number }) => Promise<unknown>
  /** R1 counts; null hides the labels card (can't label, or no B02 read). */
  labelWork?: LabelWork | null
  labelWorkError?: boolean
  /** Better photos asked of me; null when they couldn't be read. */
  retakes?: RetakeRequest[] | null
  /** The "Also this month" lines, streamed in their own Suspense boundary. */
  alsoThisMonth?: React.ReactNode
}) {
  const { scope, period, monthly, assignments } = tasks
  const blocked = submitBlockedCopy(scope)
  const actions = nextActions({
    tasks,
    reviewCount,
    amenityChecks: amenityTasks ?? [],
    slots: workingList?.slots ?? [],
    retakes: retakes ?? [],
    labels: labelWork,
  })

  // One home per piece of work (§2): rows already in To do are only counted.
  const listed = workingList
    ? withoutTodo(workingList.slots, (slot) => checkKey(slot.checkId), actions)
    : null
  // The old list only where there's no working list, so the two never share
  // a screen; its checks are all To do cards, so it keeps what's left.
  const legacy = workingList
    ? []
    : withoutTodo(amenityTasks ?? [], (task) => checkKey(task.id), actions)
        .rows
  const inTodo = tasksInTodo(actions)
  const others = assignments.filter(
    (a) => !inTodo.has(taskKey(a.requirement.id))
  )
  const othersInTodo = assignments.length - others.length

  const sent =
    typeof findingSent === "string"
      ? { question: findingSent, copy: undefined }
      : findingSent
  const venueName = scope.venue?.name ?? "your venue"

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

      {contribute ? (
        <ContributeCard
          prompt={contribute.prompt}
          blocked={contribute.blocked}
        />
      ) : null}

      {welcomeHref ? <FirstRunEntry href={welcomeHref} /> : null}

      {blocked && scope.venue ? <Notice role="status">{blocked}</Notice> : null}

      <NextActions
        actions={actions}
        scope={scope}
        profile={profile}
        tasksPath={tasksPath}
        portfolioPath={portfolioPath}
        errors={{
          review: reviewError,
          amenity: amenityTasks === null || workingListError,
          labels: labelWorkError,
          retakes: retakes === null,
        }}
      />

      {workingList && listed ? (
        <>
          <WorkingListSection
            list={{ ...workingList, slots: listed.rows }}
            onDismiss={onDismissClosed}
          />
          {listed.rows.length > 0 && listed.inTodo > 0 ? (
            <p className="max-w-(--size-reading) px-1 text-body text-ink-muted">
              {moreInTodo(listed.inTodo)}
            </p>
          ) : null}
        </>
      ) : null}

      <AmenityTaskList tasks={legacy} />

      <div className="mt-3 grid gap-(--gutter)">
        <ThisMonthCard
          monthly={monthly}
          ourMenu={ourMenu}
          also={alsoThisMonth}
          monthHref={`${tasksPath}/month`}
        />

        <p className="max-w-(--size-reading) px-1 text-meta text-ink-muted">
          {RULE_SENTENCE}
        </p>
      </div>

      <div className="mt-3 empty:hidden">
        <ColleaguePosts
          items={colleagues}
          photosHref={photosPath}
          peopleHref={peoplePath}
        />
      </div>

      <section
        aria-labelledby="other-tasks-heading"
        className="mt-3 grid gap-(--gutter)"
      >
        <div className="grid gap-1 px-1 pt-2">
          <h2
            id="other-tasks-heading"
            className="font-display text-section-title [overflow-wrap:anywhere] text-ink"
          >
            Other tasks this month
          </h2>
          <p className="max-w-(--size-reading) text-body text-ink-muted">
            Tasks assigned to you at {venueName}. Overdue tasks still take
            photos.
          </p>
          {othersInTodo > 0 ? (
            <p className="max-w-(--size-reading) text-body text-ink-muted">
              {moreInTodo(othersInTodo)}
            </p>
          ) : null}
        </div>
        {others.length > 0 ? (
          <>
            <h3 className="flex items-center gap-2 px-1 text-item-title text-ink">
              Assigned to you
              <CountBadge count={others.length} label="tasks" />
            </h3>
            <AssignmentList
              assignments={others}
              tasksPath={tasksPath}
              needsAnotherPhoto={NO_REPLACEMENT_CHIPS}
            />
          </>
        ) : othersInTodo === 0 ? (
          <EmptyState
            variant="done"
            className="rounded-card bg-surface px-4 shadow-card"
            title="Nothing is assigned to you this month."
            description={`Your manager assigns tasks at ${venueName}. You can still add photos to your profile.`}
          />
        ) : null}
      </section>
    </div>
  )
}
