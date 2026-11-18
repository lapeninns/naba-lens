import Link from "next/link"
import {
  CalendarCheckIcon,
  ClockCounterClockwiseIcon,
  ExportIcon,
  ForkKnifeIcon,
  ListChecksIcon,
  MapPinIcon,
  SealCheckIcon,
  StarIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react/dist/ssr"

import { HomeRow } from "@/components/nabalens/album/home-rows"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import { MenuMonthCheckControl } from "@/components/nabalens/manager/venue/menu-month-check"
import { ReviewersForm } from "@/components/nabalens/manager/venue/reviewers-form"
import { VenueHistoryList } from "@/components/nabalens/manager/venue/venue-history-list"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { amenityHrefs } from "@/lib/amenities/contract"
import { getManagerWorkspace } from "@/lib/auth/manager"
import { coverageWords } from "@/lib/knowledge/facts"
import { factsToConfirm, spacesToConfirm } from "@/lib/manager/to-confirm"
import {
  getFactCoverage,
  getFactStates,
  listSpacePhotoFreshness,
} from "@/lib/server/knowledge/facts"
import {
  getManagerVenueSummary,
  getVenueHistory,
  getVenueReviewers,
} from "@/lib/server/manager/venue"
import { getMediaActor } from "@/lib/server/media/context"
import { listSpecials, listVenueMenuVersions } from "@/lib/server/menus/local"

export const metadata = { title: "Venue" }

const settle = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null)

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(iso))
    : "later"

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="grid scroll-mt-24 gap-3"
    >
      <h2 id={`${id}-title`} className="type-section-title text-ink">
        {title}
      </h2>
      {children}
    </section>
  )
}

/**
 * The Venue hub (spec §7 M5; S2-MGR): Current menus with the monthly check,
 * Local specials, Spaces, Facilities and policies, Team, Review assignments
 * and History. Each section links the screen that does the work; reads fail
 * one at a time and say so in their own section.
 */
