"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"

import { fetchMediaPage } from "@/app/_media/fetch-page"
import { MediaGallery } from "@/app/_media/media-gallery"
import {
  EmptyState,
  LibraryFilters,
  type LibraryFilterValue,
  type Option,
} from "@/components/nabalens"
import type { LibraryMenuOptions } from "@/components/nabalens/library-filters"
import type { MediaPage } from "@/lib/server/media/types"

import { loadLibraryPage } from "./library-actions"
import { filtersToSearch, type LibrarySearchParams } from "./library-search"

type AdminLibraryProps = {
  venues: Option[]
  staff: Option[]
  /** The selected venue's menu choices; null without a venue. */
  menuOptions: LibraryMenuOptions | null
  filters: Required<LibraryFilterValue>
  initialPage: MediaPage
}

const REFRESH_MS = 15_000

/** Admin library: URL-driven filters over a server-filtered, refreshed gallery. */
export function AdminLibrary({
  venues,
  staff,
  menuOptions,
  filters,
  initialPage,
}: AdminLibraryProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = React.useTransition()
  // Filters being navigated to: a second change made before the first
  // navigation returns must build on it, not on the stale server props.
  const [shown, setShown] = React.useOptimistic(filters)
  const search = filtersToSearch(filters)

  // Load more and the 15-second refresh use this page's filters exactly.
  const params = React.useMemo(
    () =>
      Object.fromEntries(new URLSearchParams(search)) as LibrarySearchParams,
    [search]
  )
  const loadPage = React.useCallback(
    (cursor: string | null) => loadLibraryPage(params, cursor),
    [params]
  )
  const refreshPage = React.useCallback(
    (signal: AbortSignal) => fetchMediaPage("/api/library", params, signal),
    [params]
  )

  const filtered = search !== ""

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Content</h1>
      </div>
      <LibraryFilters
        venues={venues}
        staff={staff}
        menuOptions={menuOptions}
        value={shown}
        onChange={(next) => {
          const qs = filtersToSearch(next)
          startTransition(() => {
            setShown(next)
            router.replace(qs ? `${pathname}?${qs}` : pathname, {
              scroll: false,
            })
          })
        }}
      />
      <div aria-busy={pending} className={pending ? "opacity-60" : undefined}>
        <MediaGallery
          // New filters mean a new server-rendered first page.
          key={search}
          label="Library"
          initialPage={initialPage}
          loadPage={loadPage}
          refreshPage={refreshPage}
          showAttribution
          canDelete
          refreshIntervalMs={REFRESH_MS}
          getDownloadHref={(item) => `/api/media/${item.id}/download`}
          getPortfolioHref={(item) => `/admin/staff/${item.contributorId}`}
          empty={
            filtered ? (
              <EmptyState
                title="Nothing matches these filters."
                description="Try a different search, fewer filters or a wider date range. Uploads without labels show under Labels: Needs labels."
              />
            ) : (
              <EmptyState title="No uploads yet. New staff uploads appear here automatically." />
            )
          }
        />
      </div>
    </div>
  )
}
