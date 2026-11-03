"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { PageHeader } from "@/components/nabalens/page-header"
import { Button } from "@/components/ui/button"

import { COVERAGE_COPY } from "./coverage-copy"

export default function CoverageError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <AppShell variant="admin" active="coverage" logoutAction={logout}>
      <div className="flex flex-col gap-6">
        {/* Also the boundary for /admin/coverage/[venueId] and /managers. */}
        <PageHeader
          title={COVERAGE_COPY.title}
          className="pb-0 md:pb-0"
        />
        <ErrorState
          title={COVERAGE_COPY.couldNotLoad}
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => retry()}
            >
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