export default async function ManagerVenuePage() {
  const workspace = await getManagerWorkspace()
  if (workspace.status !== "available")
    return <VenueAccessUnavailable reason={workspace.reason} refreshShell />
  const auth = await getMediaActor("manager")
  if (!auth.ok) {
    if (auth.status === 403)
      return <VenueAccessUnavailable reason="no_grant" refreshShell />
    throw new Error(auth.message)
  }
  const actor = auth.actor
  const venueId = workspace.venue.id
  const copy = MANAGER_COPY.venue

  const [
    versions,
    summary,
    specials,
    spaces,
    factCoverage,
    factStates,
    reviewers,
    history,
  ] = await Promise.all([
    settle(listVenueMenuVersions(actor, { venueId })),
    settle(getManagerVenueSummary(actor)),
    settle(listSpecials(actor, { venueId })),
    settle(listSpacePhotoFreshness(actor, { venueId })),
    settle(getFactCoverage(actor, { venueId })),
    settle(getFactStates(actor, { venueId })),
    settle(getVenueReviewers(actor)),
    settle(getVenueHistory(actor, { limit: 5 })),
  ])

  // A refusal on the reads that every manager can make means the grant ended.
  if (reviewers && !reviewers.ok && reviewers.code === "forbidden")
    return <VenueAccessUnavailable reason="no_grant" refreshShell />

  const menuList = versions?.ok ? versions.versions : null
  const active = menuList?.find((v) => v.state === "active") ?? null
  const scheduled = menuList?.filter((v) => v.state === "scheduled") ?? []
  const menuCheck = summary?.ok ? summary.summary.menuCheck : null

  const specialList = specials?.ok ? specials.specials : null
  const running = specialList?.filter((s) => s.state === "running").length
  const waiting = specialList?.filter((s) => s.state === "suggested").length

  const spaceRows = spaces?.ok ? spaces.photos : null
  const spacesCurrent = spaceRows?.filter((r) => r.state === "current").length
  const spacesDue = spaceRows?.filter((r) => r.state === "check_due").length

  const facts = factCoverage?.ok ? factCoverage.coverage : null
  const factWords = facts
    ? coverageWords(facts.numerator, facts.denominator)
    : null
  const checkHref = amenityHrefs(managerHrefs.overview).check
  const toConfirm =
    factStates?.ok && spaceRows
      ? factsToConfirm(factStates.items, checkHref).length +
        spacesToConfirm(spaceRows, "").length
      : null

  const now = new Date().toISOString()
  return (
    <div className="grid gap-8">
      <OfflineNotice className={OFFLINE_BANNER_CLASS} loadedAt={now} />
      <PageHeader
        scope={workspace.venue.name}
        venueScope
        title={copy.title}
        summary={copy.summary}
        className="pb-0 md:pb-0"
      />

      <Section id="menus" title={copy.menusTitle}>
        <div
          data-slot="venue-menus"
          className="grid gap-3 rounded-card bg-surface p-4 edge"
        >
          {active ? (
            <>
              <p className="text-label [overflow-wrap:anywhere] text-ink">
                {active.title}
              </p>
              {menuCheck ? <MenuMonthCheckControl check={menuCheck} /> : null}
            </>
          ) : menuList ? (
            <p className="text-body text-ink-muted">{copy.noMenu}</p>
          ) : (
            <p role="status" className="text-body text-ink-muted">
              {copy.menusFailed}
            </p>
          )}
          {scheduled.map((v) => (
            <p
              key={v.versionId}
              data-menu="scheduled"
              className="text-body text-ink-muted"
            >
              {copy.startsLater(v.title, when(v.scheduledFor))}
            </p>
          ))}
        </div>
        <ul className="grid gap-2 md:grid-cols-2">
          <li>
            <HomeRow
              href={managerHrefs.menuVersions}
              slot="venue-link"
              icon={<CalendarCheckIcon aria-hidden />}
              title={copy.menusLink}
              line={copy.menusLine}
            />
          </li>
          <li>
            <HomeRow
              href={managerHrefs.menu()}
              slot="venue-link"
              icon={<ForkKnifeIcon aria-hidden />}
              title={copy.availabilityLink}
              line={copy.availabilityLine}
            />
          </li>
        </ul>
      </Section>

      <Section id="specials" title={copy.specialsTitle}>
        <HomeRow
          href={managerHrefs.specials}
          slot="venue-link"
          icon={<StarIcon aria-hidden />}
          title={copy.specialsTitle}
          line={
            running === undefined || waiting === undefined
              ? copy.specialsUnknown
              : copy.specialsLine(running, waiting)
          }
        />
      </Section>

      <Section id="spaces" title={copy.spacesTitle}>
        <ul className="grid gap-2 md:grid-cols-2">
          <li>
            <HomeRow
              href={`${managerHrefs.overview}/amenities/places`}
              slot="venue-link"
              icon={<MapPinIcon aria-hidden />}
              title={copy.spacesTitle}
              line={
                spacesCurrent === undefined || spacesDue === undefined
                  ? copy.spacesUnknown
                  : copy.spacesLine(spacesCurrent, spacesDue)
              }
            />
          </li>
          <li>
            <HomeRow
              href={managerHrefs.albumPlaces}
              slot="venue-link"
              icon={<MapPinIcon aria-hidden />}
              title={copy.placesLink}
              line={copy.placesLine}
            />
          </li>
        </ul>
      </Section>

      <Section id="facilities" title={copy.facilitiesTitle}>
        <ul className="grid gap-2 md:grid-cols-2">
          <li>
            <HomeRow
              href={managerHrefs.venueFacts}
              slot="venue-link"
              icon={<SealCheckIcon aria-hidden />}
              title={copy.toConfirmLink}
              line={copy.toConfirmLine(toConfirm)}
            />
          </li>
          <li>
            <HomeRow
              href={amenityHrefs(managerHrefs.overview).list}
              slot="venue-link"
              icon={<ListChecksIcon aria-hidden />}
              title={copy.amenitiesLink}
              line={
                facts && factWords
                  ? copy.factsLine(
                      factWords.text,
                      factWords.percent,
                      facts.unconfirmed + facts.checkDue
                    )
                  : copy.factsUnknown
              }
            />
          </li>
        </ul>
      </Section>

      <Section id="team" title={copy.teamTitle}>
        <ul className="grid gap-2 md:grid-cols-2">
          <li>
            <HomeRow
              href={managerHrefs.team}
              slot="venue-link"
              icon={<UsersThreeIcon aria-hidden />}
              title={copy.teamLink}
              line={copy.teamLine}
            />
          </li>
          <li>
            <HomeRow
              href={managerHrefs.exports}
              slot="venue-link"
              icon={<ExportIcon aria-hidden />}
              title={copy.exportsLink}
              line={copy.exportsLine}
            />
          </li>
        </ul>
      </Section>

      <Section id="reviewers" title={copy.reviewersTitle}>
        <div className="rounded-card bg-surface p-4 edge">
          {reviewers?.ok ? (
            <ReviewersForm reviewers={reviewers.reviewers} />
          ) : (
            <p role="status" className="text-body text-ink-muted">
              {copy.reviewersFailed}
            </p>
          )}
        </div>
      </Section>

      <Section id="history" title={copy.historyTitle}>
        {history?.ok ? (
          history.page.items.length ? (
            <VenueHistoryList items={history.page.items} />
          ) : (
            <p className="text-body text-ink-muted">{copy.historyEmpty}</p>
          )
        ) : (
          <p role="status" className="text-body text-ink-muted">
            {copy.historyFailed}
          </p>
        )}
        <Link
          href={managerHrefs.venueHistory}
          className="inline-flex min-h-12 items-center gap-2 justify-self-start rounded-control text-body font-bold text-accent-text underline underline-offset-4 focus-ring"
        >
          <ClockCounterClockwiseIcon aria-hidden className="size-5" />
          {copy.historyAll}
        </Link>
      </Section>
    </div>
  )
}
