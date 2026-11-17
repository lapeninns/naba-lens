import "server-only"

import { cache } from "react"

import type { AlbumRetake } from "@/components/nabalens/album/album-home"
import { otherJobsCount } from "@/components/nabalens/tasks/other-jobs-count"
import type { MyAmenityTask } from "@/lib/amenities/contract"
import { contributionEntry } from "@/lib/config/contribution-entry"
import type { WorkingList } from "@/lib/knowledge-client/contract"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { getMyAmenityTasks } from "@/lib/server/amenities"
import {
  getCoverageActor,
  getManagerReviewCount,
  getMyTasks,
  listMyRetakeNotes,
} from "@/lib/server/coverage"
import type { RetakeNote } from "@/lib/server/coverage/types"
import { avatarUrl } from "@/lib/server/media/library"
import type { MediaActor } from "@/lib/server/media/types"
import { entryMenu, type EntryMenu } from "@/lib/work-client/entry"
import { workServices } from "@/lib/work-client/services"

import { canManageVenue } from "../can-manage"

/**
 * One actor per person per request. React's cache matches arguments by
 * identity, and a page and its not-found boundary (or a frame) each build
 * their own actor for the same signed-in person; reusing the first one lets
 * them share the reads below. Both act as that same person, so nothing can
 * be read that the later actor couldn't read itself.
 */
const requestActors = cache(() => new Map<string, MediaActor>())

function sharedActor(actor: MediaActor): MediaActor {
  // No person to match by: keep this actor's own reads, unshared.
  const id = actor.profile?.id
  if (!id) return actor
  const actors = requestActors()
  const first = actors.get(id)
  if (first) return first
  actors.set(id, actor)
  return actor
}

const tasksOf = cache(async (actor: MediaActor) => getMyTasks(actor))

/** My coverage tasks, read once per request however many parts need them. */
export const myTasks = (actor: MediaActor) => tasksOf(sharedActor(actor))

const amenityTasksOf = cache(
  async (actor: MediaActor): Promise<MyAmenityTask[] | null> => {
    try {
      const result = await getMyAmenityTasks(actor, {})
      return result.ok ? result.tasks : null
    } catch {
      return null
    }
  }
)

/**
 * Amenity checks assigned to me, or null when they can't be read: unknown,
 * never "none", so Other jobs doesn't claim there is nothing to do.
 */
export const myAmenityTasks = (actor: MediaActor) =>
  amenityTasksOf(sharedActor(actor))

const workingListOf = cache(
  async (actor: MediaActor): Promise<WorkingList | null | undefined> => {
    try {
      const result = await knowledgeServices.getWorkingList(actor, {})
      return result.ok ? result.view : undefined
    } catch {
      return undefined
    }
  }
)

/**
 * My venue's working list (B01-06): null when the venue has none (its
 * assigned checks keep the old list), undefined when it can't be read.
 */
export const myWorkingList = (actor: MediaActor) =>
  workingListOf(sharedActor(actor))

const capabilitiesOf = cache(async (actor: MediaActor) => {
  try {
    return await workServices.getCapabilities(actor)
  } catch {
    return null
  }
})

/** My capabilities read (R8), once per request; null when it threw. */
export const myCapabilities = (actor: MediaActor) =>
  capabilitiesOf(sharedActor(actor))

const retakeNotesOf = cache(
  async (actor: MediaActor): Promise<RetakeNote[] | null> => {
    try {
      const result = await listMyRetakeNotes(actor)
      return result.ok ? result.notes : null
    } catch {
      return null
    }
  }
)

/**
 * My retake notes (G-3), every status, read once per request for Home and
 * its badge; null when unread.
 */
export const myRetakeNotes = (actor: MediaActor) =>
  retakeNotesOf(sharedActor(actor))

const entryOf = cache(
  async (actor: MediaActor, venueName: string): Promise<EntryMenu | null> => {
    try {
      const [capabilities, list, tasks] = await Promise.all([
        myCapabilities(actor),
        myWorkingList(actor),
        myTasks(actor).catch(() => null),
      ])
      if (capabilities?.status !== "ok") return null
      return entryMenu(capabilities.value, {
        venueName,
        slots: list?.slots ?? [],
        tasks: tasks?.ok ? tasks.tasks.assignments : [],
      })
    } catch {
      return null
    }
  }
)

/**
 * The shared entry's choices for this person (B02-02), or null to keep
 * today's Add: the entry is switched off for the venue, or the capabilities
 * read is missing or failed. A choice whose list can't be read is left out.
 */
