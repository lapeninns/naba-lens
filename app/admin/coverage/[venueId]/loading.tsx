"use client"

import { AdminVenueLoadingPage } from "../../_components/admin-boundary"
import { VENUE_COVERAGE_COPY } from "../coverage-copy"

export default function VenueCoverageLoading() {
  return <AdminVenueLoadingPage label={VENUE_COVERAGE_COPY.loading} />
}
