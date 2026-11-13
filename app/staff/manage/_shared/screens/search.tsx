import type { SupabaseClient } from "@supabase/supabase-js"

import {
  canonicalFilters,
  searchToFilters,
  toServiceFilters,
  type SearchFilterValue,
  type SearchMode,
} from "@/app/_media/search-params"
import { AppShell } from "@/components/nabalens/app-shell"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { SEARCH_COPY } from "@/components/nabalens/search/search-copy"
import { SearchView } from "@/components/nabalens/search/search-view"
import type {
  SearchMenuOptions,
  SearchOption,
  SearchPageResult,
} from "@/components/nabalens/search/types"
import { redactError } from "@/lib/server/log/redact"
import { getLabellingCatalogue } from "@/lib/server/labels"
import { isUuid } from "@/lib/server/coverage/validate"
import { libraryVenueOptions } from "@/lib/server/media/library"
import { libraryLabelFilterOptions } from "@/lib/server/media/library-labels"
import { searchAssets } from "@/lib/server/media/search"
import type { MediaActor } from "@/lib/server/media/types"

import type { ManageContext } from "../context"
import { ManageFrame } from "../frame"

type Search = Record<string, string | string[] | undefined>

export type SearchScreenProps =
  | {
      /** /admin/search: every venue, the admin shell. */
      mode: "admin"
      actor: MediaActor
      viewerName: string
      search: Search
    }
  | {
      /** /manager/search (workspace) or /staff/manage/search (manager). */
      mode: "workspace" | "manager"
      ctx: ManageContext
      search: Search
    }

/** One venue's menu choices: labelled items for admins, the active menu otherwise. */
async function menuOptionsFor(
  actor: MediaActor,
  venueId: string | null
): Promise<SearchMenuOptions | null> {
  if (!venueId) return null
  if (actor.profile.role === "admin") {
    const options = await libraryLabelFilterOptions(actor, venueId)
    return { venueId, items: options.items }
  }
  try {
    const found = await getLabellingCatalogue(actor, venueId)
    if (!found.ok || found.catalogue.status !== "active")
      return { venueId, items: [] }
    return {
      venueId,
      items: found.catalogue.sections.flatMap((section) =>
        section.items.map((item) => ({
          id: item.itemId,
          name: item.name,
          sectionName: section.name,
          variants: item.variants.map((v) => ({
            id: v.variantId,
            name: v.name,
          })),
        }))
      ),
    }
  } catch (error) {
    console.error("[asset-search] menu options unavailable", {
      error: redactError(error),
    })
    return { venueId, items: [] }
  }
}

type DestinationRow = { key: string; label: string }

/**
 * Registered places of use (active, organisation-wide or this venue), for the
 * "Where it's used" filter. The registry is readable by the service role only
 * and holds labels, never asset data; read after the page's own access check.
 * Empty (the control hides) when there are none or the read fails.
 *
 * Parameterised reads, never a filter string: an admin's venue comes from the
 * URL, and is only asked about when it is a venue id at all. An admin
 * searching every venue (`allVenues`) sees every active place, as before.
 */
async function destinationOptions(
  actor: MediaActor,
  venueId: string | null,
  allVenues: boolean
): Promise<SearchOption[]> {
  try {
    // media_use_destinations predates the generated types (B05-m1).
    const db = actor.service as unknown as SupabaseClient
    const active = () =>
      db.from("media_use_destinations").select("key, label").eq("active", true)
    const reads =
      allVenues && !venueId ? [active()] : [active().is("venue_id", null)]
    if (venueId && isUuid(venueId)) reads.push(active().eq("venue_id", venueId))
    const answers = await Promise.all(reads)
    const rows: DestinationRow[] = []
    for (const { data, error } of answers) {
      if (error) throw error
      rows.push(...((data ?? []) as DestinationRow[]))
    }
    return rows
      .sort((a, b) => a.label.localeCompare(b.label, "en-GB"))
      .map((d) => ({ id: d.key, name: d.label }))
  } catch (error) {
    console.error("[asset-search] destinations unavailable", {
      error: redactError(error),
    })
    return []
  }
}

