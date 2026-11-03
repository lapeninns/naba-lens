"use client"

import { ArrowClockwiseIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"

import { prepareMonthAction } from "@/app/_coverage/actions"
import { PrepareAction } from "@/components/nabalens/coverage/prepare-action"
import { Button } from "@/components/ui/button"

export function PrepareActionControl({
  venueId,
  retry,
}: {
  venueId: string
  retry?: boolean
}) {
  const router = useRouter()
  return (
    <PrepareAction
      retry={retry}
      onPrepare={() => prepareMonthAction({ venueId })}
      onStale={() => router.refresh()}
    />
  )
}

/** Repeats the overview's read after a load failure. */
export function RetryLoadButton() {
  const router = useRouter()
  return (
    <Button variant="secondary" size="sm" onClick={() => router.refresh()}>
      <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
      Try again
    </Button>
  )
}
