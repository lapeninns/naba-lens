"use client"

import { AppShell } from "@/components/nabalens"
import { PageHeader } from "@/components/nabalens/page-header"
import { SEARCH_COPY } from "@/components/nabalens/search/search-copy"
import { SearchError } from "@/components/nabalens/search/search-results"

export default function AdminSearchError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <AppShell variant="admin" active="content">
      <div className="grid min-w-0 gap-6">
        <PageHeader
          venueScope
          scope={[SEARCH_COPY.allVenues, SEARCH_COPY.order]}
          title={SEARCH_COPY.title}
          className="pb-0 md:pb-0"
        />
        <SearchError retry={() => retry()} digest={error.digest} />
      </div>
    </AppShell>
  )
}
