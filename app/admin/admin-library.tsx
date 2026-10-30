"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"

import { MediaGallery } from "@/app/_media/media-gallery"
import {
  EmptyState,
  LibraryFilters,
  type LibraryFilterValue,
  type Option,
} from "@/components/nabalens"
import type { MediaPage } from "@/lib/server/media/types"

import { loadLibraryPage } from "./library-actions"
import { filtersToSearch } from "./library-search"

type AdminLibraryProps = {
  venues: Option[]
  staff: Option[]
  filters: LibraryFilterValue
  initialPage: MediaPage
}

const REFRESH_MS = 15_000

/** Admin library: URL-driven filters over a server-filtered, refreshed gallery. */
export function AdminLibrary({
  venues,
  staff,
  filters,
  initialPage,
}: AdminLibraryProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = React.useTransition()
  const search = filtersToSearch(filters)

  const loadPage = React.useCallback(
    (cursor: string | null) =>
      loadLibraryPage(
        {
          venue: filters.venueId,
          staff: filters.staffId,
          type: filters.type === "all" ? null : filters.type,
        },
        cursor
      ),
    [filters.venueId, filters.staffId, filters.type]
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
        value={filters}
        onChange={(next) => {
          const qs = filtersToSearch(next)
          startTransition(() => {
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
          showAttribution
          canDelete
          refreshIntervalMs={REFRESH_MS}
          getDownloadHref={(item) => `/api/media/${item.id}/download`}
          getPortfolioHref={(item) => `/admin/staff/${item.contributorId}`}
          empty={
            <EmptyState
              title={
                filtered
                  ? "Nothing matches these filters."
                  : "No uploads yet. New staff uploads appear here automatically."
              }
            />
          }
        />
      </div>
    </div>
  )
}
