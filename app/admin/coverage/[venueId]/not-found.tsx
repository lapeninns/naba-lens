import { AppShell } from "@/components/nabalens/app-shell"
import { BackLink } from "@/components/nabalens/back-link"
import { EmptyState } from "@/components/nabalens/empty-state"
import { PageHeader } from "@/components/nabalens/page-header"
import { LinkButton } from "@/components/ui/link-button"

import { VENUE_COVERAGE_COPY } from "../coverage-copy"

/** An unknown venue lights Venues and goes back there (redesign R5). */
export default function VenueCoverageNotFound() {
  return (
    <AppShell variant="admin" active="venues">
      <div className="flex flex-col gap-6">
        <div className="grid min-w-0 gap-1">
          <BackLink href="/admin/venues" compact>
            Venues
          </BackLink>
          <PageHeader title="Venue" className="pb-0 md:pb-0" />
        </div>
        <EmptyState
          title={VENUE_COVERAGE_COPY.notFoundTitle}
          description={<p>{VENUE_COVERAGE_COPY.notFoundText}</p>}
          action={
            <LinkButton href="/admin/venues" variant="secondary">
              {VENUE_COVERAGE_COPY.backToVenues}
            </LinkButton>
          }
        />
      </div>
    </AppShell>
  )
}
