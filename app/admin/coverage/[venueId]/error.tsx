"use client"

import Link from "next/link"
import { ArrowClockwiseIcon, ArrowLeftIcon } from "@phosphor-icons/react"

import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { Button, buttonVariants } from "@/components/ui/button"

import { VENUE_COVERAGE_COPY } from "../coverage-copy"

export default function VenueCoverageError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <AppShell variant="admin" active="coverage" logoutAction={logout}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={VENUE_COVERAGE_COPY.title}
          className="pb-0 md:pb-0"
        />
        <OfflineNotice />
        <ErrorState
          title={VENUE_COVERAGE_COPY.couldNotLoad}
          action={
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="primary" onClick={() => retry()}>
                <ArrowClockwiseIcon aria-hidden />
                {ERROR_COPY.tryAgain}
              </Button>
              <Link
                href="/admin/coverage"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                <ArrowLeftIcon data-icon="inline-start" aria-hidden />
                {VENUE_COVERAGE_COPY.backToVenues}
              </Link>
            </div>
          }
          detail={error.digest ? `Request ID ${error.digest}` : undefined}
        />
      </div>
    </AppShell>
  )
}
