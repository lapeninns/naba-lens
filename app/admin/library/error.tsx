"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { AppShell } from "@/components/nabalens/app-shell"
import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { PageHeader } from "@/components/nabalens/page-header"
import { Button } from "@/components/ui/button"

/** Library sub-pages (S2-LIBRARY) that could not load. */
export default function AdminLibraryError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <AppShell variant="admin" active="content">
      <div className="flex flex-col gap-6">
        <PageHeader scope="Library" title="Library" className="pb-0 md:pb-0" />
        <ErrorState
          title="This part of the library couldn't be loaded"
          action={
            <Button type="button" variant="primary" onClick={() => retry()}>
              <ArrowClockwiseIcon aria-hidden />
              {ERROR_COPY.tryAgain}
            </Button>
          }
          detail={error.digest ? `Request ID ${error.digest}` : undefined}
        />
      </div>
    </AppShell>
  )
}
