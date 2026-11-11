import "server-only"

import { cache } from "react"

import { todoCount, todoItems } from "@/components/nabalens/tasks"
import {
  nextActions,
  type RetakeRequest,
} from "@/components/nabalens/tasks/next-actions-model"
import type { MyAmenityTask } from "@/lib/amenities/contract"
import { contributionEntry } from "@/lib/config/contribution-entry"
import { homeLayout } from "@/lib/config/home-layout"
import type { WorkingList } from "@/lib/knowledge-client/contract"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { getMyAmenityTasks } from "@/lib/server/amenities"
import {
  getCoverageActor,
  getManagerReviewCount,
  getMyTasks,
  listMyMenuPhotoDecisions,
} from "@/lib/server/coverage"
import { avatarUrl } from "@/lib/server/media/library"
import type { MediaActor } from "@/lib/server/media/types"
import type { LabelWork } from "@/lib/work-client/contract"
import { entryMenu, type EntryMenu } from "@/lib/work-client/entry"
import { workServices } from "@/lib/work-client/services"
import { todoBadge } from "@/lib/work-client/todo"

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
 * never "none", so To do and the badge don't claim there is nothing to do.
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

/**
 * Home's labels card (B02): the counts, hidden when the account can't label
 * or the database predates B02, or failed (the card says so and the badge is
 * unknown).
 */
export type HomeLabels =
  | { status: "ok"; work: LabelWork }
  | { status: "hidden" }
  | { status: "failed" }

const labelWorkOf = cache(async (actor: MediaActor): Promise<HomeLabels> => {
  try {
    const [work, capabilities] = await Promise.all([
      workServices.getLabelWork(actor),
      // Only to hide the card: R1 already gives zeros to anyone who can't label.
      myCapabilities(actor),
    ])
    if (work.status === "failed") return { status: "failed" }
    if (work.status === "missing") return { status: "hidden" }
    if (capabilities?.status === "ok" && !capabilities.value.canLabel)
      return { status: "hidden" }
    return { status: "ok", work: work.value }
  } catch {
    return { status: "failed" }
  }
})

export const myLabelWork = (actor: MediaActor) =>
  labelWorkOf(sharedActor(actor))

const retakesOf = cache(
  async (actor: MediaActor): Promise<RetakeRequest[] | null> => {
    try {
      const result = await listMyMenuPhotoDecisions(actor, {
        requestsOnly: true,
      })
      if (!result.ok) return null
      // D13: a dish no longer on the menu (or one the menu read couldn't
      // place) asks nothing of this person.
      return result.states.flatMap((state) =>
        state.state === "better_photo_requested" && state.canRetake === true
          ? [
              {
                photoId: state.photoId,
                itemId: state.itemId,
                variantId: state.variantId,
                itemName: state.itemName,
                variantName: state.variantName,
                reason: state.reason,
              },
            ]
          : []
      )
    } catch {
      return null
    }
  }
)

/** Better photos asked of me that I can take now; null when unread. */
export const myRetakes = (actor: MediaActor) => retakesOf(sharedActor(actor))

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
   * Home's To do count; none when the tasks, the checks, the working list or
   * (for a manager) the photos to review can't be read: unknown, never a
   * smaller number.
   */
  todoCount: number | undefined
  /** The count above couldn't be read: the badge says so ("?"). */
  todoUnknown: boolean
  /** Only for a venue manager; none when the read fails. */
  reviewCount: number | undefined
  avatarUrl: string | null
}

/**
 * Every staff page's shell status from the same reads, so the Home badge,
 * the Manage badge and the avatar never differ between pages. The reads run
 * in parallel and are shared with the page through `cache`. Display only:
 * every page, action and RPC re-checks access.
 */
export async function staffShellStatus(
  actor: MediaActor,
  profile: { id: string; avatarPath: string | null }
): Promise<StaffShellStatus> {
  const b02 = homeLayout(actor.profile?.venueId) === "b02"
  const [
    tasks,
    amenityTasks,
    { canManage, reviewCount },
    workingList,
    labels,
    retakes,
  ] = await Promise.all([
    myTasks(actor).catch(() => null),
    myAmenityTasks(actor),
    managerStatus(actor),
    myWorkingList(actor),
    b02 ? myLabelWork(actor) : null,
    b02 ? myRetakes(actor) : null,
  ])
  const view = tasks?.ok ? tasks.tasks : null
  const reviewKnown = !canManage || reviewCount !== undefined
  if (b02) {
    // Failed uploads on this device are added in the browser, on Home.
    const failed =
      !view ||
      !amenityTasks ||
      !reviewKnown ||
      workingList === undefined ||
      labels?.status === "failed" ||
      retakes === null
    const count = view
      ? todoBadge(
          nextActions({
            tasks: view,
            reviewCount: reviewCount ?? 0,
            amenityChecks: amenityTasks ?? [],
            slots: workingList?.slots ?? [],
            retakes: retakes ?? [],
            labels: labels?.status === "ok" ? labels.work : null,
          }),
          failed
        )
      : null
    return {
      canManage,
      todoUnknown: count === null,
      todoCount: count ?? undefined,
      reviewCount,
      avatarUrl: avatarUrl(profile.id, profile.avatarPath),
    }
  }
  const known =
    !!view && !!amenityTasks && reviewKnown && workingList !== undefined
  return {
    canManage,
    todoUnknown: !known,
    todoCount:
      view && amenityTasks && reviewKnown && workingList !== undefined
        ? todoCount(
            todoItems(
              view,
              new Date(),
              reviewCount,
              amenityTasks,
              workingList?.slots ?? []
            )
          )
        : undefined,
    reviewCount,
    avatarUrl: avatarUrl(profile.id, profile.avatarPath),
  }
}

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
