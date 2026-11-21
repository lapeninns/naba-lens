import type { Metadata } from "next"

import { AppShell } from "@/components/nabalens/app-shell"
import { BackLink } from "@/components/nabalens/back-link"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireActiveAdmin } from "@/lib/auth"

import { VenueDetailsForm } from "../venue-forms"

export const metadata: Metadata = { title: "Add a venue" }

/**
 * Add a venue (spec §8 A2): name, location and timezone. The venue page that
 * follows has the reviewers, setup checklist, templates and scope.
 */
export default async function AdminNewVenuePage() {
  const profile = await requireActiveAdmin()
  return (
    <AppShell variant="admin" active="venues" userName={profile.displayName}>
      <div className="flex max-w-reading flex-col gap-6">
        {/* Venues, detail page (redesign R5, ia.md). */}
        <div className="grid min-w-0 gap-1">
          <BackLink href="/admin/venues" compact>
            Venues
          </BackLink>
          <PageHeader
            title="Add a venue"
            summary={
              <p>
                Next you name its reviewers, copy what to collect and invite its
                staff.
              </p>
            }
            className="pb-0 md:pb-0"
          />
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <VenueDetailsForm />
        </div>
      </div>
    </AppShell>
  )
}
