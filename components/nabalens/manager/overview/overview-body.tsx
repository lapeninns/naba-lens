import Link from "next/link"
import {
  ArrowsClockwiseIcon,
  CameraIcon,
  ClockIcon,
  ForkKnifeIcon,
  HourglassIcon,
  ImageSquareIcon,
  ImagesIcon,
  PencilSimpleIcon,
  ShieldCheckIcon,
  UserIcon,
} from "@phosphor-icons/react/dist/ssr"

import { Card, Row, SectionHeader } from "@/components/nabalens/common-room"
import { EmptyState } from "@/components/nabalens/empty-state"
import { waitingFor } from "@/components/nabalens/menu-photos/copy"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

import { TO_CONFIRM_COPY } from "@/components/nabalens/knowledge/copy"
import { Notice } from "@/components/nabalens/notice"
import { amenityHrefs } from "@/lib/amenities/contract"
import type { ManagerOverview } from "@/lib/server/menu-photos/types"

import { MANAGER_COPY } from "../copy"
import { managerHrefs } from "../hrefs"
import { WorkspacePending } from "../workspace-pending"
import { ActivationBanner, menuMeta } from "./activation-banner"

/** Rows grouped in one white card with hairlines (RowList, keeping each li). */
const ROW_LIST =
  "grid min-w-0 divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card [&_[data-slot=cr-row]]:rounded-none [&_[data-slot=cr-row]]:shadow-none [&_[data-slot=cr-row]]:focus-visible:-outline-offset-3"

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

export function OverviewBody({
  overview,
  now,
  staffTargets,
  confirmCount = 0,
  triage,
  needsLabels = null,
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
}) {
  const copy = MANAGER_COPY.overview
  const venueName = overview.venueName
  const confirm = (
    <>
      {triage ?? <ConfirmRow count={confirmCount} />}
      <NeedsLabelsRow count={needsLabels} />
    </>
  )

  if (overview.menuState === "no_menu") {
    return (
      <div className="grid gap-(--gutter)">
        <WorkspacePending
          venueName={venueName}
          title={copy.title}
          noteTitle={copy.noMenuTitle}
          note={copy.noMenuBody}
        />
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
      <div className="grid gap-(--gutter)">
        {header}
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
    <div className="grid gap-(--gutter)">
      {header}
      {confirm}
      <ActivationBanner overview={overview} now={now} />
      <section
        aria-labelledby="overview-photos"
        className="grid gap-(--gutter)"
      >
        <Card>
          <h2
            id="overview-photos"
            className="font-display text-card-title [overflow-wrap:anywhere] text-ink"
          >
            {heading}
          </h2>
          <Progress
            value={eligible > 0 ? (covered / eligible) * 100 : 0}
            aria-label={heading}
            aria-valuetext={heading}
          />
          {meta ? <p className="text-meta text-ink-muted">{meta}</p> : null}
          {pendingPhotos > 0 ? (
            <Link
              href={managerHrefs.review()}
              className={buttonVariants({
                variant: "primary",
                size: "touch",
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
            title={copy.quietTitle}
            description={<p>{copy.quietBody(eligible - covered)}</p>}
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
          className="grid gap-(--gutter)"
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
