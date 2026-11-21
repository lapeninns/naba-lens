"use client"

import { VenueFactsError } from "./venue-facts-boundary"

export default function AdminVenueFactsError(props: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return <VenueFactsError {...props} />
}
