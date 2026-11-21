"use client"

import { AdminErrorPage } from "../_components/admin-boundary"

/** The phone and tablet More page that could not load (redesign R5). */
export default function AdminMoreError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <AdminErrorPage
      section="more"
      title="All sections"
      what="All sections couldn't be loaded"
      error={error}
      retry={retry}
    />
  )
}
