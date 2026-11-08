"use client"

import { AppShell } from "@/components/nabalens"
import { PageHeader } from "@/components/nabalens/page-header"

import { LIBRARY_COPY } from "./library-copy"
import { LibraryError } from "./library-states"

export default function AdminError({
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
        />
        <LibraryError retry={() => retry()} digest={error.digest} />
      </div>
    </AppShell>
  )
}
