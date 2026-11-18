"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { decideMenuPhotoAction } from "@/app/manager/actions"
import {
  decideAmenityPhotoAction,
  decidePlacePhotoAction,
  fixSlotLabelAction,
  setAsidePhotoAction,
  setDishLevelAction,
  setSlotPrimaryAction,
} from "@/app/manager/review/actions"
import { EvidenceThumb } from "@/components/nabalens/coverage/evidence-image"
import { ReasonDialog } from "@/components/nabalens/coverage/reason-dialog"
import { RETAKE_REASONS } from "@/components/nabalens/album/review/model"
import { MetaList } from "@/components/nabalens/meta-list"
import { Notice } from "@/components/nabalens/notice"
import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { StatusChip } from "@/components/nabalens/status-chip"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { belowPublicQuality } from "@/lib/config/media"
import {
  duplicateTargets,
  hasLiveDecision,
  isSetAside,
  type DetailAmenity,
  type DetailDish,
  type DetailPlace,
  type PhotoDetail,
  type ThumbRef,
} from "@/lib/review/inbox"
import type { QueueCard } from "@/lib/server/menu-photos/types"
import { dishName } from "@/lib/menus/dish-name"

import { managerHrefs } from "../hrefs"
import {
  ItemPickerDialog,
  type PickedItem,
  type PickedSlot,
} from "./item-picker-dialog"
import { dayOf, historyWords, INBOX_COPY, takenWords } from "./inbox-copy"

const C = INBOX_COPY

/** Image routes the page signs per request, by asset. */
export type DetailImages = {
  main: { thumbnail: string | null; preview: string | null }
  /** Thumbnail route for every other asset the detail shows. */
  thumbs: Record<string, string>
}

type Failure = {
  ok: false
  code?: string
  message: string
  nextAction?: string
  latest?: {
    action: string | null
    level: string | null
    by: string | null
    at: string | null
  }
}
type Reply = { ok: true } | Failure

type Status =
  | { kind: "idle" }
  | { kind: "done"; text: string }
  | { kind: "error"; text: string }
  | { kind: "conflict"; latest: Failure["latest"] }

type AskTarget =
  | { kind: "dish"; dish: DetailDish }
  | { kind: "place"; place: DetailPlace }
  | { kind: "amenity"; amenity: DetailAmenity }

type ReasonTarget =
  | { kind: "not_used" }
  | { kind: "withdraw_dish"; dish: DetailDish }
  | { kind: "withdraw_place"; place: DetailPlace }
  | { kind: "withdraw_amenity"; amenity: DetailAmenity }
  | { kind: "not_used_place"; place: DetailPlace }
  | { kind: "not_used_amenity"; amenity: DetailAmenity }

// Fix label (spec §7 M2, AC15; S3-R13 X7, X8): from a dish label, decided
// or not, from a place or amenity, or from no label, to a menu item, place
// or amenity, in one picker.
type FixTarget =
  | { kind: "relink"; dish: DetailDish }
  | { kind: "assign_unlabelled" }
  | { kind: "assign_stale"; dish: DetailDish }
  | { kind: "place"; place: DetailPlace }
  | { kind: "amenity"; amenity: DetailAmenity }

