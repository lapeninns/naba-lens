import "server-only"

import type { MediaActor } from "@/lib/server/media/types"

import { readAccess, staffOnly } from "./context"
import { NOT_FOUND, unavailableFailure } from "./errors"
import type { CoverageResult, RequirementKind } from "./types"
import { isObject, isUuid } from "./validate"

export type RequirementRoute = {
  kind: RequirementKind
  /** The menu version's section, for `menu_section` requirements only. */
  menuSectionId: string | null
}

/**
 * Where a requirement's page goes (G-4, docs/plans/goals-not-tasks.md): only
 * the kind and the menu section are read, so a menu-section link can be sent
 * to Our menu before the task page's full read. Row-level security limits the
 * row to the caller's venue and their own photos' requirements; the task page
 * still re-checks the venue when it is served.
 */
export async function getMyRequirementRoute(
  actor: MediaActor,
  input: unknown
): Promise<CoverageResult<{ route: RequirementRoute }>> {
  if (!isObject(input) || !isUuid(input.requirementId)) return NOT_FOUND
  const read = await readAccess(actor)
  if (!read.ok) return read
  const denied = staffOnly(read.access)
  if (denied) return denied
  const { data, error } = await actor.db
    .from("coverage_requirements")
    .select("kind, menu_section_id")
    .eq("id", input.requirementId)
    .maybeSingle()
  if (error) return unavailableFailure("read requirement", error)
  if (!data) return NOT_FOUND
  return {
    ok: true,
    route: {
      kind: data.kind as RequirementKind,
      menuSectionId: data.menu_section_id,
    },
  }
}

/**
 * Album's Menu at the section's Needed dishes (or every section). Album
 * opens the section's shelf at that section (DESIGN.md §5d, D16).
 */
export function menuSectionHref(menuSectionId: string | null): string {
  return menuSectionId
    ? `/staff/album/menu?section=${encodeURIComponent(menuSectionId)}&show=needed`
    : "/staff/album/menu?show=needed"
}
