import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { TO_CONFIRM_COPY } from "@/components/nabalens/knowledge/copy"
import type { PolicyContext } from "@/components/nabalens/knowledge/policy-detail"
import { questionForm } from "@/components/nabalens/knowledge/question-form"
import type { UpcomingRead } from "@/components/nabalens/knowledge/schedule-section"
import type {
  QuestionView,
  SlotEventView,
} from "@/lib/knowledge-client/contract"
import { workServices } from "@/lib/work-client/services"
import { londonToday } from "@/lib/server/knowledge/dates"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import {
  UI_TEXT,
  amenityHrefs,
  type AmenityFailure,
} from "@/lib/amenities/contract"
import { ROUTES } from "@/lib/auth/routes"
import {
  getCheck,
  getVenueAmenities,
  listCatalogue,
} from "@/lib/server/amenities"
import { isUuid } from "@/lib/server/coverage/validate"
import { knowledgeServices } from "@/lib/knowledge-client/services"

import { type ManageContext } from "../context"
import { ManageFrame, NotManagerPage } from "../frame"

import {
  AmenitiesOverviewControl,
  AmenityCheckControl,
  PlacesControl,
} from "./amenities-controls"

/**
 * The page frame: /staff/manage and admin pages bring their own shell and
 * coverage tabs; the /manager workspace layout already has its shell and nav,
 * so its pages carry only the header.
 */
async function AmenitiesFrame({
  ctx,
  title,
  summary,
  pendingReview,
  children,
}: {
  ctx: ManageContext
  title: string
  summary?: React.ReactNode
  pendingReview?: number
  children: React.ReactNode
}) {
  if (ctx.mode === "workspace") {
    return (
      <div className="grid gap-6">
        <PageHeader
          scope={ctx.venue.name}
          venueScope
          title={title}
          summary={summary}
          className="pb-0 md:pb-0"
        />
        {children}
      </div>
    )
  }
  return (
    <ManageFrame
      ctx={ctx}
      section="amenities"
      title={title}
      summary={summary}
      pendingReview={pendingReview}
    >
      {children}
    </ManageFrame>
  )
}

/**
 * A refused read (grant revoked, moved venue) shows the plain refusal (the
 * workspace's is Venue access unavailable, on /manager); an
 * unknown check is a 404; a service that is down is said on the page, so the
 * tabs stay usable. Anything else goes to the segment error boundary.
 */
function amenityFailed(
  ctx: ManageContext,
  failure: AmenityFailure,
  title: string
) {
  if (failure.code === "not_permitted" || failure.code === "wrong_venue") {
    if (ctx.mode === "manager")
      return <NotManagerPage viewerName={ctx.viewerName} />
    if (ctx.mode === "workspace") redirect(ROUTES.managerHome)
    throw new Error(failure.message)
  }
  if (failure.code === "not_found" || failure.code === "invalid_input")
    notFound()
  if (failure.code === "unavailable" || failure.code === "needs_setup") {
    return (
      <AmenitiesFrame ctx={ctx} title={title}>
        <OfflineNotice loadedAt={new Date().toISOString()} />
        <Notice tone="negative" title="Amenities couldn't be loaded">
          {failure.message} Reload the page to try again.
        </Notice>
      </AmenitiesFrame>
    )
  }
  throw new Error(failure.message)
}

export async function AmenitiesScreen({ ctx }: { ctx: ManageContext }) {
  const [result, toConfirm] = await Promise.all([
    getVenueAmenities(ctx.actor, { venueId: ctx.venueId }),
    // A failed read leaves the checks usable and says the findings to
    // confirm couldn't be loaded (MG-03), never that nothing is waiting.
    knowledgeServices
      .listToConfirm(ctx.actor, { venueId: ctx.venueId })
      .catch(() => null),
  ])
  if (!result.ok) return amenityFailed(ctx, result, UI_TEXT.navTab)
  const view = result.view
  // The picker is only offered once Amenities are on; a failed catalogue read
  // leaves the checks usable and disables Add.
  const catalogue = view.enabled
    ? await listCatalogue(ctx.actor, { venueId: ctx.venueId })
    : null
  const venue = ctx.venue.name

  return (
    <AmenitiesFrame
      ctx={ctx}
      title={UI_TEXT.navTab}
      summary={`Questions guests ask about ${venue}, each answered with photo or video evidence. Separate from the checklist and photo targets.`}
      pendingReview={ctx.coverage?.summary.pendingReview}
    >
      <OfflineNotice loadedAt={new Date().toISOString()} />
      <div>
        <Link
          href={placesHref(ctx.basePath)}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          Places at {venue}
        </Link>
      </div>
      <AmenitiesOverviewControl
        view={view}
        catalogue={catalogue?.ok ? catalogue.options : null}
        basePath={ctx.basePath}
        toConfirm={toConfirm?.ok ? toConfirm.view : null}
        toConfirmFailed={!toConfirm?.ok}
      />
    </AmenitiesFrame>
  )
}