/** Where the photo is now, as review_fix_label names it. */
function fixSource(f: FixTarget) {
  switch (f.kind) {
    case "relink":
    case "assign_stale":
      return {
        fromKind: "dish",
        fromId: f.dish.itemId,
        fromVariantId: f.dish.variantId,
        expectedRevision: f.dish.itemRevision,
      }
    case "place":
      return { fromKind: "area", fromId: f.place.labelId }
    case "amenity":
      return { fromKind: "amenity", fromId: f.amenity.checkId }
    case "assign_unlabelled":
      return { fromKind: "none" }
  }
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`

/** The minimal card the item picker shows (who took it, the thumbnail). */
function pickerCard(detail: PhotoDetail, thumb: string | null): QueueCard {
  return {
    key: detail.assetId,
    kind: "unlabelled",
    labelId: null,
    photoId: null,
    asset: {
      assetId: detail.assetId,
      thumbnailUrl: thumb,
      previewUrl: null,
      width: detail.width,
      height: detail.height,
    },
    uploadedAt: detail.uploadedAt,
    labelledAt: null,
    contributor: {
      id: detail.contributor.id,
      name: detail.contributor.name,
      status: "here",
      canFollowUp: true,
    },
    isSelf: detail.isSelf,
    selfReviewAllowed: !detail.selfBlocked,
    item: null,
    staffLabels: [],
    state: null,
    isPrimary: false,
    isEffectivePrimary: false,
    basis: null,
    reason: null,
    recheckKind: null,
    correctsItemId: null,
    correctsVariantId: null,
    correctsItemName: null,
    itemRevision: 0,
    groupCount: 0,
  }
}

/** A dish row's state chip words. */
function dishState(d: DetailDish): string {
  if (d.state === "accepted")
    return d.level === "reference" ? C.state.reference! : C.state.accepted!
  if (d.state) return C.state[d.state] ?? d.state
  return d.waiting ? C.state.pending! : C.state.withdrawn!
}

function slotState(s: { state: string; level: string }): string {
  if (s.state === "accepted")
    return s.level === "reference" ? C.state.reference! : C.state.accepted!
  return C.state[s.state] ?? s.state
}

function Compare({
  photos,
  thumbs,
}: {
  photos: ThumbRef[]
  thumbs: Record<string, string>
}) {
  if (photos.length === 0)
    return <p className="text-meta text-ink-muted">{C.compareNone}</p>
  return (
    <ul aria-label={C.compare} className="flex flex-wrap gap-2">
      {photos.map((p) => (
        <li key={p.assetId} className="grid justify-items-start gap-1">
          <EvidenceThumb
            src={thumbs[p.assetId] ?? null}
            className="aspect-square w-20 rounded-control"
          />
          {p.isPrimary ? (
            <span className="text-meta text-ink-muted">{C.primary}</span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * One photo's review (spec §7 M2): provenance (who, when uploaded, when
 * taken or "unknown", size), the group it was sent with, the staff note,
 * possible duplicates, every slot it is for with what is already in the album
 * to compare, the history, and the decisions: Approve for public use, Keep as
 * reference, Ask for another photo (the spec's reasons), Fix label (accepts
 * for the right menu item, place or amenity in the same step, whatever was
 * decided on the old label), Select primary, Withdraw, Mark
 * duplicate, Not used and Use again. Every decision is made against the
 * version the screen shows; a newer decision by someone else is shown, never
 * overwritten.
 */
export function InboxPhotoDetail({
  detail,
  images,
  venueId,
}: {
  detail: PhotoDetail
  images: DetailImages
  /** Admins name the venue on every decision. */
  venueId?: string
}) {
  const router = useRouter()
  const sessionEnded = useSessionEndedCatch()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<Status>({ kind: "idle" })
  const [ask, setAsk] = React.useState<AskTarget | null>(null)
  const [reasonFor, setReasonFor] = React.useState<ReasonTarget | null>(null)
  const [fix, setFix] = React.useState<FixTarget | null>(null)
  const [dupOpen, setDupOpen] = React.useState(false)
  const statusRef = React.useRef<HTMLDivElement>(null)

  const blocked = detail.selfBlocked
  const setAside = isSetAside(detail)
  const live = hasLiveDecision(detail)
  const targets = duplicateTargets(detail)
  const v = venueId ? { venueId } : {}

  async function run(key: string, call: () => Promise<Reply>): Promise<Reply> {
    setBusy(key)
    setStatus({ kind: "idle" })
    try {
      const reply = await call()
      if (reply.ok) {
        setStatus({ kind: "done", text: C.done })
        router.refresh()
      } else if (
        reply.code === "stale_version" ||
        reply.code === "revision_conflict"
      ) {
        setStatus({ kind: "conflict", latest: reply.latest })
        router.refresh()
      } else {
        setStatus({
          kind: "error",
          text: [reply.message, reply.nextAction].filter(Boolean).join(" "),
        })
      }
      return reply
    } catch (cause) {
      const text = sessionEnded(cause) ?? C.failed
      setStatus({ kind: "error", text })
      return { ok: false, message: text }
    } finally {
      setBusy(null)
      requestAnimationFrame(() => statusRef.current?.focus())
    }
  }

  const asReason = async (reply: Reply) =>
    reply.ok
      ? ({ ok: true } as const)
      : ({ ok: false, error: reply.message } as const)

  // ---- Dish decisions --------------------------------------------------------
  const dishLevel = (d: DetailDish, level: "public" | "reference") =>
    run(`dish:${d.itemId}:${level}`, () =>
      setDishLevelAction({
        ...v,
        assetId: detail.assetId,
        itemId: d.itemId,
        variantId: d.variantId,
        level,
        expectedRevision: d.itemRevision,
        requestKey: newId(),
      })
    )

  const menuDecision = (
    key: string,
    payload: Record<string, unknown>
  ): Promise<Reply> =>
    run(key, async () => {
      const r = await decideMenuPhotoAction(
        { ...v, requestId: newId(), ...payload },
        { status: "all" }
      )
      return r.ok
        ? { ok: true }
        : { ok: false, code: r.code, message: r.message }
    })

  // ---- Place and amenity decisions ------------------------------------------
  const placeDecision = (
    p: DetailPlace,
    action: string,
    level?: "public" | "reference",
    reason?: string
  ) =>
    run(`place:${p.labelId}:${action}:${level ?? ""}`, () =>
      decidePlacePhotoAction({
        ...v,
        labelId: p.labelId,
        action,
        level,
        reason,
        expectedDecisionId: p.decisionId,
      })
    )
  const amenityDecision = (
    a: DetailAmenity,
    action: string,
    level?: "public" | "reference",
    reason?: string
  ) =>
    run(`amenity:${a.checkId}:${action}:${level ?? ""}`, () =>
      decideAmenityPhotoAction({
        ...v,
        checkId: a.checkId,
        assetId: detail.assetId,
        action,
        level,
        reason,
        expectedDecisionId: a.decisionId,
      })
    )
  const slotPrimary = (kind: "area" | "amenity", slotId: string) =>
    run(`primary:${slotId}`, () =>
      setSlotPrimaryAction({
        ...v,
        slotKind: kind,
        slotId,
        assetId: detail.assetId,
      })
    )

  // ---- Photo decisions -------------------------------------------------------
  const setAsideCall = (
    action: "not_used" | "duplicate" | "restored",
    extra: { reason?: string; reasonCode?: string; duplicateOf?: string } = {}
  ) =>
    run(`photo:${action}`, () =>
      setAsidePhotoAction({
        ...v,
        assetId: detail.assetId,
        action,
        expectedDispositionId: detail.disposition?.id ?? null,
        ...extra,
      })
    )

  const disabled = busy !== null
  const levelButtons = (
    keyBase: string,
    onLevel: (level: "public" | "reference") => void,
    current: { state: string | null; level: string | null }
  ) => {
    const accepted = current.state === "accepted"
    return (
      <>
        {!accepted || current.level === "reference" ? (
          <Button
            type="button"
            variant="primary"
            disabled={disabled}
            aria-busy={busy === `${keyBase}:public` || undefined}
            data-review-action="approve"
            onClick={() => onLevel("public")}
          >
            {busy === `${keyBase}:public` ? C.saving : C.approve}
          </Button>
        ) : null}
        {!accepted || current.level !== "reference" ? (
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            aria-busy={busy === `${keyBase}:reference` || undefined}
            data-review-action="keep-reference"
            onClick={() => onLevel("reference")}
          >
            {busy === `${keyBase}:reference` ? C.saving : C.keepReference}
          </Button>
        ) : null}
      </>
    )
  }

  const mainThumb = images.main.preview ?? images.main.thumbnail
  const small = belowPublicQuality(detail.width, detail.height)
  const staleOnly =
    !detail.needsLabel &&
    detail.dishes.length > 0 &&
    detail.dishes.every((d) => !d.onMenu && d.state === null)

  return (
    <div className="@container grid gap-6">
      <div
        ref={statusRef}
        tabIndex={-1}
        aria-live="polite"
        className="grid gap-2 outline-none empty:hidden"
      >
        {status.kind === "done" ? (
          <Notice tone="positive">{status.text}</Notice>
        ) : null}
        {status.kind === "error" ? (
          <Notice tone="negative" role="alert">
            {status.text}
          </Notice>
        ) : null}
        {status.kind === "conflict" ? (
          <Notice tone="attention" title={C.conflictTitle} role="alert">
            {status.latest?.action ? (
              <p>
                {C.conflictLatest(
                  historyWords(status.latest.action, status.latest.level),
                  status.latest.by,
                  status.latest.at ? dayOf(status.latest.at) : null
                )}
              </p>
            ) : null}
            <p>{C.conflictBody}</p>
          </Notice>
        ) : null}
      </div>

      <section
        aria-labelledby="review-photo-provenance"
        className="grid gap-4 @wide:grid-cols-[minmax(0,360px)_minmax(0,1fr)]"
      >
        <EvidenceThumb src={mainThumb} className="w-full rounded-card" />
        <div className="grid content-start gap-3">
          <h2
            id="review-photo-provenance"
            className="type-section-title text-ink"
          >
            {C.provenance}
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {detail.needsLabel ? (
              <StatusChip tone="attention">{C.needsLabel}</StatusChip>
            ) : null}
            {detail.possibleDuplicates.length > 0 ||
            detail.duplicateOfAssetId ? (
              <StatusChip tone="attention">{C.possibleDuplicate}</StatusChip>
            ) : null}
            {small ? (
              <StatusChip tone="neutral">{C.belowPublic}</StatusChip>
            ) : null}
          </div>
          <MetaList
            items={[
              {
                label: C.contributor,
                value: (
                  <span data-review-contributor>{detail.contributor.name}</span>
                ),
              },
              { label: C.uploaded, value: dayOf(detail.uploadedAt) },
              {
                label: C.provenance,
                labelHidden: true,
                value: (
                  <span data-review-taken>
                    {takenWords(detail.capturedAt, detail.capturedAtSource)}
                  </span>
                ),
              },
              {
                label: C.size,
                value:
                  detail.width && detail.height
                    ? C.sizeWords(detail.width, detail.height)
                    : C.sizeUnknown,
              },
              {
                label: C.note,
                value: (
                  <span data-review-note>{detail.note ?? C.noteNone}</span>
                ),
              },
            ]}
          />
          {small ? (
            <p className="text-meta text-ink-muted">{C.belowPublicHelp}</p>
          ) : null}
          {blocked ? <Notice tone="plain">{C.ownPhoto}</Notice> : null}
        </div>
      </section>

      {setAside && detail.disposition ? (
        <Notice
          tone="info"
          title={
            detail.disposition.action === "duplicate"
              ? C.setAside.duplicate(
                  detail.disposition.by,
                  dayOf(detail.disposition.at)
                )
              : C.setAside.not_used(
                  detail.disposition.by,
                  dayOf(detail.disposition.at)
                )
          }
          action={
            blocked ? undefined : (
              <Button
                type="button"
                variant="secondary"
                disabled={disabled}
                data-review-action="restore"
                onClick={() => void setAsideCall("restored")}
              >
                {busy === "photo:restored" ? C.saving : C.restore}
              </Button>
            )
          }
        >
          {detail.disposition.reason ? (
            <p>{detail.disposition.reason}</p>
          ) : null}
        </Notice>
      ) : null}

      <section aria-labelledby="review-photo-slots" className="grid gap-3">
        <h2 id="review-photo-slots" className="type-section-title text-ink">
          {C.slots}
        </h2>
        {detail.dishes.length === 0 &&
        detail.places.length === 0 &&
        detail.amenities.length === 0 ? (
          <p className="text-body text-ink-muted">{C.noSlots}</p>
        ) : null}
        <ul className="grid gap-3">
          {detail.dishes.map((d) => {
            const key = `dish:${d.itemId}`
            const canDecide = !blocked && !setAside && d.onMenu
            const decided = d.state !== null
            // X7: a staff label can be fixed whatever was decided on it,
            // unless a live correction already stands.
            const fixable = d.staffLabel && !d.relinked
            return (
              <li
                key={`${d.itemId}:${d.variantId ?? ""}`}
                className="grid gap-2 rounded-card bg-surface p-4 edge"
                data-review-slot="dish"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-meta text-ink-muted">{C.dishSlot}</span>
                  <StatusChip
                    tone={d.state === "accepted" ? "positive" : "pending"}
                  >
                    {dishState(d)}
                  </StatusChip>
                  {d.isPrimary ? (
                    <StatusChip tone="neutral">{C.primary}</StatusChip>
                  ) : null}
                </div>
                <h3 className="text-item-title break-words text-ink">
                  {dishName({ name: d.itemName, variantName: d.variantName })}
                </h3>
                <p className="text-meta text-ink-muted">
                  {[
                    d.sectionName,
                    d.presentationRevision > 1
                      ? C.presentation(
                          d.presentationRevision,
                          d.presentationNote
                        )
                      : null,
                    d.neededBy ? C.neededByDay(dayOf(d.neededBy)) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <Compare photos={d.publicPhotos} thumbs={images.thumbs} />
                {canDecide && (d.waiting || decided || fixable) ? (
                  <div className="mt-1 flex flex-wrap gap-2 border-t border-line pt-3 @max-wide:*:flex-auto">
                    {d.waiting ||
                    d.state === "better_photo_requested" ||
                    d.state === "accepted"
                      ? levelButtons(
                          key,
                          (level) => void dishLevel(d, level),
                          d
                        )
                      : null}
                    {d.waiting && d.staffLabel && d.basis !== "reviewer" ? (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={disabled}
                        data-review-action="ask-another"
                        onClick={() => setAsk({ kind: "dish", dish: d })}
                      >
                        {C.askAnother}
                      </Button>
                    ) : null}
                    {fixable ? (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={disabled}
                        data-review-action="fix-label"
                        onClick={() => setFix({ kind: "relink", dish: d })}
                      >
                        {C.fixLabel}
                      </Button>
                    ) : null}
                    {d.state === "accepted" &&
                    d.level === "public" &&
                    !d.isPrimary &&
                    d.photoId ? (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={disabled}
                        data-review-action="primary"
                        onClick={() =>
                          void menuDecision(`dish:${d.itemId}:primary`, {
                            action: "set_preferred",
                            assetId: detail.assetId,
                            itemId: d.itemId,
                            variantId: d.variantId,
                            photoId: d.photoId,
                            expectedRevision: d.itemRevision,
                          })
                        }
                      >
                        {C.primary}
                      </Button>
                    ) : null}
                    {decided && d.photoId ? (
                      <Button
                        type="button"
                        variant="danger-quiet"
                        disabled={disabled}
                        data-review-action="withdraw"
                        onClick={() =>
                          setReasonFor({ kind: "withdraw_dish", dish: d })
                        }
                      >
                        {C.withdraw}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
          {detail.places.map((p) => (
            <SlotRow
              key={p.labelId}
              kindLabel={C.placeSlot}
              title={p.name}
              slot={p}
              thumbs={images.thumbs}
              canDecide={!blocked && !setAside}
              disabled={disabled}
              busy={busy}
              keyBase={`place:${p.labelId}`}
              levelButtons={levelButtons}
              onLevel={(level) => void placeDecision(p, "accepted", level)}
              onAsk={() => setAsk({ kind: "place", place: p })}
              onNotUsed={() =>
                setReasonFor({ kind: "not_used_place", place: p })
              }
              onWithdraw={() =>
                setReasonFor({ kind: "withdraw_place", place: p })
              }
              onPrimary={() => void slotPrimary("area", p.subjectId)}
              onFix={() => setFix({ kind: "place", place: p })}
            />
          ))}
          {detail.amenities.map((a) => (
            <SlotRow
              key={a.checkId}
              kindLabel={C.amenitySlot}
              title={a.question}
              slot={a}
              thumbs={images.thumbs}
              canDecide={!blocked && !setAside}
              disabled={disabled}
              busy={busy}
              keyBase={`amenity:${a.checkId}`}
              levelButtons={levelButtons}
              onLevel={(level) => void amenityDecision(a, "accepted", level)}
              onAsk={() => setAsk({ kind: "amenity", amenity: a })}
              onNotUsed={() =>
                setReasonFor({ kind: "not_used_amenity", amenity: a })
              }
              onWithdraw={() =>
                setReasonFor({ kind: "withdraw_amenity", amenity: a })
              }
              onPrimary={() => void slotPrimary("amenity", a.checkId)}
              onFix={() => setFix({ kind: "amenity", amenity: a })}
            />
          ))}
        </ul>
        {!blocked && !setAside && (detail.needsLabel || staleOnly) ? (
          <div className="grid gap-2">
            <p className="text-body text-ink-muted">{C.fixLabelHelp}</p>
            <Button
              type="button"
              variant="primary"
              disabled={disabled}
              data-review-action="fix-label"
              className="justify-self-start"
              onClick={() =>
                setFix(
                  staleOnly
                    ? { kind: "assign_stale", dish: detail.dishes[0]! }
                    : { kind: "assign_unlabelled" }
                )
              }
            >
              {C.fixLabel}
            </Button>
          </div>
        ) : null}
      </section>

      {!blocked && !setAside ? (
        <section aria-labelledby="review-photo-whole" className="grid gap-2">
          <h2 id="review-photo-whole" className="sr-only">
            {C.notUsed}
          </h2>
          {live ? (
            <p className="text-meta text-ink-muted">{C.withdrawFirst}</p>
          ) : null}
          <div className="flex flex-wrap gap-2 @max-wide:*:flex-auto">
            <Button
              type="button"
              variant="secondary"
              disabled={disabled || live}
              data-review-action="mark-duplicate"
              onClick={() => setDupOpen(true)}
            >
              {C.markDuplicate}
            </Button>
            <Button
              type="button"
              variant="danger-quiet"
              disabled={disabled || live}
              data-review-action="not-used"
              onClick={() => setReasonFor({ kind: "not_used" })}
            >
              {C.notUsed}
            </Button>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="review-photo-group" className="grid gap-2">
        <h2 id="review-photo-group" className="type-section-title text-ink">
          {C.group}
        </h2>
        {detail.group.length === 0 ? (
          <p className="text-meta text-ink-muted">{C.groupNone}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {detail.group.map((g) => (
              <li key={g.assetId}>
                <Link
                  href={
                    venueId
                      ? managerHrefs.adminPhoto(venueId, g.assetId)
                      : managerHrefs.photo(g.assetId)
                  }
                  aria-label={`${C.details} ${dayOf(g.uploadedAt ?? detail.uploadedAt)}`}
                  className="block rounded-control focus-ring outline-none"
                >
                  <EvidenceThumb
                    src={images.thumbs[g.assetId] ?? null}
                    className="aspect-square w-20 rounded-control"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {detail.possibleDuplicates.length > 0 ? (
          <>
            <h3 className="text-label text-ink">{C.sameFile}</h3>
            <Compare
              photos={detail.possibleDuplicates}
              thumbs={images.thumbs}
            />
          </>
        ) : null}
      </section>

      <section aria-labelledby="review-photo-history" className="grid gap-2">
        <h2 id="review-photo-history" className="type-section-title text-ink">
          {C.history}
        </h2>
        {detail.history.length === 0 ? (
          <p className="text-meta text-ink-muted">{C.historyNone}</p>
        ) : (
          <ol className="grid gap-2" data-review-history>
            {detail.history.map((h, i) => (
              <li key={`${h.at}-${i}`} className="text-body text-ink">
                <span className="font-semibold">
                  {historyWords(h.action, h.level)}
                </span>
                {h.subject ? ` · ${h.subject}` : ""}
                <span className="text-meta text-ink-muted">
                  {" "}
                  · {[h.by, dayOf(h.at)].filter(Boolean).join(", ")}
                </span>
                {h.reason ? (
                  <span className="block break-words text-ink-muted">
                    {h.reason}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <AskDialog
        key={
          ask
            ? `${ask.kind}:${"dish" in ask ? ask.dish.itemId : "place" in ask ? ask.place.labelId : ask.amenity.checkId}`
            : "closed"
        }
        target={ask}
        onClose={() => setAsk(null)}
        busy={disabled}
        onSend={async (reason) => {
          if (!ask) return { ok: false, message: C.reasonRequired }
          if (ask.kind === "dish")
            return menuDecision(`dish:${ask.dish.itemId}:ask`, {
              action: "ask_another",
              assetId: detail.assetId,
              itemId: ask.dish.itemId,
              variantId: ask.dish.variantId,
              expectedRevision: ask.dish.itemRevision,
              reason,
            })
          if (ask.kind === "place")
            return placeDecision(
              ask.place,
              "needs_another_photo",
              undefined,
              reason
            )
          return amenityDecision(
            ask.amenity,
            "needs_another_photo",
            undefined,
            reason
          )
        }}
      />

      <ReasonDialog
        open={reasonFor !== null}
        onOpenChange={(open) => {
          if (!open) setReasonFor(null)
        }}
        title={
          reasonFor?.kind.startsWith("withdraw")
            ? C.withdrawTitle
            : C.notUsedTitle
        }
        label={
          reasonFor?.kind.startsWith("withdraw")
            ? C.withdrawLabel
            : C.notUsedLabel
        }
        help={reasonFor?.kind === "not_used" ? C.notUsedHelp : undefined}
        confirmLabel={
          reasonFor?.kind.startsWith("withdraw") ? C.withdraw : C.notUsed
        }
        pendingLabel={C.saving}
        destructive
        onConfirm={async (reason) => {
          const t = reasonFor
          if (!t) return { ok: false, error: C.reasonRequired }
          switch (t.kind) {
            case "not_used":
              return asReason(await setAsideCall("not_used", { reason }))
            case "withdraw_dish":
              return asReason(
                await menuDecision(`dish:${t.dish.itemId}:withdraw`, {
                  action: "withdraw",
                  assetId: detail.assetId,
                  itemId: t.dish.itemId,
                  variantId: t.dish.variantId,
                  photoId: t.dish.photoId,
                  expectedRevision: t.dish.itemRevision,
                  reason,
                })
              )
            case "withdraw_place":
              return asReason(
                await placeDecision(t.place, "withdrawn", undefined, reason)
              )
            case "not_used_place":
              return asReason(
                await placeDecision(t.place, "not_used", undefined, reason)
              )
            case "withdraw_amenity":
              return asReason(
                await amenityDecision(t.amenity, "withdrawn", undefined, reason)
              )
            case "not_used_amenity":
              return asReason(
                await amenityDecision(t.amenity, "not_used", undefined, reason)
              )
          }
        }}
      />

      <DuplicateDialog
        key={dupOpen ? "open" : "closed"}
        open={dupOpen}
        onOpenChange={setDupOpen}
        targets={targets}
        thumbs={images.thumbs}
        busy={disabled}
        onConfirm={(target) =>
          setAsideCall("duplicate", {
            duplicateOf: target,
            reasonCode: "duplicate",
          })
        }
      />

      <ItemPickerDialog
        open={fix !== null}
        onOpenChange={(open) => {
          if (!open) setFix(null)
        }}
        card={pickerCard(detail, images.main.thumbnail)}
        title={C.fixLabel}
        reasonLabel={
          fix?.kind === "place" || fix?.kind === "amenity"
            ? C.fixLabelReason
            : "Why is the staff label wrong?"
        }
        reasonRequired={fix !== null && fix.kind !== "assign_unlabelled"}
        emptyReason={
          fix?.kind === "place" || fix?.kind === "amenity"
            ? C.fixLabelReasonEmpty
            : "Say why the staff label is wrong."
        }
        excluded={
          fix?.kind === "relink"
            ? { itemId: fix.dish.itemId, variantId: fix.dish.variantId }
            : null
        }
        excludedSlot={
          fix?.kind === "place"
            ? { kind: "area", id: fix.place.subjectId }
            : fix?.kind === "amenity"
              ? { kind: "amenity", id: fix.amenity.checkId }
              : null
        }
        venueId={venueId}
        onConfirm={async (target: PickedItem, reason: string) => {
          const f = fix
          if (!f) return { ok: false, error: C.reasonRequired }
          // Off a place or an amenity onto a dish: one database step.
          if (f.kind === "place" || f.kind === "amenity")
            return asReason(
              await run(`fix:${target.itemId}`, () =>
                fixSlotLabelAction({
                  ...v,
                  assetId: detail.assetId,
                  ...fixSource(f),
                  toKind: "dish",
                  toId: target.itemId,
                  toVariantId: target.variantId,
                  expectedRevision: target.itemRevision,
                  reason,
                })
              )
            )
          const corrects =
            f.kind === "assign_unlabelled"
              ? {}
              : {
                  correctsItemId: f.dish.itemId,
                  correctsVariantId: f.dish.variantId,
                }
          return asReason(
            await menuDecision(`fix:${target.itemId}`, {
              action: f.kind,
              assetId: detail.assetId,
              itemId: target.itemId,
              variantId: target.variantId,
              expectedRevision: target.itemRevision,
              ...(reason ? { reason } : {}),
              ...corrects,
            })
          )
        }}
        onConfirmSlot={async (target: PickedSlot, reason: string) => {
          const f = fix
          if (!f) return { ok: false, error: C.reasonRequired }
          return asReason(
            await run(`fix:${target.id}`, () =>
              fixSlotLabelAction({
                ...v,
                assetId: detail.assetId,
                ...fixSource(f),
                toKind: target.kind,
                toId: target.id,
                ...(reason ? { reason } : {}),
              })
            )
          )
        }}
      />
    </div>
  )
}

/** A place or amenity slot of the photo, with its decisions. */
function SlotRow({
  kindLabel,
  title,
  slot,
  thumbs,
  canDecide,
  disabled,
  busy,
  keyBase,
  levelButtons,
  onLevel,
  onAsk,
  onNotUsed,
  onWithdraw,
  onPrimary,
  onFix,
}: {
  kindLabel: string
  title: string
  slot: DetailPlace | DetailAmenity
  thumbs: Record<string, string>
  canDecide: boolean
  disabled: boolean
  busy: string | null
  keyBase: string
  levelButtons: (
    keyBase: string,
    onLevel: (level: "public" | "reference") => void,
    current: { state: string | null; level: string | null }
  ) => React.ReactNode
  onLevel: (level: "public" | "reference") => void
  onAsk: () => void
  onNotUsed: () => void
  onWithdraw: () => void
  onPrimary: () => void
  /** Fix label: move the photo to the right slot (S3-R13 X8). */
  onFix: () => void
}) {
  const s = slot.state
  return (
    <li
      className="grid gap-2 rounded-card bg-surface p-4 edge"
      data-review-slot={kindLabel.toLowerCase()}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-meta text-ink-muted">{kindLabel}</span>
        <StatusChip tone={s === "accepted" ? "positive" : "pending"}>
          {slotState(slot)}
        </StatusChip>
        {slot.isPrimary ? (
          <StatusChip tone="neutral">{C.primary}</StatusChip>
        ) : null}
      </div>
      <h3 className="text-item-title break-words text-ink">{title}</h3>
      <Compare photos={slot.publicPhotos} thumbs={thumbs} />
      {canDecide ? (
        <div className="mt-1 flex flex-wrap gap-2 border-t border-line pt-3 @max-wide:*:flex-auto">
          {s !== "withdrawn"
            ? levelButtons(keyBase, onLevel, { state: s, level: slot.level })
            : null}
          {s === "pending" ? (
            <Button
              type="button"
              variant="secondary"
              disabled={disabled}
              data-review-action="ask-another"
              onClick={onAsk}
            >
              {C.askAnother}
            </Button>
          ) : null}
          {s === "accepted" && slot.level === "public" && !slot.isPrimary ? (
            <Button
              type="button"
              variant="secondary"
              disabled={disabled}
              aria-busy={busy?.startsWith("primary:") || undefined}
              data-review-action="primary"
              onClick={onPrimary}
            >
              {C.primary}
            </Button>
          ) : null}
          {s === "pending" || s === "needs_another_photo" ? (
            <Button
              type="button"
              variant="danger-quiet"
              disabled={disabled}
              data-review-action="not-used"
              onClick={onNotUsed}
            >
              {C.notUsed}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            data-review-action="fix-label"
            onClick={onFix}
          >
            {C.fixLabel}
          </Button>
          {s === "accepted" ? (
            <Button
              type="button"
              variant="danger-quiet"
              disabled={disabled}
              data-review-action="withdraw"
              onClick={onWithdraw}
            >
              {C.withdraw}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/**
 * Ask for another photo: the spec's reasons as chips (DESIGN.md §5 Reason
 * chips), one at most, plus an optional short note. A written note alone is
 * a reason too.
 */
function AskDialog({
  target,
  onClose,
  busy,
  onSend,
}: {
  target: AskTarget | null
  onClose: () => void
  busy: boolean
  onSend: (reason: string) => Promise<Reply>
}) {
  const id = React.useId()
  const [chosen, setChosen] = React.useState<string | null>(null)
  const [note, setNote] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const reasons = RETAKE_REASONS.filter(
    (r) => target?.kind === "place" || r.code !== "route_not_shown"
  )
  const title =
    target?.kind === "dish"
      ? target.dish.itemName
      : target?.kind === "place"
        ? target.place.name
        : (target?.amenity.question ?? "")
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`${C.askAnother}: ${title}`}</DialogTitle>
          <DialogDescription>{C.reasonsLabel}</DialogDescription>
        </DialogHeader>
        <div
          role="group"
          aria-label={C.reasonsLabel}
          className="flex flex-wrap gap-2"
        >
          {reasons.map((r) => (
            <Button
              key={r.code}
              type="button"
              variant={chosen === r.words ? "primary" : "secondary"}
              aria-pressed={chosen === r.words}
              data-reason-code={r.code}
              // D2 (S3-E2E-2): a long reason wraps inside the dialog at 320px
              // instead of pushing it wider than the screen.
              className="max-w-full"
              onClick={() => setChosen(chosen === r.words ? null : r.words)}
            >
              {r.words}
            </Button>
          ))}
        </div>
        <label htmlFor={`${id}-note`} className="text-label text-ink">
          {C.reasonNote}
        </label>
        <textarea
          id={`${id}-note`}
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-20 w-full min-w-0 rounded-control border border-line bg-surface p-3 text-body text-ink focus-ring outline-none"
        />
        {error ? (
          <p role="alert" className="text-body font-semibold text-warn-fg">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="quiet" onClick={onClose}>
            {C.cancel}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            data-review-action="send-ask"
            onClick={async () => {
              const words = [chosen, note.trim() || null]
                .filter(Boolean)
                .join(". ")
              if (!words) {
                setError(C.reasonRequired)
                return
              }
              const reply = await onSend(words)
              if (reply.ok) onClose()
              else setError(reply.message)
            }}
          >
            {busy ? C.saving : C.askAnother}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Mark duplicate: choose the accepted photo this one repeats. */
function DuplicateDialog({
  open,
  onOpenChange,
  targets,
  thumbs,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  targets: ThumbRef[]
  thumbs: Record<string, string>
  busy: boolean
  onConfirm: (assetId: string) => Promise<Reply>
}) {
  const [picked, setPicked] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{C.duplicateTitle}</DialogTitle>
          <DialogDescription>
            {targets.length > 0 ? C.duplicateHelp : C.duplicateNone}
          </DialogDescription>
        </DialogHeader>
        {targets.length > 0 ? (
          <ul
            role="radiogroup"
            aria-label={C.compare}
            className="flex flex-wrap gap-2"
          >
            {targets.map((t, i) => (
              <li key={t.assetId}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={picked === t.assetId}
                  aria-label={`${C.compare} ${i + 1}`}
                  data-duplicate-target={t.assetId}
                  onClick={() => setPicked(t.assetId)}
                  className={buttonVariants({
                    variant: picked === t.assetId ? "primary" : "secondary",
                    className: "h-auto p-1",
                  })}
                >
                  <EvidenceThumb
                    src={thumbs[t.assetId] ?? null}
                    className="aspect-square w-20 rounded-control"
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <p role="alert" className="text-body font-semibold text-warn-fg">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="quiet"
            onClick={() => onOpenChange(false)}
          >
            {C.cancel}
          </Button>
          {targets.length > 0 ? (
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              data-review-action="confirm-duplicate"
              onClick={async () => {
                if (!picked) {
                  setError(C.duplicateHelp)
                  return
                }
                const reply = await onConfirm(picked)
                if (reply.ok) onOpenChange(false)
                else setError(reply.message)
              }}
            >
              {busy ? C.saving : C.markDuplicate}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
