"use client"

import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import {
  ArrowUUpLeftIcon,
  CheckIcon,
  ListBulletsIcon,
} from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"
import * as React from "react"

import {
  decideAreaPhotoAction,
  loadAreaReviewAction,
} from "@/app/manager/area-actions"
import { loadReviewPageAction } from "@/app/manager/actions"
import { useReviewCount } from "@/components/nabalens/manager/review-count"
import { useDecision } from "@/components/nabalens/manager/review/use-decision"
import { EmptyState } from "@/components/nabalens/empty-state"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { FilterPill } from "@/components/ui/filter-pill"
import { LinkButton } from "@/components/ui/link-button"
import { Photo } from "@/components/ui/photo"
import { Textarea } from "@/components/ui/textarea"
import type { AreaPhotoCard } from "@/lib/server/area-photos"
import type { QueueCard } from "@/lib/server/menu-photos/types"
import { cn } from "@/lib/utils"

import { ALBUM_REVIEW_COPY as C } from "./copy"
import {
  conflictRevision,
  fromAreaCard,
  fromMenuCard,
  menuDecision,
  otherReason,
  REASON_MAX,
  REASONS,
  reviewLine,
  withRevision,
  type ReviewContext,
  type ReviewPhoto,
} from "./model"

/*
 * Review in a thumb (DESIGN.md §6.5, §5 Reason chips and Review bar). The
 * queue count is the page title. One photo on the stage with its slot name,
 * brief, author, time and place; Ask for another photo (secondary) and Keep
 * in the album (main) at the bottom (ia.md decision 3), pinned above the tab
 * bar on phones and at the foot of the details beside the photo from
 * bp-desktop (the 21 Nov handoff's Review figures). Ask for another photo
 * opens the reason sheet; choosing a reason and confirming sends the
 * decision with that reason and the next photo comes up. Decisions go
 * through the existing actions (decideMenuPhotoAction, decideAreaPhotoAction);
 * the database refuses a decision on the reviewer's own photo, and own
 * photos are never put on the stage.
 */

export type ThumbReviewProps = {
  venueName: string
  /** Waiting menu photos, the first page in the server's order. */
  menuCards: QueueCard[]
  /** The next menu page's cursor, if any. */
  menuCursor: string | null
  /** Waiting area photos, oldest first. */
  areaCards: AreaPhotoCard[]
  /**
   * The area read was a full page, so more may be waiting. The queue has no
   * cursor: it is re-read, oldest first, once the line runs low, and photos
   * already seen here are left out.
   */
  areaMore?: boolean
  /** Photos the caller can decide on across both queues (the title). */
  total: number
  /**
   * Menu section id to album place; slot id to its FA-52 brief; and, only
   * when that read failed, the album briefs by section and item id.
   */
  context: {
    sectionPlace: Record<string, string>
    slotBrief?: Record<string, string>
    sectionBrief: Record<string, string>
    itemBrief: Record<string, string>
  }
  /** The full list (filters, recheck, matches, decided photos). */
  listHref: string
  /** Under the title: the Findings / All switch when triage is on. */
  filter?: React.ReactNode
  /**
   * Photos that wait off the stage (Needs label, FA-4): counted in the title
   * and listed under it, so the empty notice does not say every photo is
   * reviewed while they wait (S3-R1 E4).
   */
  waitingElsewhere?: number
  /**
   * Menu slots still empty (the overview's count). An empty stage says how
   * many and offers Ask for missing photos, the next useful thing to do.
   */
  gaps?: number
  /** Album › Menu on Missing, where each gap has its Ask. */
  gapsHref?: string
  /** The zone times are written in. */
  timeZone?: string
}

type Mode = "bar" | "reasons"
type Choice = { kind: "accept" } | { kind: "ask"; reason: string }

const when = (iso: string, timeZone: string) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date)
}

function toContext(context: ThumbReviewProps["context"]): ReviewContext {
  return {
    sectionPlace: new Map(Object.entries(context.sectionPlace)),
    slotBrief: new Map(Object.entries(context.slotBrief ?? {})),
    sectionBrief: new Map(Object.entries(context.sectionBrief)),
    itemBrief: new Map(Object.entries(context.itemBrief)),
  }
}

