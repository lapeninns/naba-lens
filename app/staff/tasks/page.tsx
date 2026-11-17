import { Suspense } from "react"
import { cookies } from "next/headers"

import { setRetakeNoteAsideAction } from "@/app/_coverage/actions"
import { dismissClosedAssignmentAction } from "@/app/_knowledge/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import type { FindingSentCopy } from "@/components/nabalens/amenities/capture/finding-sent-notice"
import { sentNoticeFor } from "@/components/nabalens/knowledge/copy"
import { FINDING_SENT_PARAM } from "@/components/nabalens/amenities/capture/finding-sent"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { AlbumHome } from "@/components/nabalens/album/album-home"
import { Notice } from "@/components/nabalens/notice"
import { currentPlace } from "@/lib/album/model"
import { loadAlbum } from "@/lib/server/album"
import { GoalsHome } from "@/components/nabalens/home/goals-home"
import {
  otherJobsCount,
  STILL_NEEDED_ON_HOME,
  type OurMenuGoal,
} from "@/components/nabalens/home/goals-home-model"
import type { OurMenuProgress } from "@/components/nabalens/home/our-menu-card"
import {
  AlsoThisMonth,
  AlsoThisMonthSkeleton,
} from "@/components/nabalens/home/this-month-card"
import {
  TasksOverview,
  FIRST_RUN_COOKIE,
  showWelcomeEntry,
  type JustSent,
} from "@/components/nabalens/tasks"
import { HomeOverview } from "@/components/nabalens/tasks/home-overview"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import { homeLayout } from "@/lib/config/home-layout"
import { homePrompt } from "@/lib/config/work-roles"
import { withWorkingListEntrances } from "@/lib/knowledge-client/entrances"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { getCheck } from "@/lib/server/amenities"
import {
  getCoverageActor,
  getOurMenu,
  listOurMenuItems,
} from "@/lib/server/coverage"
import type { OurMenuItem } from "@/lib/server/coverage/types"
import type { MediaActor } from "@/lib/server/media/types"
import { listCommunityMedia } from "@/lib/server/community"
import { getMediaActor } from "@/lib/server/media/context"

import {
  myAmenityTasks,
  myContributionEntry,
  myLabelWork,
  myRechecks,
  myRetakeNotes,
  myRetakes,
  myTasks,
  myWorkingList,
  staffShellStatus,
} from "../_shell/shell-status"
import {
  OTHER_JOBS_PATH,
  WELCOME_PATH,
  PORTFOLIO_PATH,
  TASKS_PATH,
  unwrap,
} from "./result"
import { withRecheckSent } from "./sent-recheck"

export const metadata = { title: "Home" }

type SearchParams = Record<string, string | string[] | undefined>

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

/** `?sent=2&task=<id>` or `?replaced=1&task=<id>` after a send. */
function parseJustSent(
  params: SearchParams,
  titleOf: (id: string | undefined) => string | null
): JustSent | null {
  const taskTitle = titleOf(first(params.task))
  if (first(params.replaced)) return { kind: "replaced", taskTitle }
  const count = Number.parseInt(first(params.sent) ?? "", 10)
  return count > 0 && count <= 10 ? { kind: "sent", count, taskTitle } : null
}

/** The newest colleague photos; Home still works when this read fails. */
async function recentColleaguePhotos() {
  try {
    const auth = await getMediaActor("staff")
    if (!auth.ok) return []
    const page = await listCommunityMedia(auth.actor)
    return page.ok ? page.items : []
  } catch {
    return []
  }
}

/**
 * Whether the person has any photo or video of their own (one id, no URLs).
 * A failed read counts as yes, so Start here stays away rather than nag.
 */
async function hasOwnMedia(actor: MediaActor): Promise<boolean> {
  try {
    const { data, error } = await actor.db
      .from("media_assets")
      .select("id")
      .eq("uploader_id", actor.profile.id)
      .limit(1)
    return error ? true : (data?.length ?? 0) > 0
  } catch {
    return true
  }
}

/** This month's findings outside the target (S14); none when unread. */
async function myPending(actor: MediaActor) {
  try {
    const result = await knowledgeServices.getMyPending(actor, {})
    return result.ok ? result.pending : null
  } catch {
    return null
  }
}

