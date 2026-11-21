"use client"

import { useRouter } from "next/navigation"
import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"

/** Re-renders the page on the server: "Retry" (decision 11) or "Reload". */
export function RetryButton({ label }: { label: "Retry" | "Reload" }) {
  const router = useRouter()
  return (
    <Button variant="secondary" size="sm" onClick={() => router.refresh()}>
      <ArrowClockwiseIcon aria-hidden />
      {label}
    </Button>
  )
}
