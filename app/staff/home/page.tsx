import { cookies } from "next/headers"

import { MatchLaterRow } from "@/components/nabalens/album/match/match-later"
import {
  OtherJobsRow,
  StartHereRow,
} from "@/components/nabalens/album/home-rows"
import { UnfinishedRow } from "@/components/nabalens/album/unfinished-row"
import { AppShell } from "@/components/nabalens/app-shell"
import { AddReminder } from "@/components/nabalens/home/add-reminder"
import { HomeRetakes } from "@/components/nabalens/home/home-retakes"
import { RecentActivity } from "@/components/nabalens/home/recent-activity"
import { FindingSentNotice } from "@/components/nabalens/amenities/capture/finding-sent-notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { AskedFor } from "@/components/nabalens/requests/staff-requests"
import {
  FIRST_RUN_COOKIE,
  showWelcomeEntry,
} from "@/components/nabalens/tasks/first-run-state"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import { getOnboardingState } from "@/lib/auth/venues"
import { askedForItems } from "@/lib/requests/asked-for"
import { loadAlbum } from "@/lib/server/album"
import { getCoverageActor } from "@/lib/server/coverage"
import { listMyRequests } from "@/lib/server/requests"
import { getMyUploads } from "@/lib/server/staff"
import { withStaffAlbumStates } from "@/lib/server/staff-album-posts"
import { STAFF_ALBUM_POSTS } from "@/lib/config/staff-album-posts"
import { addReminder } from "@/lib/staff/home"

import { hasOwnMedia } from "../_shell/album-rows"
import { sentFinding } from "../_shell/finding-sent"
import { listMatchLater } from "../_shell/match-later"
import {
  myAlbumRetakes,
  myOtherJobsCount,
  ownMonth,
  staffShellStatus,
} from "../_shell/shell-status"
import { ADD_BLOCKED } from "../add-blocked"
import { OTHER_JOBS_PATH, WELCOME_PATH, unwrap } from "../tasks/result"

export const metadata = { title: "Today" }

/** Where Dismiss on the finding notice hands focus: the top of Today. */
const TODAY_TOP_ID = "today-top"

/**
 * Staff Home: a reminder to add photos and the person's recent activity
 * (DESIGN.md §5c, D15). Home never chooses a slot; only a reviewer's retake
 * or a manager's request names one. Each read that can fail on its own
 * leaves its part out (or says so) rather than failing Home.
 */
export default async function StaffHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireActiveStaff()
  const { actor } = unwrap(await getCoverageActor())
  const dismissedAt = profile.work?.welcomeDismissedAt ?? null
  const [
    shell,
    monthly,
    album,
    retakes,
    later,
    otherJobs,
    ownMedia,
    jar,
    onboarding,
    requests,
    uploads,
    findingSent,
  ] = await Promise.all([
    staffShellStatus(actor, profile),
    ownMonth(actor),
    loadAlbum(actor),
    myAlbumRetakes(actor),
    listMatchLater(actor).catch(() => null),
    myOtherJobsCount(actor),
    dismissedAt ? true : hasOwnMedia(actor),
    cookies(),
    getOnboardingState(actor.db).catch(() => null),
    listMyRequests(actor).catch(() => null),
    getMyUploads(actor).catch(() => null),
    searchParams.then((p) => sentFinding(actor, p)),
  ])
  const blocked = uploadBlockReason(profile)
  const canAdd = blocked === null
  const showWelcome =
    showWelcomeEntry({
      dismissedAt,
      legacyCookie: jar.has(FIRST_RUN_COOKIE),
      hasOwnMedia: ownMedia,
    }) ||
    (onboarding !== null && !onboarding.noticeAcknowledgedAt)
  const view = album.ok ? album.album : null
  // Posting (D21): Recent activity names a posted photo by its label or as
  // Unlabelled, as My photos does.
  const page =
    uploads?.ok && STAFF_ALBUM_POSTS
      ? await withStaffAlbumStates(actor.db, uploads.page).catch(
          () => uploads.page
        )
      : uploads?.ok
        ? uploads.page
        : null
  const items = page?.items ?? null
  const here = items?.filter((item) => item.venueId === profile.venueId) ?? null
  const asked =
    view && requests?.ok
      ? askedForItems(
          requests.list.items,
          new Map(
            [...view.places, ...(view.unplaced ? [view.unplaced] : [])]
              .flatMap((p) => p.groups.flatMap((g) => g.slots))
              .map((slot) => [slot.id, slot])
          )
        )
      : []

  // Things only this person can do: retakes, requests, other jobs. Failed
  // uploads live on this phone, so their row counts itself.
  const needs = (retakes?.length ?? 0) + asked.length + (otherJobs ?? 0)

  return (
    <AppShell
      variant="staff"
      active="home"
      {...shell}
      userName={profile.displayName}
      venueName={profile.venue?.name}
      monthly={monthly}
    >
      <OfflineNotice className="mb-3" />
      <div
        id={TODAY_TOP_ID}
        tabIndex={-1}
        className="mx-auto grid w-full max-w-feed gap-5 pb-4 outline-none"
      >
        {findingSent ? (
          <FindingSentNotice
            question={
              typeof findingSent === "string"
                ? findingSent
                : findingSent.question
            }
            copy={
              typeof findingSent === "string" ? undefined : findingSent.copy
            }
            returnFocusId={TODAY_TOP_ID}
          />
        ) : null}
        <p className="text-body text-ink-muted" data-slot="today-summary">
          {needs === 0
            ? "Nothing is waiting for you."
            : needs === 1
              ? "1 thing needs you."
              : `${needs} things need you.`}
        </p>
        <StartHereRow href={showWelcome ? WELCOME_PATH : null} />
        {/* Today as the staff prototype draws it (redesign batch S, Open
            Design "NabaLens staff photo workflow"): what needs you, in one
            place, then adding, then labelling, then what you sent. */}
        {needs > 0 ? (
          <section aria-labelledby="needs-you" className="grid gap-3">
            <h2 id="needs-you" className="type-section-title text-ink">
              Needs you
            </h2>
            {canAdd ? <UnfinishedRow /> : null}
            <HomeRetakes retakes={retakes ?? []} canAdd={canAdd} />
            <AskedFor
              items={asked}
              today={requests?.ok ? requests.list.today : ""}
              canAdd={canAdd}
              headingLevel={3}
            />
            <OtherJobsRow count={otherJobs} href={OTHER_JOBS_PATH} />
          </section>
        ) : canAdd ? (
          <UnfinishedRow />
        ) : null}
        <AddReminder
          reminder={addReminder(
            items,
            profile.venueId ?? null,
            new Date(),
            Boolean(uploads?.ok && uploads.page.next)
          )}
          counts={view?.counts ?? null}
          venueName={profile.venue?.name ?? ""}
          blocked={blocked ? ADD_BLOCKED[blocked] : null}
        />
        <MatchLaterRow count={later?.length ?? 0} />
        <RecentActivity items={here} />
      </div>
    </AppShell>
  )
}