/**
 * On a policy question (registry policy@1), what the check page reads it
 * with: the venue's places and the owner's lists, each none when it can't be
 * read. Null on any other question, and when the registry can't be read (the
 * page is then as before B03).
 */
async function policyContextFor(
  ctx: ManageContext,
  key: string
): Promise<PolicyContext | null> {
  try {
    const question = await knowledgeServices.getQuestion(ctx.actor, { key })
    const form = questionForm(question.ok ? question.question : null)
    if (form.kind !== "policy") return null
    const [places, conditions, exceptions] = await Promise.all([
      knowledgeServices
        .listPlaces(ctx.actor, { venueId: ctx.venueId })
        .catch(() => null),
      knowledgeServices
        .getValueList(ctx.actor, { list: "policy_condition_types" })
        .catch(() => null),
      knowledgeServices
        .getValueList(ctx.actor, { list: "policy_exception_types" })
        .catch(() => null),
    ])
    return {
      places: places?.ok ? (places.places ?? []) : [],
      conditionTypes: conditions?.ok ? conditions.items : [],
      exceptionTypes: exceptions?.ok ? exceptions.items : [],
      retiredTypes: [
        ...((conditions?.ok ? conditions.retired : null) ?? []),
        ...((exceptions?.ok ? exceptions.retired : null) ?? []),
      ],
    }
  } catch {
    return null
  }
}

/** B03-e: a check's open rechecks; null when they can't be read. */
async function rechecksFor(ctx: ManageContext, checkId: string) {
  try {
    const result = await knowledgeServices.getCheckRechecks(ctx.actor, {
      checkId,
    })
    return result.ok ? { count: result.count, tasks: result.tasks } : null
  } catch {
    return null
  }
}

/**
 * B03-g (A1, A16): who may correct, withdraw and read history here, from the
 * venue's capabilities, and the first page of history. Null when the
 * capabilities can't be read: none of the actions are offered on a guess.
 */
async function correctionsFor(ctx: ManageContext, checkId: string) {
  try {
    const caps = await workServices.getCapabilities(ctx.actor, ctx.venueId)
    if (caps.status !== "ok") return null
    const {
      canCorrect = false,
      canWithdraw = false,
      canReadHistory = false,
      canStatePolicy = false,
    } = caps.value
    let events: { items: SlotEventView[]; nextCursor: string | null } | null =
      null
    if (canReadHistory) {
      const read = await knowledgeServices
        .listSlotEvents(ctx.actor, { checkId, limit: 20 })
        .catch(() => null)
      events = read?.ok
        ? { items: read.items, nextCursor: read.nextCursor }
        : null
    }
    return {
      canCorrect,
      canWithdraw,
      canReadHistory,
      canStatePolicy,
      events,
      today: londonToday(new Date()),
    }
  } catch {
    return null
  }
}

/** B03-f: the venue's old facts as history; null when they can't be read. */
async function oldFactsFor(ctx: ManageContext) {
  try {
    const result = await knowledgeServices.getLegacyNarrative(ctx.actor, {
      venueId: ctx.venueId,
    })
    return result.ok ? result.items : null
  } catch {
    return null
  }
}

const UPCOMING_DAYS = 91

/**
 * Upcoming (B03 UI design §5.3) for a schedule in use: the server's next
 * dates over 13 weeks, in the venue's zone. Null when no schedule is in use.
 */