/**
 * Page one, never thrown: a failure is a value the list shows in its place.
 * `filters` are the canonical ones, as Show more asks with.
 */
function firstPage(
  actor: MediaActor,
  filters: SearchFilterValue
): Promise<SearchPageResult> {
  return searchAssets(actor, { filters: toServiceFilters(filters) }).then(
    (result): SearchPageResult =>
      result.ok
        ? {
            ok: true,
            page: { items: result.items, nextCursor: result.nextCursor },
          }
        : {
            ok: false,
            status: result.status,
            code: result.code,
            message: result.message,
            ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
          }
  )
}

/**
 * B05-06 asset search (contracts/b05-search-screen-scope.md): find photos and
 * videos by menu item, use, menu decision and upload day. One screen for an
 * admin (every venue), a manager account and a legacy grant holder (their
 * venue; the database decides, and refuses staff). Read-only cards: no
 * viewer, preview, download or reuse.
 */
export async function SearchScreen(props: SearchScreenProps) {
  const filters = searchToFilters(props.search)
  // The search itself uses the canonical filters (the same ones the list key
  // and Show more use), so page one never differs from the pages after it.
  const searched = canonicalFilters(filters)
  const admin = props.mode === "admin"
  const actor = admin ? props.actor : props.ctx.actor
  const venueId = admin ? filters.venue : props.ctx.venueId
  const codecMode: SearchMode = admin ? "admin" : "manager"
  // Not awaited: the header and filters render while the list streams in.
  const page = firstPage(actor, searched)
  const [venues, menuOptions, destinations] = await Promise.all([
    // Venues only: the library's options also page every staff profile.
    admin ? libraryVenueOptions(actor) : Promise.resolve([] as SearchOption[]),
    menuOptionsFor(actor, venueId),
    destinationOptions(actor, venueId, admin),
  ])
  const now = new Date().toISOString()
  const view = (
    <SearchView
      mode={codecMode}
      venueName={admin ? null : props.ctx.venue.name}
      venues={venues}
      menuOptions={menuOptions}
      destinations={destinations}
      filters={filters}
      initialPage={page}
      now={now}
    />
  )

  if (props.mode === "admin") {
    const venueName = filters.venue
      ? venues.find((v) => v.id === filters.venue)?.name
      : null
    return (
      <AppShell variant="admin" active="content" userName={props.viewerName}>
        <div className="grid min-w-0 gap-6">
          <PageHeader
            venueScope
            scope={[venueName ?? SEARCH_COPY.allVenues, SEARCH_COPY.order]}
            title={SEARCH_COPY.title}
            summary={<p>{SEARCH_COPY.introAdmin}</p>}
            className="pb-0 md:pb-0"
          />
          {view}
        </div>
      </AppShell>
    )
  }

  const { ctx } = props
  if (props.mode === "workspace") {
    return (
      <div className="grid min-w-0 gap-(--gutter) md:gap-4">
        <OfflineNotice className={OFFLINE_BANNER_CLASS} loadedAt={now} />
        <PageHeader
          venueScope
          scope={[ctx.venue.name, SEARCH_COPY.order]}
          title={SEARCH_COPY.title}
          summary={<p>{SEARCH_COPY.introManager(ctx.venue.name)}</p>}
          className="pb-0 md:pb-0"
        />
        {view}
      </div>
    )
  }

  return (
    <ManageFrame
      ctx={ctx}
      section="search"
      title={SEARCH_COPY.title}
      summary={<p>{SEARCH_COPY.introManager(ctx.venue.name)}</p>}
    >
      <OfflineNotice loadedAt={now} />
      {view}
    </ManageFrame>
  )
}
