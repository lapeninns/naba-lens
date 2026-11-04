"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"

import { ERROR_COPY } from "@/components/nabalens/error-state"
import { Button } from "@/components/ui/button"

/** "Try again" for a read that failed inside a Server Component page. */
export function RetryButton({ onRetry }: { onRetry?: () => void }) {
  const router = useRouter()
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => (onRetry ? onRetry() : router.refresh())}
    >
      <ArrowClockwiseIcon aria-hidden />
      {ERROR_COPY.tryAgain}
    </Button>
  )
}
