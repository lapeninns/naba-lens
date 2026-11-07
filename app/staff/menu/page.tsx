import type { Metadata } from "next"

import { loadOurMenuItemsAction } from "@/app/_coverage/actions"
import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import {
  OUR_MENU_QUERY_MAX,
  OurMenuScreen,
  type OurMenuFilter,
  type OurMenuLoad,
} from "@/components/nabalens/menu-photos"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import {
  getCoverageActor,
  getOurMenu,
  listOurMenuItems,
} from "@/lib/server/coverage"
import type { CoverageFailure } from "@/lib/server/coverage/types"
import { isUuid } from "@/lib/server/coverage/validate"
import type { MediaActor } from "@/lib/server/media/types"

import { canManageVenue } from "../can-manage"

export const metadata: Metadata = { title: "Our menu · Naba-Lens" }

type OurMenuSearch = Record<string, string | string[] | undefined>

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined

/** `?section=<id>&filter=gaps&q=…`; anything else is ignored. */
function ourMenuFilter(search: OurMenuSearch): OurMenuFilter {
  const section = one(search.section)
  return {
    sectionId: section && isUuid(section) ? section : null,
    gapsOnly: one(search.filter) === "gaps",
    query: (one(search.q) ?? "").trim().slice(0, OUR_MENU_QUERY_MAX),
  }
}

/** Refusals and setup gaps are states of the page; anything else is a failed load. */
function failedLoad(failure: CoverageFailure): OurMenuLoad {
  if (failure.code === "needs_setup") return { state: "needs_venue" }
  return { state: "unavailable" }
}

async function loadOurMenu(
  actor: MediaActor,
  filter: OurMenuFilter
): Promise<{ load: OurMenuLoad; filter: OurMenuFilter }> {
  const summary = await getOurMenu(actor, {})
  if (!summary.ok) return { load: failedLoad(summary), filter }
  const menu = summary.menu
  if (menu.menuState !== "ready")
    return { load: { state: menu.menuState, menu }, filter }
  // A section from another menu version (an old link) shows every section.
  const sectionId = menu.sections.some((s) => s.sectionId === filter.sectionId)
    ? filter.sectionId
    : null
  const shown = { ...filter, sectionId }
  const items = await listOurMenuItems(actor, {
    ...(sectionId ? { sectionId } : {}),
    gapsOnly: shown.gapsOnly,
    ...(shown.query ? { query: shown.query } : {}),
  })
  if (!items.ok) return { load: failedLoad(items), filter: shown }
  return { load: { state: "ready", menu, items }, filter: shown }
}

/**
 * Our menu for staff (managers included): the current venue's active menu,
 * grouped by section, with how many items have an accepted photo, search and
 * "Still needs a photo". A failed read renders the page's unavailable state
 * rather than the error boundary, so the shell and Add stay usable.
 */
export default async function OurMenuPage({
  searchParams,
}: {
  searchParams: Promise<OurMenuSearch>
}) {
  const profile = await requireActiveStaff()
  const auth = await getCoverageActor()
  if (!auth.ok) throw new Error(auth.message)
  const requested = ourMenuFilter(await searchParams)
  const [{ load, filter }, canManage] = await Promise.all([
    loadOurMenu(auth.actor, requested),
    canManageVenue(auth.actor),
  ])

  return (
    <AppShell
      variant="staff"
      active="menu"
      canManage={canManage}
      userName={profile.displayName}
      logoutAction={logout}
    >
      <div className="flex flex-col gap-4">
        <OfflineNotice />
        <OurMenuScreen
          load={load}
          filter={filter}
          canAdd={uploadBlockReason(profile) === null}
          loadItems={loadOurMenuItemsAction}
        />
      </div>
    </AppShell>
  )
}