/** Our menu for the person's venue; a failed read never breaks Home. */
async function ourMenuProgress(
  actor: MediaActor,
  hasVenue: boolean
): Promise<OurMenuProgress | null> {
  if (!hasVenue) return null
  try {
    const result = await getOurMenu(actor, {})
    if (!result.ok)
      return result.code === "needs_setup" ? null : { state: "unavailable" }
    const { menuState, totals } = result.menu
    return menuState === "ready"
      ? { state: "ready", covered: totals.covered, total: totals.eligible }
      : { state: menuState }
  } catch {
    return { state: "unavailable" }
  }
}

/**
 * Our menu for goal-led Home: the totals and the first few dishes still
 * needed, in menu order, with their review state. A failed list keeps the
 * totals; a failed summary never breaks Home.
 */
async function ourMenuGoal(
  actor: MediaActor,
  hasVenue: boolean
): Promise<OurMenuGoal> {
  if (!hasVenue) return { state: "needs_setup" }
  try {
    const result = await getOurMenu(actor, {})
    if (!result.ok)
      return {
        state: result.code === "needs_setup" ? "needs_setup" : "unavailable",
      }
    const { menuState, totals } = result.menu
    if (menuState !== "ready") return { state: menuState }
    let stillNeeded: OurMenuItem[] | null = []
    if (totals.gaps > 0) {
      const items = await listOurMenuItems(actor, {
        gapsOnly: true,
        limit: STILL_NEEDED_ON_HOME,
      }).catch(() => null)
      stillNeeded = items?.ok ? items.items : null
    }
    return {
      state: "ready",
      covered: totals.covered,
      total: totals.eligible,
      gaps: totals.gaps,
      needsRecheck: totals.needsRecheck,
      stillNeeded,
    }
  } catch {
    return { state: "unavailable" }
  }
}

/**
 * When the working list can't be read, a complete check may still have a
 * newer finding of mine waiting: say it was sent, never that it is complete.
 */
const SENT_NEUTRAL: FindingSentCopy = {
  title: "Sent",
  body: "",
  tone: "positive",
}

/**
 * The amenity check named by `?finding_sent=<id>`, as the database has it now:
 * the notice is never shown on the word of the URL alone. A working-list
 * question says what happened to my latest finding (design §4.3); any other
 * check only once it is complete and answered by me.
 */
async function sentFinding(
  actor: MediaActor,
  params: SearchParams
): Promise<string | { question: string; copy: FindingSentCopy } | null> {
  const checkId = first(params[FINDING_SENT_PARAM])
  if (!checkId) return null
  const list = await myWorkingList(actor)
  const slot = list?.slots.find((item) => item.checkId === checkId)
  if (slot) {
    const copy = sentNoticeFor(slot)
    return copy
      ? {
          question: slot.question,
          copy: await withRecheckSent(actor, slot, copy),
        }
      : null
  }
  try {
    const result = await getCheck(actor, { checkId })
    if (!result.ok) return null
    const { check } = result.detail
    if (
      check.progress !== "complete" ||
      check.answeredBy?.id !== actor.profile.id
    )
      return null
    return list === undefined
      ? { question: check.entry.question, copy: SENT_NEUTRAL }
      : check.entry.question
  } catch {
    return null
  }
}

const UPLOAD_BLOCKED = {
  not_staff: "Only staff accounts can add photos.",
  no_venue: "You can't add photos until an admin assigns your venue.",
  venue_inactive:
    "Your venue isn't taking photos right now, so you can't add any. Ask an admin to check your venue.",
} as const

