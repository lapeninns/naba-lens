"use client"

import { useRouter } from "next/navigation"
import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"

/** Re-renders the page on the server: "Try again" or "Reload" in a notice. */
export function RetryButton({ label }: { label: "Try again" | "Reload" }) {
  const router = useRouter()
  return (
    <Button variant="secondary" size="sm" onClick={() => router.refresh()}>
      <ArrowClockwiseIcon aria-hidden />
      {label}
    </Button>
  )
}
