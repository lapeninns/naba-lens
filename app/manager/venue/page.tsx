import {
  CalendarCheckIcon,
  FlagIcon,
  ForkKnifeIcon,
  SealCheckIcon,
  StarIcon,
} from "@phosphor-icons/react/dist/ssr"

import { reconfirmFactAction } from "@/app/_knowledge/actions"
import { HomeRow } from "@/components/nabalens/album/home-rows"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { ManagerTabs } from "@/components/nabalens/manager/manager-tabs"
import { VenueAccessUnavailable } from "@/components/nabalens/manager/venue-access-unavailable"
import { MenuMonthCheckControl } from "@/components/nabalens/manager/venue/menu-month-check"
import { ReviewersForm } from "@/components/nabalens/manager/venue/reviewers-form"
import { StillRightList } from "@/components/nabalens/manager/venue/still-right-list"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { amenityHrefs } from "@/lib/amenities/contract"
import { getManagerWorkspace } from "@/lib/auth/manager"
import { factsToConfirm, spacesToConfirm } from "@/lib/manager/to-confirm"
import {
  getFactStates,
  listSpacePhotoFreshness,
} from "@/lib/server/knowledge/facts"
import {
  getManagerVenueSummary,
  getVenueReviewers,
} from "@/lib/server/manager/venue"
import { getMediaActor } from "@/lib/server/media/context"
import { listSpecials, listVenueMenuVersions } from "@/lib/server/menus/local"
import { listVenueSlotReports } from "@/lib/server/staff"

export const metadata = { title: "Venue" }

/** Facts listed in place on Details; the rest are on To confirm. */
const VENUE_FACTS_SHOWN = 3

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

/**
 * One block of Venue › Details: a Figtree section heading (ia.md decision
 * 9) with its one-line count on the right, then its rows.
 */
function Section({
  id,
  title,
  meta,
  children,
}: {
  id: string
  title: string
  meta?: string | null
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="grid scroll-mt-24 content-start gap-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={`${id}-title`} className="text-heading text-ink">
          {title}
        </h2>
        {meta ? <p className="text-meta text-ink-muted">{meta}</p> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * Venue › Details (spec §7 M5; S2-MGR; redesign R4, ia.md and the handoff):
 * facts to confirm and reported changes, the menu with its monthly check,
 * menus and local specials, and the reviewers. Spaces and amenities are
 * Album's tabs; Team, Progress, Exports and History are this section's. No
 * bottle button: nothing here is the one job of the page. Each row links the
 * screen that does the work; reads fail one at a time and say so in place.
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

  const [versions, summary, specials, spaces, factStates, reviewers, reports] =
    await Promise.all([
      settle(listVenueMenuVersions(actor, { venueId })),
      settle(getManagerVenueSummary(actor)),
      settle(listSpecials(actor, { venueId })),
      settle(listSpacePhotoFreshness(actor, { venueId })),
      settle(getFactStates(actor, { venueId })),
      settle(getVenueReviewers(actor)),
      settle(listVenueSlotReports(actor, { venueId, state: "open" })),
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
  const checkHref = amenityHrefs(managerHrefs.overview).check
  const facts = factStates?.ok
    ? factsToConfirm(factStates.items, checkHref)
    : null
  const toConfirm =
    facts && spaceRows
      ? facts.length + spacesToConfirm(spaceRows, "").length
      : null
  const reportCount = reports?.ok ? reports.reports.length : null

  const now = new Date().toISOString()
  return (
    <div className="grid gap-8">
      <OfflineNotice className={OFFLINE_BANNER_CLASS} loadedAt={now} />
      <div className="grid gap-4">
        <PageHeader
          scope={workspace.venue.name}
          venueScope
          title={copy.title}
          summary={copy.summary}
          className="pb-0 md:pb-0"
        />
        <ManagerTabs section="venue" active="details" />
      </div>

      {/* The handoff's Venue › Details: facts to confirm and reported
          changes on the left, the menu and reviewers on the right from
          bp-desktop; one column on phones. */}
      <div className="grid items-start gap-8 desktop:grid-cols-2">
        <div className="grid gap-8">
          <Section
            id="to-confirm"
            title={copy.toConfirmLink}
            meta={copy.toConfirmMeta(facts?.length ?? null)}
          >
            {/* The facts themselves, each with Still right, as on To
                confirm; space photos and the rest stay on that page. */}
            {facts && facts.length > 0 ? (
              <StillRightList
                label={copy.toConfirmLink}
                items={facts.slice(0, VENUE_FACTS_SHOWN)}
                onConfirm={reconfirmFactAction}
              />
            ) : null}
            <ul className="grid gap-2">
              <li>
                <HomeRow
                  href={managerHrefs.venueFacts}
                  slot="venue-to-confirm"
                  icon={<SealCheckIcon aria-hidden />}
                  title={copy.toConfirmLink}
                  line={copy.toConfirmLine(toConfirm)}
                />
              </li>
            </ul>
          </Section>

          <Section
            id="reports"
            title={copy.reportsLink}
            meta={copy.reportsMeta(reportCount)}
          >
            <ul className="grid gap-2">
              <li>
                <HomeRow
                  href={managerHrefs.venueReports}
                  slot="venue-reports"
                  icon={<FlagIcon aria-hidden />}
                  title={copy.reportsLink}
                  line={copy.reportsLine(reportCount)}
                />
              </li>
            </ul>
          </Section>
        </div>

        <div className="grid gap-8">
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
                  {menuCheck ? (
                    <MenuMonthCheckControl check={menuCheck} />
                  ) : null}
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
            <ul className="grid gap-2">
              <li>
                <HomeRow
                  href={managerHrefs.menuVersions}
                  slot="venue-menu-versions"
                  icon={<CalendarCheckIcon aria-hidden />}
                  title={copy.menusLink}
                  line={copy.menusLine}
                />
              </li>
              <li>
                <HomeRow
                  href={managerHrefs.specials}
                  slot="venue-specials"
                  icon={<StarIcon aria-hidden />}
                  title={copy.specialsTitle}
                  line={
                    running === undefined || waiting === undefined
                      ? copy.specialsUnknown
                      : copy.specialsLine(running, waiting)
                  }
                />
              </li>
              <li>
                <HomeRow
                  href={managerHrefs.menu()}
                  slot="venue-availability"
                  icon={<ForkKnifeIcon aria-hidden />}
                  title={copy.availabilityLink}
                  line={copy.availabilityLine}
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
        </div>
      </div>
    </div>
  )
}
