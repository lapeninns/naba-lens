import type { Metadata } from "next"
import Link from "next/link"

import { AppShell } from "@/components/nabalens/app-shell"
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
        <PageHeader
          scope={
            <Link
              href="/admin/venues"
              className="underline decoration-1 underline-offset-4 focus-ring outline-none"
            >
              Venues
            </Link>
          }
          title="Add a venue"
          summary={
            <p>
              Next you name its reviewers, copy what to collect and invite its
              staff.
            </p>
          }
          className="pb-0 md:pb-0"
        />
        <div className="rounded-card border border-line bg-surface p-4">
          <VenueDetailsForm />
        </div>
      </div>
    </AppShell>
  )
}