async function upcomingFor(
  ctx: ManageContext,
  view: Extract<QuestionView, { inScope: true }>
): Promise<{
  read: UpcomingRead
  timezone: string
  lastDay: string | null
  today: string
} | null> {
  const answer = view.slot.answerInUse
  const schedule = answer.answerDetail?.schedule
  if (!answer.scheduleId && !schedule) return null
  const today = londonToday(new Date())
  const to = new Date(
    Date.parse(`${today}T12:00:00Z`) + UPCOMING_DAYS * 86_400_000
  )
    .toISOString()
    .slice(0, 10)
  const result = await knowledgeServices
    .getOccurrences(ctx.actor, { checkId: view.slot.checkId, from: today, to })
    .catch(() => null)
  const lastDay =
    schedule && typeof schedule === "object" && "effectiveTo" in schedule
      ? String((schedule as { effectiveTo?: unknown }).effectiveTo ?? "") ||
        null
      : null
  return {
    read: result?.ok
      ? { ok: true, occurrences: result.occurrences }
      : { ok: false, retry: !result || result.code === "unavailable" },
    timezone: view.timezone ?? "Europe/London",
    lastDay,
    today,
  }
}

export async function AmenityCheckScreen({
  ctx,
  checkId,
}: {
  ctx: ManageContext
  checkId: string
}) {
  if (!isUuid(checkId)) notFound()
  const [result, knowledge] = await Promise.all([
    getCheck(ctx.actor, { checkId }),
    knowledgeServices
      .getKnowledgeCheck(ctx.actor, { checkId, venueName: ctx.venue.name })
      .catch(() => null),
  ])
  if (!result.ok) return amenityFailed(ctx, result, "Amenity check")
  const detail = result.detail
  // An admin URL names its venue: a check from another venue is not here.
  if (detail.check.venueId !== ctx.venueId) notFound()
  const hrefs = amenityHrefs(ctx.basePath)
  const inScope =
    knowledge?.ok && knowledge.view.inScope ? knowledge.view : null
  const [policy, schedule] = inScope
    ? await Promise.all([
        policyContextFor(ctx, inScope.slot.key),
        upcomingFor(ctx, inScope),
      ])
    : [null, null]
  const [rechecks, oldFacts, corrections] = inScope
    ? await Promise.all([
        rechecksFor(ctx, inScope.slot.checkId),
        oldFactsFor(ctx),
        correctionsFor(ctx, inScope.slot.checkId),
      ])
    : [null, undefined, null]

  return (
    <AmenitiesFrame
      ctx={ctx}
      title={detail.check.entry.question}
      pendingReview={ctx.coverage?.summary.pendingReview}
    >
      <OfflineNotice loadedAt={new Date().toISOString()} />
      <div>
        <Link
          href={hrefs.list}
          className={buttonVariants({ variant: "row-link", size: "sm" })}
        >
          <ArrowLeftIcon aria-hidden />
          All amenities
        </Link>
      </div>
      {knowledge?.ok ? null : (
        // The legacy screen still works, but findings may be waiting (MG-03).
        <Notice tone="negative" role="alert">
          {TO_CONFIRM_COPY.failed}
        </Notice>
      )}
      <AmenityCheckControl
        detail={detail}
        basePath={ctx.basePath}
        canUpload={ctx.mode === "manager"}
        knowledge={
          // A failed knowledge read leaves the legacy screen: decisions need
          // the slot revision the server reads.
          inScope
        }
        policy={policy}
        schedule={schedule}
        rechecks={rechecks}
        oldFacts={oldFacts}
        corrections={corrections}
      />
    </AmenitiesFrame>
  )
}

/** `{basePath}/amenities/places` (B03 UI design §3.6). */
export function placesHref(basePath: string) {
  return `${basePath}/amenities/places`
}

/**
 * The venue's places, for its manager or an admin (B03 UI design §3.6).
 * Before the places migration the list isn't there, and the page says so.
 */
export async function PlacesScreen({ ctx }: { ctx: ManageContext }) {
  const result = await knowledgeServices.listPlaces(ctx.actor, {
    venueId: ctx.venueId,
  })
  const title = `Places at ${ctx.venue.name}`
  if (!result.ok) return amenityFailed(ctx, result as AmenityFailure, title)
  return (
    <AmenitiesFrame
      ctx={ctx}
      title={title}
      pendingReview={ctx.coverage?.summary.pendingReview}
    >
      <OfflineNotice loadedAt={new Date().toISOString()} />
      <div>
        <Link
          href={amenityHrefs(ctx.basePath).list}
          className={buttonVariants({ variant: "link", size: "sm" })}
        >
          <ArrowLeftIcon aria-hidden />
          All amenities
        </Link>
      </div>
      {result.places ? (
        <PlacesControl
          venueId={ctx.venueId}
          venueName={ctx.venue.name}
          places={result.places}
        />
      ) : (
        <Notice tone="plain">Places aren&apos;t available yet.</Notice>
      )}
    </AmenitiesFrame>
  )
}
