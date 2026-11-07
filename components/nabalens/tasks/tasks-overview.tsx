import type { Department } from "@/lib/config/departments"

import { EmptyState } from "../empty-state"
import { ContributeCard } from "../home/contribute-card"
import { OurMenuCard, type OurMenuProgress } from "../home/our-menu-card"
import { Notice } from "../notice"
import { PageHeader } from "../page-header"
import { CountBadge } from "../status-chip"
import type { MediaItem } from "../types"
import { AssignmentList } from "./assignment-list"
import { ColleaguePosts } from "./colleague-posts"
import { FirstRunEntry } from "./first-run-entry"
import { MonthlyProgressCard } from "./monthly-progress-card"
import { todoItems, TodoSection } from "./todo-list"
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

function sentNotice(justSent: JustSent) {
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
  contribute = null,
  ourMenu = null,
  amenityChecks = null,
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
  /** The role-aware "add photos" card; null to hide it. */
  contribute?: { prompt: string; blocked: string | null } | null
  /** The venue's menu photo progress; null to hide the card (no venue). */
  ourMenu?: OurMenuProgress | null
  /** Amenity checks assigned to me (UI_TEXT.staffSection), shown after To do. */
  amenityChecks?: React.ReactNode
}) {
  const { scope, period, monthly, assignments, needsAnotherPhoto } = tasks
  const blocked = submitBlockedCopy(scope)
  const replacing = new Set(
    needsAnotherPhoto.flatMap((s) => (s.requirement ? [s.requirement.id] : []))
  )
  const items = todoItems(tasks, new Date(), reviewCount)

  return (
    <div className="mx-auto grid w-full max-w-(--size-feed) min-w-0 gap-(--gutter)">
      <PageHeader
        scope={[scope.venue?.name, period.label]}
        venueScope={Boolean(scope.venue)}
        title="Home"
        className="pb-1 md:pb-2"
      />

      {justSent ? (
        <Notice tone="positive" role="status">
          {sentNotice(justSent)}
        </Notice>
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
      />

      {amenityChecks}

      <div className="mt-3 grid gap-(--gutter)">
        <MonthlyProgressCard
          monthly={monthly}
          periodLabel={period.label}
          addHref={`${tasksPath}/month`}
          canSubmit={scope.canSubmit}
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
