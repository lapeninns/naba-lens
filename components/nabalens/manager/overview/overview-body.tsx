import Link from "next/link"
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr"

import { EmptyState } from "@/components/nabalens/empty-state"
import { waitingFor } from "@/components/nabalens/menu-photos/copy"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

import type { ManagerOverview } from "@/lib/server/menu-photos/types"

import { MANAGER_COPY } from "../copy"
import { managerHrefs } from "../hrefs"
import { WorkspacePending } from "../workspace-pending"
import { ActivationBanner, menuMeta } from "./activation-banner"

const TALLY_LINK =
  "inline-flex min-h-11 items-center gap-1.5 text-body-touch text-ink underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid md:min-h-8 md:text-body"

/**
 * Overview of the venue manager workspace: how many active-menu items have a
 * menu photo, what is waiting for a decision (each count links to the
 * filtered Review or Menu view), a recent activation, and per-section totals.
 */
export function OverviewBody({
  overview,
  now,
}: {
  overview: ManagerOverview
  /** ISO instant of the render, so server and browser agree. */
  now: string
}) {
  const copy = MANAGER_COPY.overview
  const venueName = overview.venueName

  if (overview.menuState === "no_menu") {
    return (
      <WorkspacePending
        venueName={venueName}
        title={copy.title}
        noteTitle={copy.noMenuTitle}
        note={copy.noMenuBody}
      />
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
      <div className="grid gap-6">
        {header}
        <EmptyState
          title={copy.emptyTitle}
          description={
            <>
              {meta ? <p>{meta}</p> : null}
              <p>{copy.emptyBody}</p>
            </>
          }
        />
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
    ...(overview.ownWaitingPhotos > 0
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
    <div className="grid gap-6">
      {header}
      <ActivationBanner overview={overview} now={now} />
      <section aria-labelledby="overview-photos" className="grid gap-4">
        <div className="grid gap-2">
          <h2
            id="overview-photos"
            className="text-section-title-touch break-words text-ink md:text-section-title"
          >
            {heading}
          </h2>
          <Progress
            value={eligible > 0 ? (covered / eligible) * 100 : 0}
            aria-label={heading}
            aria-valuetext={heading}
            className="max-w-sm"
          />
          {meta ? (
            <p className="text-meta-touch text-ink-muted md:text-meta">
              {meta}
            </p>
          ) : null}
        </div>
        <ul className="grid gap-0.5">
          {tallies.map((tally) => (
            <li key={tally.key} data-tally={tally.key}>
              <Link href={tally.href} className={TALLY_LINK}>
                {tally.text}
                <ArrowRightIcon
                  aria-hidden
                  className="size-4 shrink-0 text-ink-muted"
                />
              </Link>
            </li>
          ))}
        </ul>
        {pendingPhotos > 0 ? (
          <Link
            href={managerHrefs.review()}
            className={buttonVariants({
              variant: "primary",
              size: "touch",
              className: "justify-self-start max-md:w-full",
            })}
          >
            {copy.reviewPhotos}
          </Link>
        ) : allCovered ? (
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
      {overview.sections.length > 0 ? (
        <section aria-labelledby="overview-sections" className="grid gap-2">
          <h2
            id="overview-sections"
            className="text-section-title-touch text-ink md:text-section-title"
          >
            {copy.sectionsTitle}
          </h2>
          <ul className="grid gap-0.5">
            {overview.sections.map((section) => (
              <li key={section.sectionId}>
                <Link
                  href={managerHrefs.menu({ section: section.sectionId })}
                  className={TALLY_LINK}
                >
                  <span className="break-words">
                    {copy.section(
                      section.name,
                      section.covered,
                      section.eligible
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