/**
 * Staff Home. On the goals layout (the default): Our menu, Your month and the
 * retake note. B02 and B01 (To do and tasks) stay only as a rollback.
 */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const profile = await requireActiveStaff()
  const { actor } = unwrap(await getCoverageActor())
  const dismissedAt = profile.work?.welcomeDismissedAt ?? null
  const layout = homeLayout(profile.venueId)
  if (layout === "goals")
    return goalsTasksPage({ profile, actor, searchParams })
  if (layout === "album")
    return albumTasksPage({ profile, actor, searchParams })
  // B02 streams these lines in their own boundary rather than waiting here.
  const streamedPending = layout === "b02" ? myPending(actor) : null
  const [
    { tasks },
    colleagues,
    params,
    shell,
    ownMedia,
    ourMenu,
    jar,
    amenityTasks,
    findingSent,
    workingList,
    pending,
    labels,
    retakes,
    entry,
    rechecks,
  ] = await Promise.all([
    myTasks(actor).then(unwrap),
    recentColleaguePhotos(),
    searchParams,
    staffShellStatus(actor, profile),
    // Once dismissed, Start here never shows, so skip the read.
    dismissedAt ? true : hasOwnMedia(actor),
    ourMenuProgress(actor, Boolean(profile.venueId)),
    cookies(),
    myAmenityTasks(actor),
    searchParams.then((p) => sentFinding(actor, p)),
    myWorkingList(actor),
    layout === "b01" ? myPending(actor) : null,
    layout === "b02" ? myLabelWork(actor) : null,
    layout === "b02" ? myRetakes(actor) : null,
    layout === "b02" && profile.venue && !uploadBlockReason(profile)
      ? myContributionEntry(actor, profile.venue.name)
      : null,
    // B03-e: open rechecks on checks assigned to me; null when unreadable.
    layout === "b02" ? myRechecks(actor) : null,
  ])
  // A step-free Yes names its entrances on Home and To do (B03 UI §3.5).
  const listed = workingList
    ? await withWorkingListEntrances(actor, workingList)
    : workingList
  const { reviewCount } = shell
  const blockedReason = uploadBlockReason(profile)

  // The legacy cookie is still read (people who saw the old welcome keep it
  // dismissed) but no longer written: dismissal lives in the database.
  const showWelcome = showWelcomeEntry({
    dismissedAt,
    legacyCookie: jar.has(FIRST_RUN_COOKIE),
    hasOwnMedia: ownMedia,
  })

  const justSent = parseJustSent(
    params,
    (id) =>
      tasks.assignments.find((a) => a.requirement.id === id)?.requirement
        .title ?? null
  )

  const common = {
    tasks,
    profile: {
      displayName: profile.displayName,
      venueName: profile.venue?.name ?? null,
      department: profile.department ?? null,
      hasAvatar: profile.avatarPath !== null,
    },
    tasksPath: TASKS_PATH,
    portfolioPath: PORTFOLIO_PATH,
    reviewCount,
    reviewError: shell.canManage && reviewCount === undefined,
    justSent,
    colleagues,
    welcomeHref: showWelcome ? WELCOME_PATH : null,
    contribute: {
      prompt: homePrompt(profile.work?.roleKey),
      blocked: blockedReason ? UPLOAD_BLOCKED[blockedReason] : null,
      canAnswer: entry?.intents.includes("question") ?? false,
    },
    ourMenu,
    amenityTasks,
    findingSent,
    workingList: listed ?? null,
    workingListError: listed === undefined,
    onDismissClosed: dismissClosedAssignmentAction,
  }

  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
    >
      <OfflineNotice className="mb-3" />
      {streamedPending ? (
        <HomeOverview
          {...common}
          labelWork={labels?.status === "ok" ? labels.work : null}
          labelWorkError={labels?.status === "failed"}
          retakes={retakes}
          rechecks={rechecks}
          alsoThisMonth={
            <Suspense fallback={<AlsoThisMonthSkeleton />}>
              <AlsoThisMonth pending={streamedPending} />
            </Suspense>
          }
        />
      ) : (
        <TasksOverview {...common} alsoPending={pending} />
      )}
    </AppShell>
  )
}

