"use client"

import * as React from "react"
import { flushSync } from "react-dom"
import Link from "next/link"
import { CameraIcon } from "@phosphor-icons/react/dist/ssr"

import { buttonVariants } from "@/components/ui/button"
import { EVIDENCE_RULE_LABEL, staffCaptureHref } from "@/lib/amenities/contract"
import type { LabelWork } from "@/lib/work-client/contract"
import { CHECKS_SHOWN, todoBadge } from "@/lib/work-client/todo"

import { useAdd, useAddFailed, type OpenAddOptions } from "../shell/add-context"
import { CountBadge } from "../status-chip"
import type { CheckCard as CheckCardData, NextAction, RetakeRequest } from "./next-actions-model"
import { SetupChecklist, setupHasAction } from "./setup-checklist"
import { StatusChip } from "./status-badges"
import {
  action,
  AttentionCard,
  cardClass,
  ReadFailed,
  ReplaceCard,
  ReviewCard,
  TaskCard,
  thingsToDo,
  titleClass,
  TODO_HEADING_ID,
  TopRow,
} from "./todo-list"
import type { CoverageScope } from "./types"

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/** Which reads behind To do failed: each says so in its own words. */
export type NextActionErrors = {
  amenity?: boolean
  review?: boolean
  labels?: boolean
  retakes?: boolean
}

const READ_FAILED: Record<keyof NextActionErrors, string> = {
  review: "We couldn't check photos to review.",
  amenity: "We couldn't check your amenity checks.",
  labels: "We couldn't check which photos need labels.",
  retakes: "We couldn't check requests for a better photo.",
}

const checkLinkId = (checkId: string) => `todo-check-${checkId}`

/** Uploads that didn't finish on this phone: only this browser knows them. */
function UploadsCard({
  count,
  primary,
  openAdd,
}: {
  count: number
  primary: boolean
  openAdd: (opts?: OpenAddOptions) => void
}) {
  return (
    <li className={cardClass(primary, "warn")}>
      <TopRow kicker="On this phone" />
      <h3 className={titleClass(primary)}>
        {plural(count, "photo didn't", "photos didn't")} finish saving
      </h3>
      <button
        type="button"
        onClick={() => openAdd()}
        className={action(primary)}
      >
        See them
      </button>
    </li>
  )
}

function RetakeCard({
  request,
  primary,
  openAdd,
  portfolioPath,
}: {
  request: RetakeRequest
  primary: boolean
  openAdd: ((opts?: OpenAddOptions) => void) | null
  portfolioPath: string
}) {
  const dish = request.variantName
    ? `${request.itemName} (${request.variantName})`
    : request.itemName
  const preset = {
    itemId: request.itemId,
    variantId: request.variantId,
    itemName: request.itemName,
    variantName: request.variantName,
  }
  const content = (
    <>
      <CameraIcon data-icon="inline-start" aria-hidden />
      Take a new photo
    </>
  )
  return (
    <li className={cardClass(primary, "warn")}>
      <TopRow
        kicker={<>For: {dish}</>}
        chip={<StatusChip tone="warning">Better photo requested</StatusChip>}
      />
      {/* OD-3: the card never names the reviewer. */}
      <h3 className={titleClass(primary)}>
        {request.reason
          ? `A reviewer asked for a better photo: ${request.reason}`
          : "A reviewer asked for a better photo"}
      </h3>
      {openAdd ? (
        <button
          type="button"
          aria-label={`Take a new photo of ${dish}`}
          // openAdd clicks the camera input inside this click handler.
          onClick={() =>
            openAdd({ source: "camera", imagesOnly: true, preset })
          }
          className={action(primary)}
        >
          {content}
        </button>
      ) : (
        <Link
          href={`${portfolioPath}#better-heading`}
          aria-label={`Take a new photo of ${dish}`}
          className={action(primary)}
        >
          {content}
        </Link>
      )}
    </li>
  )
}

function LabelsCard({
  work,
  primary,
  portfolioPath,
}: {
  work: LabelWork
  primary: boolean
  portfolioPath: string
}) {
  const attention =
    work.needsAttention > 0
      ? `${plural(work.needsAttention, "label save needs", "label saves need")} attention`
      : null
  return (
    <li className={cardClass(primary, "info")}>
      <h3 className={titleClass(primary)}>
        {work.needsLabels > 0
          ? `${plural(work.needsLabels, "photo needs", "photos need")} labels`
          : attention}
      </h3>
      {work.needsLabels > 0 && attention ? (
        <p className="text-body text-ink">{attention}</p>
      ) : null}
      <Link
        href={`${portfolioPath}#needs-labels-heading`}
        className={action(primary)}
      >
        Label these
      </Link>
    </li>
  )
}

function CheckCard({
  check,
  recheck,
  primary,
}: {
  check: CheckCardData
  recheck: boolean
  primary: boolean
}) {
  return (
    <li className={cardClass(primary, recheck ? "warn" : "info")}>
      <TopRow
        kicker={<>Amenity check: {check.category}</>}
        chip={
          <StatusChip tone={recheck ? "warning" : "info"}>
            {check.chip}
          </StatusChip>
        }
      />
      <h3 className={titleClass(primary)}>{check.question}</h3>
      {recheck && check.recheckReason ? (
        <p className="text-body [overflow-wrap:anywhere] text-ink">
          <span className="font-semibold">Recheck reason:</span>{" "}
          {check.recheckReason}
        </p>
      ) : null}
      <p className="text-body text-ink-muted">
        Evidence: {EVIDENCE_RULE_LABEL[check.evidenceRule]}
      </p>
      <Link
        id={checkLinkId(check.checkId)}
        href={staffCaptureHref(check.checkId)}
        aria-label={`${check.action}: ${check.question}`}
        className={action(primary)}
      >
        {check.action}
      </Link>
    </li>
  )
}

