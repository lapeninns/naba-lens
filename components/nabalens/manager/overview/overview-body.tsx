import Link from "next/link"
import {
  ArrowsClockwiseIcon,
  CameraIcon,
  ChartBarIcon,
  ClockIcon,
  ForkKnifeIcon,
  HourglassIcon,
  ImageSquareIcon,
  ImagesIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  ShieldCheckIcon,
  UserIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react/dist/ssr"

import { Card, Row, SectionHeader } from "@/components/nabalens/common-room"
import { EmptyState } from "@/components/nabalens/empty-state"
import { waitingFor } from "@/components/nabalens/menu-photos/copy"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

import { TO_CONFIRM_COPY } from "@/components/nabalens/knowledge/copy"
import { METRICS_COPY } from "@/components/nabalens/metrics/copy"
import { metricsHrefs } from "@/components/nabalens/metrics/hrefs"
import { Notice } from "@/components/nabalens/notice"
import { SEARCH_COPY } from "@/components/nabalens/search/search-copy"
import { amenityHrefs } from "@/lib/amenities/contract"
import type { ManagerOverview } from "@/lib/server/menu-photos/types"

import { MANAGER_COPY } from "../copy"
import { managerHrefs } from "../hrefs"
import { WorkspacePending } from "../workspace-pending"
import { ActivationBanner, menuMeta } from "./activation-banner"
import { MANAGER_ROW_LIST } from "./overview-panels"

const ROW_LIST = MANAGER_ROW_LIST

const TALLY_ICON: Record<string, React.ReactNode> = {
  photos: <ImagesIcon />,
  awaiting: <ClockIcon />,
  "needs-photo": <CameraIcon />,
  oldest: <HourglassIcon />,
  replacement: <ImageSquareIcon />,
  recheck: <ArrowsClockwiseIcon />,
  own: <UserIcon />,
}

/**
 * Overview of the venue manager workspace: how many active-menu items have a
 * menu photo, what is waiting for a decision (each count links to the
 * filtered Review or Menu view), a recent activation, and per-section totals.
 */
/**
 * Amenity findings waiting for this manager: one row, hidden at zero; a
 * failed read says so rather than showing nothing waiting (MG-03).
 */
function ConfirmRow({ count }: { count: number | null }) {
  if (count === null)
    return (
      <Notice tone="negative" role="alert">
        {TO_CONFIRM_COPY.failed}
      </Notice>
    )
  if (count <= 0) return null
  return (
    <ul className={ROW_LIST}>
      <li data-tally="confirm">
        <Row
          href={`${amenityHrefs(managerHrefs.overview).list}#amenities-to-confirm`}
          icon={<ShieldCheckIcon />}
          title={TO_CONFIRM_COPY.overviewRow(count)}
        />
      </li>
    </ul>
  )
}

/**
 * This manager account's uploads that need labels (R1): one row linking to
 * My uploads, shown only above zero.
 */
function NeedsLabelsRow({ count }: { count: number | null }) {
  if (!count || count <= 0) return null
  return (
    <ul className={ROW_LIST}>
      <li data-tally="needs-labels">
        <Row
          href={managerHrefs.uploads}
          icon={<PencilSimpleIcon />}
          title={MANAGER_COPY.overview.needsLabels(count)}
        />
      </li>
    </ul>
  )
}

/** B05-06: the venue's photos and videos, by item, use and decision. */
function SearchRow() {
  return (
    <ul className={ROW_LIST}>
      <li data-link="search">
        <Row
          href={managerHrefs.search}
          icon={<MagnifyingGlassIcon />}
          title={SEARCH_COPY.entry}
        />
      </li>
    </ul>
  )
}

/** S2-REQ: requests and shot lists (spec §7 M4, "Request missing photos"). */
function RequestsRow() {
  return (
    <ul className={ROW_LIST}>
      <li data-link="requests">
        <Row
          href={managerHrefs.requests}
          icon={<ListChecksIcon />}
          title="Requests and shot lists"
          subtitle="Ask for a missing photo, a new angle or a fact check."
        />
      </li>
    </ul>
  )
}

/** G-6: the venue default and each person's monthly photo target. */
function TeamRow() {
  return (
    <ul className={ROW_LIST}>
      <li data-link="team">
        <Row
          href={managerHrefs.team}
          icon={<UsersThreeIcon />}
          title={MANAGER_COPY.team.entry}
          subtitle={MANAGER_COPY.team.entryNote}
        />
      </li>
    </ul>
  )
}

/** S2-METRICS (spec §18.1): the venue's metrics, with how each is counted. */
function MetricsRow() {
  return (
    <ul className={ROW_LIST}>
      <li data-link="metrics">
        <Row
          href={metricsHrefs.manager()}
          icon={<ChartBarIcon />}
          title={METRICS_COPY.entry}
          subtitle={METRICS_COPY.entryNote}
        />
      </li>
    </ul>
  )
}

export function OverviewBody({
  overview,
  now,
  staffTargets,
  confirmCount = 0,
  triage,
  needsLabels = null,
  actions,
  panels,
}: {
  overview: ManagerOverview
  staffTargets?: React.ReactNode
  /** ISO instant of the render, so server and browser agree. */
  now: string
  /** Amenity findings waiting for a decision (0 when none or unreadable). */
  confirmCount?: number | null
  /**
   * The Triage card (B02 §6.2). It replaces the To confirm row and the own
   * waiting photos tally, which it carries itself.
   */
  triage?: React.ReactNode
  /** R1: this manager account's uploads that need labels; null hides the row. */
  needsLabels?: number | null
  /**
   * S2-MGR (spec §7 M1): the actions panel, first after the page header.
   * When given it carries Review next as the screen's main button, so the
   * menu card's Review photos button is not drawn (DESIGN.md §11 rule 2).
   */
  actions?: React.ReactNode
  /**
   * S2-MGR: collection vs review backlog, coverage by category and the
   * venue's menu and reviewers, before the menu photo detail.
   */
  panels?: React.ReactNode
}) {
  const copy = MANAGER_COPY.overview
  const venueName = overview.venueName
  const confirm = (
    <>
      {triage ?? <ConfirmRow count={confirmCount} />}
      <NeedsLabelsRow count={needsLabels} />
      {/* Search needs a menu; photo targets don't (review c, 6). */}
      {overview.menuState !== "no_menu" ? <SearchRow /> : null}
      <RequestsRow />
      <TeamRow />
      <MetricsRow />
    </>
  )

  if (overview.menuState === "no_menu") {
    return (
      <div className="grid gap-gutter">
        <WorkspacePending
          venueName={venueName}
          title={copy.title}
          noteTitle={copy.noMenuTitle}
          note={copy.noMenuBody}
        />
        {actions}
        {panels}
        {confirm}
        {staffTargets}
      </div>
    )
  }

  const meta = menuMeta(overview.menu)
  const header = (
    <PageHeader
      scope={venueName}
      venueScope
      title={copy.title}
      className="pb-0 md:pb-0"
    />
  )

  if (overview.menuState === "empty") {
    return (
      <div className="grid gap-gutter">
        {header}
        {actions}
        {panels}
        {confirm}
        <EmptyState
          title={copy.emptyTitle}
          description={
            <>
              {meta ? <p>{meta}</p> : null}
              <p>{copy.emptyBody}</p>
            </>
          }
        />
        {staffTargets}
      </div>
    )
  }

  const { covered, eligible, pendingPhotos } = overview
  const heading = copy.heading(covered, eligible)
  const allCovered = eligible > 0 && covered >= eligible
  const waited = waitingFor(overview.oldestPendingAt, now)

  const tallies: { key: string; text: string; href: string }[] = [
    {
      key: "photos",
      text: copy.photosWaiting(pendingPhotos),
      href: managerHrefs.review(),
    },
    {
      key: "awaiting",
      text: copy.itemsAwaiting(overview.awaitingReviewItems),
      href: managerHrefs.menu({ status: "awaiting_review" }),
    },
    {
      key: "needs-photo",
      text: copy.itemsNoPhoto(overview.needsPhotoItems),
      href: managerHrefs.menu({ status: "needs_photo" }),
    },
    ...(waited
      ? [
          {
            key: "oldest",
            text: copy.oldestWaiting(waited),
            href: managerHrefs.review(),
          },
        ]
      : []),
    ...(overview.replacementPendingItems > 0
      ? [
          {
            key: "replacement",
            text: copy.replacement(overview.replacementPendingItems),
            href: managerHrefs.menu({ status: "replacement" }),
          },
        ]
      : []),
    ...(overview.needsRecheckItems > 0
      ? [
          {
            key: "recheck",
            text: copy.recheck(overview.needsRecheckItems),
            href: managerHrefs.review({ status: "recheck" }),
          },
        ]
      : []),
    ...(overview.ownWaitingPhotos > 0 && !triage
      ? [
          {
            key: "own",
            text: copy.ownWaiting(overview.ownWaitingPhotos),
            href: managerHrefs.review({ status: "mine" }),
          },
        ]
      : []),
  ]

  return (
    <div className="grid gap-gutter">
      {header}
      {actions}
      {panels}
      {confirm}
      <ActivationBanner overview={overview} now={now} />
      <section aria-labelledby="overview-photos" className="grid gap-gutter">
        <Card>
          <h2
            id="overview-photos"
            className="type-section-title [overflow-wrap:anywhere] text-ink"
          >
            {heading}
          </h2>
          <Progress
            value={eligible > 0 ? (covered / eligible) * 100 : 0}
            aria-label={heading}
            aria-valuetext={heading}
            // Green: the bar counts items with an accepted photo.
            tone="ok"
          />
          {meta ? <p className="text-meta text-ink-muted">{meta}</p> : null}
          {pendingPhotos > 0 && !actions ? (
            <Link
              href={managerHrefs.review()}
              className={buttonVariants({
                variant: "primary",
                className: "mt-1 justify-self-start max-md:w-full",
              })}
            >
              {copy.reviewPhotos}
            </Link>
          ) : null}
        </Card>
        <ul className={ROW_LIST}>
          {tallies.map((tally) => (
            <li key={tally.key} data-tally={tally.key}>
              <Row
                href={tally.href}
                icon={TALLY_ICON[tally.key]}
                title={tally.text}
              />
            </li>
          ))}
        </ul>
        {pendingPhotos > 0 ? null : allCovered ? (
          <EmptyState
            variant="done"
            title={copy.doneTitle}
            description={
              <Link
                href={managerHrefs.review({ status: "pending" })}
                className={buttonVariants({ variant: "link" })}
              >
                {copy.doneLink}
              </Link>
            }
          />
        ) : (
          <EmptyState
            title={
              actions ? copy.gapsTitle(eligible - covered) : copy.quietTitle
            }
            description={
              <p>
                {actions ? copy.gapsBody : copy.quietBody(eligible - covered)}
              </p>
            }
            action={
              <Link
                href={managerHrefs.menu({ status: "needs_photo" })}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                {copy.quietLink}
              </Link>
            }
          />
        )}
      </section>
      {staffTargets}
      {overview.sections.length > 0 ? (
        <section
          aria-labelledby="overview-sections"
          className="grid gap-gutter"
        >
          <SectionHeader id="overview-sections" title={copy.sectionsTitle} />
          <ul className={ROW_LIST}>
            {overview.sections.map((section) => (
              <li key={section.sectionId}>
                <Row
                  href={managerHrefs.menu({ section: section.sectionId })}
                  icon={<ForkKnifeIcon />}
                  title={copy.section(
                    section.name,
                    section.covered,
                    section.eligible
                  )}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