/** The goal-led Home (goals-not-tasks G-1): its own reads, nothing of To do. */
async function goalsTasksPage({
  profile,
  actor,
  searchParams,
}: {
  profile: Awaited<ReturnType<typeof requireActiveStaff>>
  actor: MediaActor
  searchParams: Promise<SearchParams>
}) {
  const dismissedAt = profile.work?.welcomeDismissedAt ?? null
  const [
    { tasks },
    colleagues,
    params,
    shell,
    ownMedia,
    ourMenu,
    jar,
    amenityTasks,
    findingSent,
    workingList,
    notes,
    labels,
    rechecks,
  ] = await Promise.all([
    myTasks(actor).then(unwrap),
    recentColleaguePhotos(),
    searchParams,
    staffShellStatus(actor, profile),
    // Once dismissed, Start here never shows, so skip the read.
    dismissedAt ? true : hasOwnMedia(actor),
    ourMenuGoal(actor, Boolean(profile.venueId)),
    cookies(),
    myAmenityTasks(actor),
    searchParams.then((p) => sentFinding(actor, p)),
    myWorkingList(actor),
    // G-3: every note with its server-decided status; Home shows open ones.
    myRetakeNotes(actor),
    myLabelWork(actor),
    myRechecks(actor),
  ])
  const { reviewCount } = shell
  const blockedReason = uploadBlockReason(profile)

  const showWelcome = showWelcomeEntry({
    dismissedAt,
    legacyCookie: jar.has(FIRST_RUN_COOKIE),
    hasOwnMedia: ownMedia,
  })
  const justSent = parseJustSent(
    params,
    (id) =>
      tasks.assignments.find((a) => a.requirement.id === id)?.requirement
        .title ?? null
  )

  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
    >
      <OfflineNotice className="mb-3" />
      <GoalsHome
        scope={tasks.scope}
        period={tasks.period}
        profile={{
          displayName: profile.displayName,
          venueName: profile.venue?.name ?? null,
          department: profile.department ?? null,
          hasAvatar: profile.avatarPath !== null,
        }}
        monthly={tasks.monthly}
        ourMenu={ourMenu}
        notes={notes ?? []}
        notesError={notes === null}
        onLater={setRetakeNoteAsideAction}
        labels={labels.status === "ok" ? labels.work : null}
        labelsError={labels.status === "failed"}
        otherJobs={otherJobsCount({
          tasks,
          amenityTasks,
          slots: workingList?.slots ?? null,
          rechecks,
        })}
        otherJobsError={
          amenityTasks === null ||
          workingList === undefined ||
          rechecks === null
        }
        reviewCount={reviewCount ?? 0}
        reviewError={shell.canManage && reviewCount === undefined}
        canAdd={blockedReason === null}
        // No venue is the setup notice's to explain.
        blocked={
          blockedReason && blockedReason !== "no_venue"
            ? UPLOAD_BLOCKED[blockedReason]
            : null
        }
        welcomeHref={showWelcome ? WELCOME_PATH : null}
        justSent={justSent}
        findingSent={findingSent}
        colleagues={colleagues}
        tasksPath={TASKS_PATH}
        portfolioPath={PORTFOLIO_PATH}
        otherJobsHref={OTHER_JOBS_PATH}
      />
    </AppShell>
  )
}

/**
 * Album (DESIGN.md §5a, batch A2): the venue's empty slots by place, the
 * retake row and one gallery-first main button. Opt-in per venue
 * (lib/config/home-layout.ts) until batch A5. `?place=<id>` chooses the
 * place; "unplaced" is the Not placed yet group.
 */
async function albumTasksPage({
  profile,
  actor,
  searchParams,
}: {
  profile: Awaited<ReturnType<typeof requireActiveStaff>>
  actor: MediaActor
  searchParams: Promise<SearchParams>
}) {
  const [params, shell, album, notes] = await Promise.all([
    searchParams,
    staffShellStatus(actor, profile),
    loadAlbum(actor),
    myRetakeNotes(actor),
  ])
  const blockedReason = uploadBlockReason(profile)
  const place = typeof params.place === "string" ? params.place : null
  const retakes = (notes ?? []).flatMap((note) =>
    note.kind === "menu" &&
    note.dish &&
    note.canRetake &&
    note.status === "open"
      ? [
          {
            itemId: note.dish.itemId,
            itemName: note.dish.itemName,
            reason: note.reason,
          },
        ]
      : []
  )
  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
    >
      <OfflineNotice className="mb-3" />
      {album.ok ? (
        <AlbumHome
          venueName={profile.venue?.name ?? ""}
          album={album.album}
          current={currentPlace(album.album, place)}
          retakes={retakes}
          canAdd={blockedReason === null}
          blocked={
            blockedReason && blockedReason !== "no_venue"
              ? UPLOAD_BLOCKED[blockedReason]
              : null
          }
        />
      ) : (
        <Notice tone="negative" role="alert">
          {album.message}
        </Notice>
      )}
    </AppShell>
  )
}
