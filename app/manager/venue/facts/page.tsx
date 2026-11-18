import Link from "next/link"

import {
  reconfirmFactAction,
  reconfirmSpaceAction,
} from "@/app/_knowledge/actions"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import { StillRightList } from "@/components/nabalens/manager/venue/still-right-list"
import { PageHeader } from "@/components/nabalens/page-header"
import { amenityHrefs } from "@/lib/amenities/contract"
import { getManagerWorkspace } from "@/lib/auth/manager"
import { factsToConfirm, spacesToConfirm } from "@/lib/manager/to-confirm"
import {
  getFactStates,
  listSpacePhotoFreshness,
} from "@/lib/server/knowledge/facts"
import { getMediaActor } from "@/lib/server/media/context"

export const metadata = { title: "To confirm" }

const settle = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null)

/**
 * Venue › To confirm (spec §7 M5, §9.3; S2-MGR): facts reading Unconfirmed
 * or Check due, and space photos due a check, each with "Still right". A fact
 * with no answer yet links to its question instead.
 */
export default async function ManagerVenueFactsPage() {
  const workspace = await getManagerWorkspace()
  if (workspace.status !== "available")
    return <VenueAccessUnavailable reason={workspace.reason} refreshShell />
  const auth = await getMediaActor("manager")
  if (!auth.ok) {
    if (auth.status === 403)
      return <VenueAccessUnavailable reason="no_grant" refreshShell />
    throw new Error(auth.message)
  }
  const venueId = workspace.venue.id
  const [states, spaces] = await Promise.all([
    settle(getFactStates(auth.actor, { venueId })),
    settle(listSpacePhotoFreshness(auth.actor, { venueId })),
  ])
  const copy = MANAGER_COPY.venueFacts
  const facts = states?.ok
    ? factsToConfirm(states.items, amenityHrefs(managerHrefs.overview).check)
    : null
  const places = spaces?.ok
    ? spacesToConfirm(
        spaces.photos,
        `${managerHrefs.overview}/amenities/places`
      )
    : null

  return (
    <div className="grid gap-8">
      <PageHeader
        scope={[
          workspace.venue.name,
          <Link
            key="venue"
            href={managerHrefs.venue}
            className="rounded-control underline underline-offset-4 focus-ring"
          >
            {MANAGER_COPY.venue.title}
          </Link>,
        ]}
        venueScope
        title={copy.title}
        summary={copy.summary}
        className="pb-0 md:pb-0"
      />
      <section aria-labelledby="confirm-facts" className="grid gap-3">
        <h2 id="confirm-facts" className="type-section-title text-ink">
          {copy.factsTitle}
        </h2>
        {facts === null ? (
          <p role="status" className="text-body text-ink-muted">
            {copy.factsFailed}
          </p>
        ) : (
          <StillRightList
            label={copy.factsTitle}
            empty={copy.factsEmpty}
            items={facts}
            onConfirm={reconfirmFactAction}
          />
        )}
      </section>
      <section aria-labelledby="confirm-spaces" className="grid gap-3">
        <h2 id="confirm-spaces" className="type-section-title text-ink">
          {copy.spacesTitle}
        </h2>
        {places === null ? (
          <p role="status" className="text-body text-ink-muted">
            {copy.spacesFailed}
          </p>
        ) : (
          <StillRightList
            label={copy.spacesTitle}
            empty={copy.spacesEmpty}
            items={places}
            onConfirm={reconfirmSpaceAction}
          />
        )}
      </section>
    </div>
  )
}
