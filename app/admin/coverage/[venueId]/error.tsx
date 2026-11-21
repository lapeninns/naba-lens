"use client"

import { AdminVenueErrorPage } from "../../_components/admin-boundary"

/** One venue's page that could not load: its tab, under Venues. */
export default function VenueCoverageError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return <AdminVenueErrorPage error={error} retry={retry} />
}
