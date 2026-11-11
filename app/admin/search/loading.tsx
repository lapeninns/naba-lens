import { AppShell } from "@/components/nabalens"
import { PageHeader } from "@/components/nabalens/page-header"
import { SEARCH_COPY } from "@/components/nabalens/search/search-copy"
import {
  SearchFiltersSkeleton,
  SearchGridSkeleton,
} from "@/components/nabalens/search/search-skeleton"

export default function AdminSearchLoading() {
  return (
    <AppShell variant="admin" active="content">
      <div className="grid min-w-0 gap-6">
        <PageHeader
          venueScope
          scope={[SEARCH_COPY.allVenues, SEARCH_COPY.order]}
          title={SEARCH_COPY.title}
          summary={<p>{SEARCH_COPY.introAdmin}</p>}
          className="pb-0 md:pb-0"
        />
        <SearchFiltersSkeleton admin />
        <SearchGridSkeleton />
      </div>
    </AppShell>
  )
}