export function ThumbReview({
  venueName,
  menuCards,
  menuCursor,
  areaCards,
  areaMore = false,
  total,
  context,
  listHref,
  filter,
  waitingElsewhere = 0,
  gaps = 0,
  gapsHref,
  timeZone = "Europe/London",
}: ThumbReviewProps) {
  const ctx = React.useMemo(() => toContext(context), [context])
  const [start] = React.useState(() => {
    const all = [
      ...menuCards.flatMap((c) => fromMenuCard(c, ctx) ?? []),
      ...areaCards.map((c) => fromAreaCard(c, ctx)),
    ]
    return {
      line: reviewLine(all),
      own: all.filter((p) => p.own).length,
    }
  })
  const [line, setLine] = React.useState(start.line)
  const [own, setOwn] = React.useState(start.own)
  const [remaining, setRemaining] = React.useState(
    Math.max(total, start.line.length)
  )
  const [cursor, setCursor] = React.useState(menuCursor)
  const [moreAreas, setMoreAreas] = React.useState(areaMore)
  // Every area photo key this screen has read, own and refused ones too, so
  // a re-read of the queue brings only photos not seen yet.
  const seenAreas = React.useRef<Set<string> | null>(null)
  seenAreas.current ??= new Set(areaCards.map((c) => fromAreaCard(c).key))
  const [loading, setLoading] = React.useState(false)
  const loadingRef = React.useRef(false)
  const areaLoadingRef = React.useRef(false)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [mode, setMode] = React.useState<Mode>("bar")
  // The chip chosen on the sheet, or "other"; sent only on its confirm.
  const [picked, setPicked] = React.useState<string | null>(null)
  const [other, setOther] = React.useState("")
  const [otherError, setOtherError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [refused, setRefused] = React.useState(false)
  const [said, setSaid] = React.useState<string | null>(null)

  const decide = useDecision("pending")
  const reviewCount = useReviewCount()
  const headingRef = React.useRef<HTMLHeadingElement>(null)
  const moved = React.useRef(false)
  const uid = React.useId()

  const current = line[0] ?? null
  // A dish photo to recheck may offer Keep in the album alone (the card
  // model's rule).
  const askable =
    current !== null &&
    (current.subject.kind === "area" || current.subject.askAgain)
  const shown = Math.max(remaining, line.length)

  // After a decision the next photo's name takes focus, so a keyboard or
  // screen-reader user lands on what they review next.
  React.useEffect(() => {
    if (!moved.current) return
    moved.current = false
    headingRef.current?.focus()
  }, [current?.key])

  async function loadMore() {
    void loadMoreAreas()
    // A ref, not state: two decisions in a row must not read the same page.
    if (!cursor || loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setLoadFailed(false)
    try {
      const page = await loadReviewPageAction({ status: "pending", cursor })
      if (!page.ok) {
        setLoadFailed(true)
        return
      }
      const fresh = page.items.flatMap((c) => fromMenuCard(c, ctx) ?? [])
      setOwn((n) => n + fresh.filter((p) => p.own).length)
      setLine((now) => {
        const known = new Set(now.map((p) => p.key))
        return [...now, ...reviewLine(fresh).filter((p) => !known.has(p.key))]
      })
      setCursor(page.nextCursor)
    } catch {
      setLoadFailed(true)
    } finally {
      loadingRef.current = false
      setLoading(areaLoadingRef.current)
    }
  }

  /** The next waiting area photos: the queue re-read, minus those seen. */
  async function loadMoreAreas() {
    if (!moreAreas || areaLoadingRef.current) return
    areaLoadingRef.current = true
    setLoading(true)
    setLoadFailed(false)
    try {
      const page = await loadAreaReviewAction({})
      if (!page.ok) {
        setLoadFailed(true)
        return
      }
      const seen = seenAreas.current!
      const fresh = page.cards
        .map((c) => fromAreaCard(c, ctx))
        .filter((p) => !seen.has(p.key))
      for (const p of fresh) seen.add(p.key)
      const decidableFresh = reviewLine(fresh)
      setOwn((n) => n + fresh.filter((p) => p.own).length)
      setRemaining((n) => n + decidableFresh.length)
      setLine((now) => {
        const known = new Set(now.map((p) => p.key))
        return [...now, ...decidableFresh.filter((p) => !known.has(p.key))]
      })
      setMoreAreas(page.more && fresh.length > 0)
    } catch {
      setLoadFailed(true)
    } finally {
      areaLoadingRef.current = false
      setLoading(loadingRef.current)
    }
  }

  function resetChoice() {
    setMode("bar")
    setPicked(null)
    setOther("")
    setOtherError(null)
    setError(null)
    setRefused(false)
  }

  /**
   * Takes `key` off the stage and brings up the next photo. An update
   * function, so a page that arrived while the decision was sending stays.
   */
  function advance(
    key: string,
    revise: (photos: ReviewPhoto[]) => ReviewPhoto[] = (photos) => photos
  ) {
    moved.current = true
    setLine((now) => revise(now.filter((p) => p.key !== key)))
    setRemaining((n) => Math.max(0, n - 1))
    resetChoice()
    if (line.length - 1 < 3) void loadMore()
  }

  async function send(choice: Choice) {
    if (!current || busy) return
    setBusy(true)
    setError(null)
    const key = current.key
    try {
      if (current.subject.kind === "dish") {
        const subject = current.subject
        const payload = menuDecision(subject, choice)
        if (!payload) return
        const result = await decide(payload)
        if (result.ok) {
          reviewCount.settle(-1)
          setSaid(
            choice.kind === "accept"
              ? C.accepted(current.name)
              : C.askedAgain(current.name, choice.reason)
          )
          const { itemId, itemRevision } = result.outcome
          advance(key, (photos) => withRevision(photos, itemId, itemRevision))
          return
        }
        if (result.code === "revision_conflict" && "current" in result) {
          const fresh = conflictRevision(subject, result.current)
          if (fresh !== null) {
            setLine((now) => withRevision(now, subject.itemId, fresh))
            setError(result.message)
            return
          }
        }
        if (
          result.code === "revision_conflict" ||
          result.code === "not_found" ||
          result.code === "state_conflict"
        ) {
          reviewCount.settle(-1)
          setSaid(C.goneElsewhere)
          advance(key)
          return
        }
        if (result.code === "not_permitted") {
          setRefused(true)
          setError(result.message || C.ownRefused)
          return
        }
        setError(result.message || C.failed)
        return
      }

      const result = await decideAreaPhotoAction({
        labelId: current.subject.labelId,
        decision: choice.kind === "accept" ? "accepted" : "needs_another_photo",
        reason: choice.kind === "ask" ? choice.reason : null,
      })
      if (result.ok) {
        setSaid(
          choice.kind === "accept"
            ? C.accepted(current.name)
            : C.askedAgain(current.name, choice.reason)
        )
        advance(key)
        return
      }
      if (result.code === "not_found" || result.code === "state_conflict") {
        setSaid(C.goneElsewhere)
        advance(key)
        return
      }
      if (result.code === "not_permitted") {
        setRefused(true)
        setError(result.message || C.ownRefused)
        return
      }
      setError(result.fieldErrors?.reason ?? (result.message || C.failed))
    } catch {
      setError(C.failed)
    } finally {
      setBusy(false)
    }
  }

  function skipRefused() {
    if (!current) return
    setOwn((n) => n + 1)
    advance(current.key)
  }

  const link =
    "inline-flex min-h-12 items-center gap-2 justify-self-start font-semibold text-accent-text underline underline-offset-4 focus-ring desktop:min-h-10"

  const decisions = refused ? (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      className="w-full"
      onClick={skipRefused}
    >
      {C.next}
    </Button>
  ) : mode === "bar" ? (
    // Phones: side by side from 400px, the primary last, nearest the thumb.
    // Desktop: stacked at the foot of the details, the primary first.
    <div className="grid gap-2 min-[25rem]:grid-cols-2 desktop:grid-cols-1">
      {askable ? (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={busy}
          onClick={() => setMode("reasons")}
        >
          <ArrowUUpLeftIcon aria-hidden />
          {C.askAgain}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="primary"
        size="lg"
        className={cn(
          "desktop:order-first",
          !askable && "min-[25rem]:col-span-2 desktop:col-span-1"
        )}
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => void send({ kind: "accept" })}
      >
        <CheckIcon aria-hidden />
        {busy ? C.sending : C.accept}
      </Button>
    </div>
  ) : current ? (
    <ReasonSheet
      uid={uid}
      author={current.author}
      name={current.name}
      busy={busy}
      picked={picked}
      other={other}
      otherError={otherError}
      onPick={(reason) => {
        setPicked(reason)
        setOtherError(null)
      }}
      onOtherChange={(value) => {
        setOther(value)
        setOtherError(null)
      }}
      onSend={() => {
        if (picked === null) {
          setOtherError(C.reasonsPick)
          return
        }
        if (picked !== OTHER) {
          void send({ kind: "ask", reason: picked })
          return
        }
        const reason = otherReason(other)
        if (!reason) {
          setOtherError(C.otherEmpty)
          return
        }
        void send({ kind: "ask", reason })
      }}
      onCancel={resetChoice}
    />
  ) : null

  return (
    <div className="grid gap-4">
      <PageHeader
        scope={venueName}
        venueScope
        title={C.title(shown)}
        className="pb-0 md:pb-0"
      />
      {filter}

      <p role="status" className="text-body text-ink empty:hidden">
        {said}
      </p>

      {current ? (
        <section
          aria-labelledby={`${uid}-name`}
          aria-roledescription={C.stageLabel}
          // v2 review: phones stack the photo over its details, and the
          // decision bar is pinned above the tab bar (room is kept for it
          // below); from bp-desktop the photo sits left and the details
          // right, the decisions at the details' foot whatever the photo's
          // height.
          className="grid items-start gap-4 max-desktop:pb-32 desktop:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]"
        >
          {/* `dark`: what sits on the stage reads the dark tokens, as
              media-viewer does (review Z5). The photo is never cropped. */}
          <div className="dark rounded-card bg-stage p-3 text-on-stage">
            {current.imageUrl ? (
              <Photo
                key={current.key}
                src={current.imageUrl}
                alt={C.photoAlt(current.name, current.author)}
                ratio="4/3"
                radius="control"
                eager
                className="bg-stage"
                imgClassName="object-contain"
                unavailableLabel={C.noPhoto}
              />
            ) : (
              <p className="grid aspect-4/3 place-items-center rounded-control px-4 text-center text-body">
                {C.noPhoto}
              </p>
            )}
          </div>

          <div className="grid gap-4 rounded-card bg-surface p-4 edge">
            {shown > 1 ? (
              <p className="text-meta text-ink-muted max-desktop:hidden">
                {C.more(shown - 1)}
              </p>
            ) : null}
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2
                  id={`${uid}-name`}
                  ref={headingRef}
                  tabIndex={-1}
                  className="text-heading break-words text-ink focus-ring"
                >
                  {current.name}
                </h2>
                <StatusChip state="outcome_waiting" />
              </div>
              <p className="text-body break-words text-ink-muted">
                {current.group}
                {current.brief ? (
                  <>
                    {` · ${C.askedFor}: “`}
                    <span>{current.brief}</span>”
                  </>
                ) : null}
              </p>
              <p className="font-mono text-mono font-semibold break-words text-ink-muted tabular-nums">
                {[
                  C.by(current.author),
                  when(current.addedAt, timeZone),
                  current.place,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {current.size ? (
                <p className="text-meta text-ink-muted max-desktop:hidden">
                  {`${C.sizeLabel} ${current.size}`}
                </p>
              ) : null}
            </div>
            {!current.own && current.subject.assetId ? (
              <Link
                href={managerHrefs.photo(current.subject.assetId)}
                data-review-details
                className={link}
              >
                {C.details}
              </Link>
            ) : null}

            <div
              data-slot="decision-bar"
              className="max-desktop:fixed max-desktop:inset-x-0 max-desktop:bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px))] max-desktop:z-dock max-desktop:max-h-[75dvh] max-desktop:overflow-y-auto max-desktop:bg-surface max-desktop:px-page-gutter max-desktop:py-3 max-desktop:shadow-bar md:max-desktop:bottom-0 md:max-desktop:px-6"
            >
              <div className="mx-auto grid w-full max-w-dialog-wide gap-3 desktop:max-w-none">
                {error ? (
                  <Notice tone="negative" role="alert">
                    {error}
                  </Notice>
                ) : null}
                {decisions}
              </div>
            </div>
          </div>
        </section>
      ) : cursor || moreAreas ? (
        <div className="grid gap-3">
          {loadFailed ? (
            <Notice tone="negative" role="alert">
              {C.moreFailed}
            </Notice>
          ) : null}
          <Button
            type="button"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={loading}
            aria-busy={loading || undefined}
            onClick={() => void loadMore()}
          >
            {C.moreRetry}
          </Button>
        </div>
      ) : waitingElsewhere > 0 ? null : (
        // Says what is true, then the next useful thing to do.
        <EmptyState
          title={C.emptyTitle}
          titleAs="h2"
          description={
            <p>{gaps > 0 && gapsHref ? C.emptyGaps(gaps) : C.emptyBody}</p>
          }
          action={
            gaps > 0 && gapsHref ? (
              <LinkButton href={gapsHref} variant="secondary">
                {C.askMissing}
              </LinkButton>
            ) : undefined
          }
        />
      )}

      {own > 0 ? (
        <p className="text-body text-ink-muted">{C.own(own)}</p>
      ) : null}

      <Link href={listHref} className={link}>
        <ListBulletsIcon aria-hidden className="size-5" />
        {C.allPhotos}
      </Link>
    </div>
  )
}

/** The "Other" pick: its own words, sent as the reason. */
const OTHER = "other"

/**
 * Ask for another photo (DESIGN.md §5 Reason chips; the handoff's sheet):
 * the existing reason chips and Other; choosing one and confirming is the
 * whole flow. The person who sent the photo reads the reason on the slot as
 * Retake. On phones it takes the decision bar's place, pinned above the tab
 * bar, so it opens as a sheet from the bottom edge.
 */
function ReasonSheet({
  uid,
  author,
  name,
  busy,
  picked,
  other,
  otherError,
  onPick,
  onOtherChange,
  onSend,
  onCancel,
}: {
  uid: string
  author: string
  name: string
  busy: boolean
  picked: string | null
  other: string
  otherError: string | null
  onPick: (reason: string) => void
  onOtherChange: (value: string) => void
  onSend: () => void
  onCancel: () => void
}) {
  return (
    <form
      className="grid gap-4"
      aria-labelledby={`${uid}-reasons`}
      // Our own words say what is missing, beside the field (§6.7).
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        onSend()
      }}
    >
      <div className="grid gap-1">
        <h3 id={`${uid}-reasons`} className="type-title text-ink">
          {C.reasonsHeading}
        </h3>
        <p className="text-meta text-ink-muted">{C.reasonsWho(author, name)}</p>
      </div>
      <div
        role="group"
        aria-labelledby={`${uid}-reasons`}
        className="flex flex-wrap gap-2"
      >
        {REASONS.map((reason) => (
          <FilterPill
            key={reason}
            type="button"
            selected={picked === reason}
            disabled={busy}
            onClick={() => onPick(reason)}
          >
            {reason}
          </FilterPill>
        ))}
        <FilterPill
          type="button"
          selected={picked === OTHER}
          disabled={busy}
          aria-controls={`${uid}-other`}
          onClick={() => onPick(OTHER)}
        >
          {C.other}
        </FilterPill>
      </div>
      {picked === OTHER ? (
        <div id={`${uid}-other`}>
          <FormField
            id={`${uid}-other-text`}
            label={C.otherLabel}
            error={otherError ?? undefined}
          >
            <Textarea
              value={other}
              rows={2}
              maxLength={REASON_MAX}
              autoFocus
              onChange={(event) => onOtherChange(event.currentTarget.value)}
            />
          </FormField>
        </div>
      ) : otherError ? (
        <p role="alert" className="text-meta text-warn-fg">
          {otherError}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={busy}
          onClick={onCancel}
        >
          {C.cancel}
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? C.sending : C.reasonsSend}
        </Button>
      </div>
    </form>
  )
}
