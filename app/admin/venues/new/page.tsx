import type { Metadata } from "next"

import { AppShell } from "@/components/nabalens/app-shell"
import { BackLink } from "@/components/nabalens/back-link"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireActiveAdmin } from "@/lib/auth"
import { SETUP_TITLES, type SetupKey } from "@/lib/admin/venues"

import { VenueDetailsForm } from "../venue-forms"

export const metadata: Metadata = { title: "Add a venue" }

/** The setup checklist's order, as the venue page lists it. */
const SETUP_ORDER: SetupKey[] = [
  "inventory",
  "reviewers",
  "staff",
  "spaces",
  "collection",
]

/**
 * Add a venue (spec §8 A2): name, location and timezone. The venue page that
 * follows has the reviewers, setup checklist, templates and scope. Second
 * handoff: the form card left, the setup checklist's five titles beside it so
 * the admin knows the venue is not finished when it is added.
 */
export default async function AdminNewVenuePage() {
  const profile = await requireActiveAdmin()
  return (
    <AppShell variant="admin" active="venues" userName={profile.displayName}>
      <div className="flex flex-col gap-6">
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
        <div className="grid min-w-0 items-start gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0 rounded-card border border-line bg-surface p-4">
            <VenueDetailsForm />
          </div>
          <section
            aria-labelledby="after-you-add-it"
            className="grid min-w-0 gap-3"
          >
            <h2
              id="after-you-add-it"
              className="px-1 type-section-title text-ink"
            >
              After you add it
            </h2>
            <ol
              data-testid="venue-new-steps"
              className="grid gap-2 rounded-card border border-line bg-surface p-4"
            >
              {SETUP_ORDER.map((key, i) => (
                <li key={key} className="flex items-baseline gap-3 text-body">
                  <span
                    aria-hidden
                    className="font-mono text-meta text-ink-muted tabular-nums"
                  >
                    {i + 1}
                  </span>
                  <span className="text-ink">{SETUP_TITLES[key]}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </AppShell>
  )
}
