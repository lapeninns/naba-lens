import "server-only"

import { cache } from "react"

import { todoCount, todoItems } from "@/components/nabalens/tasks"
import type { MyAmenityTask } from "@/lib/amenities/contract"
import { getMyAmenityTasks } from "@/lib/server/amenities"
import { getManagerReviewCount, getMyTasks } from "@/lib/server/coverage"
import { avatarUrl } from "@/lib/server/media/library"
import type { MediaActor } from "@/lib/server/media/types"

import { canManageVenue } from "../can-manage"

/** My coverage tasks, read once per request however many parts need them. */
export const myTasks = cache(async (actor: MediaActor) => getMyTasks(actor))

/** Amenity checks assigned to me; a failed read lists none, on Home too. */
export const myAmenityTasks = cache(
  async (actor: MediaActor): Promise<MyAmenityTask[]> => {
    try {
      const result = await getMyAmenityTasks(actor, {})
      return result.ok ? result.tasks : []
    } catch {
      return []
    }
  }
)

/**
 * Whether the caller manages their venue and, only then, the photos waiting
 * for their review. Runs alongside the tasks rather than after them.
 */
const managerStatus = cache(
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

/** The staff AppShell's props that come from the database. */
export type StaffShellStatus = {
  canManage: boolean
  /** Home's To do count; none when the tasks can't be read. */
  todoCount: number | undefined
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
  const [tasks, amenityTasks, { canManage, reviewCount }] = await Promise.all([
    myTasks(actor).catch(() => null),
    myAmenityTasks(actor),
    managerStatus(actor),
  ])
  const view = tasks?.ok ? tasks.tasks : null
  return {
    canManage,
    todoCount: view
      ? todoCount(todoItems(view, new Date(), reviewCount, amenityTasks))
      : undefined,
    reviewCount,
    avatarUrl: avatarUrl(profile.id, profile.avatarPath),
  }
}