export function myContributionEntry(
  actor: MediaActor,
  venueName: string
): Promise<EntryMenu | null> {
  if (contributionEntry(actor.profile?.venueId) !== "b02")
    return Promise.resolve(null)
  return entryOf(sharedActor(actor), venueName)
}

/**
 * Whether the caller manages their venue and, only then, the photos waiting
 * for their review. Runs alongside the tasks rather than after them.
 */
const managerStatusOf = cache(
  async (
    actor: MediaActor
  ): Promise<{ canManage: boolean; reviewCount: number | undefined }> => {
    try {
      if (!(await canManageVenue(actor)))
        return { canManage: false, reviewCount: undefined }
    } catch {
      return { canManage: false, reviewCount: undefined }
    }
    try {
      const result = await getManagerReviewCount(actor)
      return {
        canManage: true,
        reviewCount: result.ok ? result.count : undefined,
      }
    } catch {
      // A failed count keeps Manage (its pages re-read it) without a number.
      return { canManage: true, reviewCount: undefined }
    }
  }
)

const managerStatus = (actor: MediaActor) => managerStatusOf(sharedActor(actor))

/** The staff AppShell's props that come from the database. */
export type StaffShellStatus = {
  canManage: boolean
  /**
   * The Album tab's badge: the retakes Album shows (DESIGN.md §5a, the
   * retake row), never the empty slots. None when the notes can't be read:
   * unknown, never a smaller number.
   */
  todoCount: number | undefined
  /** The count above couldn't be read: the badge says so ("?"). */
  todoUnknown: boolean
  /** Only for a venue manager; none when the read fails. */
  reviewCount: number | undefined
  avatarUrl: string | null
}

/**
 * The retakes Album shows (DESIGN.md §5a): open notes on a dish the person
 * can photograph again now, with the reviewer's reason. Null when unread.
 */
export async function myAlbumRetakes(
  actor: MediaActor
): Promise<AlbumRetake[] | null> {
  const notes = await myRetakeNotes(actor)
  if (!notes) return null
  return notes.flatMap((note) =>
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
}

/**
 * Every staff page's shell status from the same reads, so the Album badge,
 * the Manage badge and the avatar never differ between pages. The reads run
 * in parallel and are shared with the page through `cache`. Display only:
 * every page, action and RPC re-checks access.
 */
export async function staffShellStatus(
  actor: MediaActor,
  profile: { id: string; avatarPath: string | null }
): Promise<StaffShellStatus> {
  const [retakes, { canManage, reviewCount }] = await Promise.all([
    myAlbumRetakes(actor),
    managerStatus(actor),
  ])
  return {
    canManage,
    todoUnknown: retakes === null,
    todoCount: retakes?.length,
    reviewCount,
    avatarUrl: avatarUrl(profile.id, profile.avatarPath),
  }
}

const rechecksOf = cache(async (actor: MediaActor) => {
  try {
    const result = await knowledgeServices.listMyRechecks(actor)
    return result.ok ? result.tasks : null
  } catch {
    return null
  }
})

/** My open recheck tasks (B03-e), once per request; null when unread. */
export const myRechecks = (actor: MediaActor) => rechecksOf(sharedActor(actor))

const NO_STATUS: StaffShellStatus = {
  canManage: false,
  todoCount: undefined,
  todoUnknown: false,
  reviewCount: undefined,
  avatarUrl: null,
}

/**
 * The signed-in staff member's shell status for frames that hold no actor of
 * their own (legacy Manage, not-found). Never throws: a failed read leaves the
 * counts out. Cached per request, so starting it early (`void
 * currentStaffShell()`) lets it run alongside the page's own reads.
 */
export const currentStaffShell = cache(async (): Promise<StaffShellStatus> => {
  try {
    const auth = await getCoverageActor()
    if (!auth.ok) return NO_STATUS
    return await staffShellStatus(auth.actor, auth.actor.profile)
  } catch {
    return { ...NO_STATUS, todoUnknown: true }
  }
})

/**
 * How many Other jobs wait on me (decision 10): the count behind the Other
 * jobs rows on Album and Me (`/staff/tasks/other`). Null when any of its
 * reads fails: unknown, never "none", so the row still shows and the jobs
 * stay reachable.
 */
export async function myOtherJobsCount(
  actor: MediaActor
): Promise<number | null> {
  const [tasks, amenityTasks, list, rechecks] = await Promise.all([
    myTasks(actor).catch(() => null),
    myAmenityTasks(actor),
    myWorkingList(actor),
    myRechecks(actor),
  ])
  if (!tasks?.ok || amenityTasks === null || list === undefined || !rechecks)
    return null
  return otherJobsCount({
    tasks: tasks.tasks,
    amenityTasks,
    slots: list?.slots ?? null,
    rechecks,
  })
}
