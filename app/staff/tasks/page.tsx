import { cookies } from "next/headers"

import { AppShell } from "@/components/nabalens/app-shell"
import { AlbumHome } from "@/components/nabalens/album/album-home"
import {
  OtherJobsRow,
  StartHereRow,
} from "@/components/nabalens/album/home-rows"
import { FINDING_SENT_PARAM } from "@/components/nabalens/amenities/capture/finding-sent"
import {
  FindingSentNotice,
  type FindingSentCopy,
} from "@/components/nabalens/amenities/capture/finding-sent-notice"
import { sentNoticeFor } from "@/components/nabalens/knowledge/copy"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import {
  FIRST_RUN_COOKIE,
  showWelcomeEntry,
} from "@/components/nabalens/tasks/first-run-state"
import { currentPlace } from "@/lib/album/model"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import { loadAlbum } from "@/lib/server/album"
import { rememberedAlbumPlace } from "@/lib/server/album-place"
import { MatchLaterRow } from "@/components/nabalens/album/match/match-later"
import { listMatchLater } from "@/app/staff/_shell/match-later"
import { getCheck } from "@/lib/server/amenities"
import { getCoverageActor } from "@/lib/server/coverage"
import type { MediaActor } from "@/lib/server/media/types"

import {
  myAlbumRetakes,
  myOtherJobsCount,
  myWorkingList,
  staffShellStatus,
} from "../_shell/shell-status"
import { ADD_BLOCKED } from "../add-blocked"
import { OTHER_JOBS_PATH, WELCOME_PATH, unwrap } from "./result"
import { withRecheckSent } from "./sent-recheck"

export const metadata = { title: "Album" }

type SearchParams = Record<string, string | string[] | undefined>

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

/** Where Dismiss on the finding notice hands focus: the top of Album. */
const ALBUM_TOP_ID = "album-top"

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

/**
 * Staff Home is Album (DESIGN.md §5a, batch A5): the venue's empty slots by
 * place, the retake row and one gallery-first main button. `?place=<id>`
 * chooses the place; "unplaced" is the Not placed yet group. A new starter
 * gets Start here until they dismiss the welcome or add a photo; Other jobs
 * (assigned tasks, amenity checks, venue questions) has a row when there are
 * any, or when they couldn't be counted. After an amenity answer (`?finding_sent=<id>`) the notice says what happened to it,
 * written on the page (§6.7).
 */
export default async function AlbumHomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const profile = await requireActiveStaff()
  const { actor } = unwrap(await getCoverageActor())
  const dismissedAt = profile.work?.welcomeDismissedAt ?? null
  const [
    params,
    shell,
    album,
    retakes,
    findingSent,
    remembered,
    later,
    otherJobs,
    ownMedia,
    jar,
  ] = await Promise.all([
    searchParams,
    staffShellStatus(actor, profile),
    loadAlbum(actor),
    myAlbumRetakes(actor),
    searchParams.then((p) => sentFinding(actor, p)),
    // AL-2: the place this phone last opened, when ?place= is not given.
    rememberedAlbumPlace(),
    // AL-1: photos added without a slot, for the Match later row (§5a).
    listMatchLater(actor).catch(() => null),
    myOtherJobsCount(actor),
    // Once dismissed, Start here never shows, so skip the read.
    dismissedAt ? true : hasOwnMedia(actor),
    cookies(),
  ])
  const blockedReason = uploadBlockReason(profile)
  // The legacy cookie still counts as dismissed; dismissal lives in the
  // database (setWelcomeDismissedAction on the welcome).
  const showWelcome = showWelcomeEntry({
    dismissedAt,
    legacyCookie: jar.has(FIRST_RUN_COOKIE),
    hasOwnMedia: ownMedia,
  })
  const place = first(params.place) ?? remembered ?? null
  const sent =
    typeof findingSent === "string"
      ? { question: findingSent, copy: undefined }
      : findingSent
  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
    >
      <OfflineNotice className="mb-3" />
      <div id={ALBUM_TOP_ID} tabIndex={-1} className="grid gap-3 outline-none">
        {sent ? (
          <FindingSentNotice
            question={sent.question}
            copy={sent.copy}
            returnFocusId={ALBUM_TOP_ID}
          />
        ) : null}
        {album.ok ? (
          <AlbumHome
            venueName={profile.venue?.name ?? ""}
            album={album.album}
            current={currentPlace(album.album, place)}
            retakes={retakes ?? []}
            canAdd={blockedReason === null}
            blocked={blockedReason ? ADD_BLOCKED[blockedReason] : null}
            matchLater={<MatchLaterRow count={later?.length ?? 0} />}
            startHere={
              <StartHereRow href={showWelcome ? WELCOME_PATH : null} />
            }
            otherJobs={
              <OtherJobsRow count={otherJobs} href={OTHER_JOBS_PATH} />
            }
          />
        ) : blockedReason === "no_venue" ? (
          // Without a venue there is no album to read: say why, not an error.
          <Notice role="status">{ADD_BLOCKED.no_venue}</Notice>
        ) : (
          <Notice tone="negative" role="alert">
            {album.message}
          </Notice>
        )}
      </div>
    </AppShell>
  )
}
