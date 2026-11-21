"use client"

import { PageHeader } from "@/components/nabalens/page-header"
import { AppShell } from "@/components/nabalens"

import { AdminTabs } from "../_components/admin-tabs"
import { LIBRARY_COPY } from "../library-copy"
import { LibraryError } from "../library-states"

/** Library › Photos (/admin) that could not load. */
export default function AdminLibraryPhotosError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <AppShell variant="admin" active="content">
      <div className="flex flex-col gap-6">
        <PageHeader
          venueScope
          scope={[LIBRARY_COPY.allVenues, LIBRARY_COPY.order]}
          title={LIBRARY_COPY.title}
          summary={<p>{LIBRARY_COPY.summary}</p>}
          className="pb-0 md:pb-0"
        >
          <AdminTabs set="library" active="photos" />
        </PageHeader>
        <LibraryError retry={() => retry()} digest={error.digest} />
      </div>
    </AppShell>
  )
}
