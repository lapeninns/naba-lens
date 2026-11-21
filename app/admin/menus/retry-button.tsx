"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"

import { ADMIN_BOUNDARY_COPY } from "../_components/admin-copy"

/** "Retry" (redesign R5, decision 11) for a read that failed inside a Server Component page. */
export function RetryButton({ onRetry }: { onRetry?: () => void }) {
  const router = useRouter()
  return (
    <Button
      variant="primary"
      onClick={() => (onRetry ? onRetry() : router.refresh())}
    >
      <ArrowClockwiseIcon aria-hidden />
      {ADMIN_BOUNDARY_COPY.retry}
    </Button>
  )
}
