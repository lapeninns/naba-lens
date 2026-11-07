"use client"

import { useRouter } from "next/navigation"
import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { Button } from "@/components/ui/button"

/** A failed workspace read. The layout, and so the shell, stays in place. */
export default function ManagerError({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  const router = useRouter()
  const digest =
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string"
      ? error.digest
      : undefined
  return (
    <ErrorState
      title={ERROR_COPY.couldNotLoad(MANAGER_COPY.overview.couldNotLoad)}
      action={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            retry()
            router.refresh()
          }}
        >
          <ArrowClockwiseIcon aria-hidden />
          {ERROR_COPY.tryAgain}
        </Button>
      }
      detail={digest ? `Request ID ${digest}` : undefined}
    />
  )
}
