"use client"

import * as React from "react"
import { FolderSimpleIcon } from "@phosphor-icons/react"
import { usePathname, useRouter } from "next/navigation"

import { fetchMediaPage } from "@/app/_media/fetch-page"
import { MediaGallery } from "@/app/_media/media-gallery"
import {
  EMPTY_LIBRARY_FILTERS,
  EmptyState,
  LibraryFilters,
  type LibraryFilterValue,
  type Option,
} from "@/components/nabalens"
import {
  describeLibraryFilters,
  FilterPhrases,
  widenFiltersHint,
  type LibraryMenuOptions,
} from "@/components/nabalens/library-filters"
import { PageHeader } from "@/components/nabalens/page-header"
import { Button } from "@/components/ui/button"
import { CONTENT_TYPES, CONTENT_TYPE_LABELS } from "@/lib/menus/types"

import { loadLibraryPage, type LibraryPageResult } from "./library-actions"
import { filtersToSearch, type LibrarySearchParams } from "./library-search"
import { LIBRARY_COPY } from "./library-copy"
import { LibraryErrorBoundary, LibraryGridSkeleton } from "./library-states"

type AdminLibraryProps = {
  venues: Option[]
  staff: Option[]
  /** The selected venue's menu choices; null without a venue. */
  menuOptions: LibraryMenuOptions | null
  filters: Required<LibraryFilterValue>
  /** The first page, streamed after the header and filters. */
  initialPage: Promise<LibraryPageResult>
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

  function navigate(next: Required<LibraryFilterValue>) {
    const qs = filtersToSearch(next)
    startTransition(() => {
      setShown(next)
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    })
  }

  const venueName = filters.venueId
    ? venues.find((v) => v.id === filters.venueId)?.name
    : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        venueScope
        scope={[venueName ?? LIBRARY_COPY.allVenues, LIBRARY_COPY.order]}
        title={LIBRARY_COPY.title}
        summary={<p>{LIBRARY_COPY.summary}</p>}
        className="pb-0 md:pb-0"
      />
      <LibraryFilters
        venues={venues}
        staff={staff}
        menuOptions={menuOptions}
        value={shown}
        onChange={navigate}
      />
      <LibraryFolders
        filters={shown}
        menuOptions={menuOptions}
        onChange={navigate}
      />
      <div aria-busy={pending} className={pending ? "opacity-60" : undefined}>
        <LibraryErrorBoundary>
          <React.Suspense fallback={<LibraryGridSkeleton />}>
            <LibraryResults
              // New filters mean a new server-rendered first page.
              key={search}
              search={search}
              initialPage={initialPage}
              empty={
                search !== "" ? (
                  <EmptyState
                    variant="filtered"
                    title="Nothing matches these filters."
                    description={
                      <p>
                        Showing{" "}
                        <FilterPhrases
                          plain
                          phrases={describeLibraryFilters(filters, {
                            venues,
                            staff,
                            menuOptions,
                          })}
                        />
                        . {widenFiltersHint(filters)}
                      </p>
                    }
                    action={
                      <Button
                        type="button"
                        variant="secondary"
                        size="touch"
                        onClick={() => navigate(EMPTY_LIBRARY_FILTERS)}
                      >
                        Clear filters
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState title="No uploads yet. New staff uploads appear here automatically." />
                )
              }
            />
          </React.Suspense>
        </LibraryErrorBoundary>
      </div>
    </div>
  )
}

function LibraryFolders({
  filters,
  menuOptions,
  onChange,
}: {
  filters: Required<LibraryFilterValue>
  menuOptions: LibraryMenuOptions | null
  onChange: (filters: Required<LibraryFilterValue>) => void
}) {
  const heading = React.useId()
  const categories =
    menuOptions?.venueId === filters.venueId ? menuOptions.categories : []
  const folders = [
    { id: "all", name: "All files", filters: {} },
    {
      id: "unlabelled",
      name: "Needs labels",
      filters: { labelState: "unlabelled" as const },
    },
    ...CONTENT_TYPES.map((contentType) => ({
      id: contentType,
      name: CONTENT_TYPE_LABELS[contentType],
      filters: { contentType },
    })),
    ...categories.map(({ slug, name }) => ({
      id: `section:${slug}`,
      name,
      filters: { category: slug },
    })),
  ]
  const base = {
    ...filters,
    category: null,
    itemId: null,
    variantId: null,
    contentType: null,
    labelState: null,
  }
  const current = filtersToSearch(filters)

  return (
    <section aria-labelledby={heading} className="grid gap-3">
      <div>
        <h2 id={heading} className="font-display text-section-title text-ink">
          Browse folders
        </h2>
        <p className="text-body text-ink-muted">
          Folders show files that match their labels. A file can appear in
          several folders, and each card names its dishes. Choose a venue above
          to browse its menu sections.
        </p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {folders.map((folder) => {
          const next = { ...base, ...folder.filters }
          const active = current === filtersToSearch(next)
          return (
            <li key={folder.id} className="max-w-full min-w-0">
              <Button
                type="button"
                size="touch"
                variant={active ? "secondary" : "outline"}
                aria-pressed={active}
                className="h-auto min-h-11 max-w-full text-left whitespace-normal"
                onClick={() => onChange(next)}
              >
                <FolderSimpleIcon
                  weight={active ? "fill" : "regular"}
                  aria-hidden
                />
                {folder.name}
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function LibraryResults({
  search,
  initialPage,
  empty,
}: {
  search: string
  initialPage: Promise<LibraryPageResult>
  empty: React.ReactNode
}) {
  const result = React.use(initialPage)

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
    (signal: AbortSignal, cursor?: string | null) =>
      fetchMediaPage("/api/library", { ...params, cursor }, signal),
    [params]
  )

  if (!result.ok) throw new Error(result.message)
  return (
    <MediaGallery
      label="Library"
      canLabel
      initialPage={result.page}
      loadPage={loadPage}
      refreshPage={refreshPage}
      showAttribution
      showLabelBadge
      showFileName
      canDelete
      refreshIntervalMs={REFRESH_MS}
      getDownloadHref={(item) => `/api/media/${item.id}/download`}
      getPortfolioHref={(item) => `/admin/staff/${item.contributorId}`}
      empty={empty}
    />
  )
}