function hasAction(
  item: NextAction,
  scope: CoverageScope,
  profile: Parameters<typeof setupHasAction>[0]
): boolean {
  switch (item.kind) {
    case "setup":
      return setupHasAction(profile)
    case "replacement":
      return !item.closed && scope.canSubmit
    default:
      return true
  }
}

/**
 * To do on the B02 Home (design §3.1): failed uploads on this phone first,
 * then the server's cards in the D1 order. The first card with an action
 * leads; assigned checks show three at a time until "Show all N".
 */
export function NextActions({
  actions,
  scope,
  profile,
  tasksPath,
  portfolioPath,
  errors = {},
}: {
  actions: NextAction[]
  scope: CoverageScope
  profile: Parameters<typeof SetupChecklist>[0]["profile"]
  tasksPath: string
  portfolioPath: string
  errors?: NextActionErrors
}) {
  const openAdd = useAdd()
  const failedUploads = useAddFailed() ?? 0
  const [expanded, setExpanded] = React.useState(false)

  const count = (todoBadge(actions, false) ?? 0) + failedUploads
  const lead =
    failedUploads > 0
      ? -1
      : actions.findIndex((item) => hasAction(item, scope, profile))
  const checks = actions.filter((item) => item.kind === "check")
  const folded = !expanded && checks.length > CHECKS_SHOWN
  const hidden = new Set(folded ? checks.slice(CHECKS_SHOWN) : [])
  const lastShown = folded ? checks[CHECKS_SHOWN - 1] : null
  const failures = (Object.keys(READ_FAILED) as (keyof NextActionErrors)[])
    .filter((read) => errors[read])

  function showAll() {
    const next = checks[CHECKS_SHOWN]
    flushSync(() => setExpanded(true))
    // The button goes: focus moves to the first check it showed.
    if (next && next.kind === "check")
      document.getElementById(checkLinkId(next.check.checkId))?.focus()
  }

  function card(item: NextAction, primary: boolean) {
    switch (item.kind) {
      case "setup":
        return (
          <li key="setup" className="list-none">
            <SetupChecklist
              setup={scope.setup}
              profile={profile}
              editProfileHref={`${portfolioPath}?edit=profile`}
              actionClassName={action(primary)}
            />
          </li>
        )
      case "replacement":
        return (
          <ReplaceCard
            key={item.key}
            submission={item.submission}
            closed={item.closed}
            tasksPath={tasksPath}
            canSubmit={scope.canSubmit}
            primary={primary}
          />
        )
      case "retake":
        return (
          <RetakeCard
            key={item.key}
            request={item.request}
            primary={primary}
            openAdd={openAdd}
            portfolioPath={portfolioPath}
          />
        )
      case "finding":
        return <AttentionCard key={item.key} slot={item.slot} primary={primary} />
      case "recheck":
      case "check":
        return (
          <CheckCard
            key={item.key}
            check={item.check}
            recheck={item.kind === "recheck"}
            primary={primary}
          />
        )
      case "labels":
        return (
          <LabelsCard
            key={item.key}
            work={item.work}
            primary={primary}
            portfolioPath={portfolioPath}
          />
        )
      case "review_photos":
        return (
          <ReviewCard
            key={item.key}
            count={item.count}
            venueName={scope.venue?.name ?? null}
            primary={primary}
          />
        )
      default:
        return (
          <TaskCard
            key={item.key}
            kind={item.kind === "overdue" ? "overdue" : "due-soon"}
            assignment={item.assignment}
            tasksPath={tasksPath}
            primary={primary}
          />
        )
    }
  }

  return (
    <section aria-labelledby={TODO_HEADING_ID} className="grid gap-(--gutter)">
      <div className="px-1 pt-2">
        <h2
          id={TODO_HEADING_ID}
          tabIndex={-1}
          // Chrome puts a space before the count badge (an inline-grid) when
          // it names the heading: "To do , 2 things to do".
          aria-label={
            count > 0 ? `To do, ${count} ${thingsToDo(count)}` : "To do"
          }
          className="flex items-center gap-2 rounded-control font-display text-section-title text-ink outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        >
          To do
          <CountBadge count={count} label={thingsToDo(count)} />
        </h2>
      </div>
      {failures.map((read) => (
        <ReadFailed key={read} retryHref={tasksPath}>
          {READ_FAILED[read]}
        </ReadFailed>
      ))}
      {actions.length === 0 && failedUploads === 0 ? (
        failures.length > 0 ? null : (
          <div className="rounded-card bg-surface p-4 shadow-card">
            <p className="font-display text-section-title text-ink">
              Nothing to do right now.
            </p>
          </div>
        )
      ) : (
        <ul className="grid gap-(--gutter)">
          {failedUploads > 0 && openAdd ? (
            <UploadsCard count={failedUploads} primary openAdd={openAdd} />
          ) : null}
          {actions.flatMap((item, index) => {
            if (hidden.has(item)) return []
            const shown = [card(item, index === lead)]
            if (item === lastShown)
              shown.push(
                <li key="show-all-checks" className="list-none">
                  <button
                    type="button"
                    onClick={showAll}
                    className={buttonVariants({
                      variant: "secondary",
                      size: "touch",
                      className: "w-full sm:w-auto",
                    })}
                  >
                    Show all {checks.length}
                  </button>
                </li>
              )
            return shown
          })}
        </ul>
      )}
    </section>
  )
}
