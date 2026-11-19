"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { AppShell } from "@/components/nabalens/app-shell"
import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { PageHeader } from "@/components/nabalens/page-header"
import { Button } from "@/components/ui/button"

export default function AdminActivityError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <AppShell variant="admin" active="settings">
      <div className="flex flex-col gap-6">
        <PageHeader title="Activity" className="pb-0 md:pb-0" />
        <ErrorState
          title="Activity couldn't be loaded"
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
