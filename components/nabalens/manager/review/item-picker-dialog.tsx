"use client"

import { SearchField } from "@/components/ui/search-field"
import { Spinner } from "@/components/ui/spinner"
import * as React from "react"
import { ArrowsLeftRightIcon } from "@phosphor-icons/react"

import { useSessionEndedCatch } from "@/components/nabalens/session-guard-host"
import { loadMenuItemsPageAction } from "@/app/manager/actions"
import { loadFixLabelSlotsAction } from "@/app/manager/review/actions"
import { failureText } from "@/components/nabalens/coverage/copy"
import { EvidenceThumb } from "@/components/nabalens/coverage/evidence-image"
import {
  ReasonField,
  useReportedFocus,
  type ReasonOutcome,
} from "@/components/nabalens/coverage/reason-dialog"
import { OptionSelect } from "@/components/nabalens/option-select"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ManagerMenuItem, QueueCard } from "@/lib/server/menu-photos/types"
import type { FixLabelSlot } from "@/lib/server/review/inbox"

import { REVIEW_COPY } from "./review-copy"

/** The item a photo is matched to, with the revision the decision checks. */
export type PickedItem = {
  itemId: string
  name: string
  variantId: string | null
  itemRevision: number
}

/** A place or amenity Fix label moves a photo to (S3-R13 X8). */
export type PickedSlot = FixLabelSlot

/** What the picker chooses from: menu items, places or amenities. */
type PickKind = "dish" | "area" | "amenity"

const SEARCH_DELAY = 300

const matches = (slot: FixLabelSlot, query: string) => {
  const q = query.trim().toLocaleLowerCase("en")
  return (
    !q ||
    slot.name.toLocaleLowerCase("en").includes(q) ||
    slot.groupName.toLocaleLowerCase("en").includes(q)
  )
}

/**
 * Choose the menu item a photo shows: search the venue's active menu
 * (debounced), pick an item and optionally an option, then confirm. A reason
 * is required when correcting a staff label (`reasonRequired`); otherwise a
 * note is optional. The decision carries the picked item's revision.
 *
 * Fix label (S3-R13 X8, spec §7 M2) passes `onConfirmSlot`: the one picker
 * then also offers the venue's places and amenities (a segmented choice of
 * Menu item, Place or Amenity), each searched by name.
 */
export function ItemPickerDialog({
  open,
  onOpenChange,
  card,
  title,
  reasonLabel,
  reasonRequired,
  emptyReason,
  excluded,
  venueId,
  onConfirm,
  onConfirmSlot,
  excludedSlot,
  reportFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  card: QueueCard | null
  title: string
  reasonLabel: string
  reasonRequired: boolean
  emptyReason?: string
  /** The label being corrected: the same item and option is refused. */
  excluded?: { itemId: string; variantId: string | null } | null
  venueId?: string
  onConfirm: (item: PickedItem, reason: string) => Promise<ReasonOutcome>
  /** Offers places and amenities too; called with the chosen one. */
  onConfirmSlot?: (slot: PickedSlot, reason: string) => Promise<ReasonOutcome>
  /** The place or amenity the photo is on now: refused as a target. */
  excludedSlot?: { kind: "area" | "amenity"; id: string } | null
  /** Takes focus once the decision is made (the dialog's trigger may have gone). */
  reportFocus?: () => HTMLElement | null
}) {
  const id = React.useId()
  const { reportedRef, finalFocus } = useReportedFocus(reportFocus)
  const [query, setQuery] = React.useState("")
  const [items, setItems] = React.useState<ManagerMenuItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [picked, setPicked] = React.useState<ManagerMenuItem | null>(null)
  const [variantId, setVariantId] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState("")
  const [fieldError, setFieldError] = React.useState<string | null>(null)
  const [pickError, setPickError] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const sessionEnded = useSessionEndedCatch()
  const requestRef = React.useRef(0)
  const [kind, setKind] = React.useState<PickKind>("dish")
  const [slots, setSlots] = React.useState<FixLabelSlot[] | null>(null)
  const [slotsError, setSlotsError] = React.useState<string | null>(null)
  const [pickedSlot, setPickedSlot] = React.useState<FixLabelSlot | null>(null)
  const offersSlots = onConfirmSlot !== undefined

  // Places and amenities load once, when that tab is first chosen.
  React.useEffect(() => {
    if (!open || kind === "dish" || slots !== null) return
    let live = true
    loadFixLabelSlotsAction(venueId ? { venueId } : {})
      .then((result) => {
        if (!live) return
        if (result.ok) setSlots(result.slots)
        else setSlotsError(result.message || REVIEW_COPY.pickerSlotsFailed)
      })
      .catch((cause: unknown) => {
        sessionEnded(cause)
        if (live) setSlotsError(REVIEW_COPY.pickerSlotsFailed)
      })
    return () => {
      live = false
    }
  }, [open, kind, slots, venueId, sessionEnded])

  // Search the menu, debounced; the latest request wins.
  React.useEffect(() => {
    if (!open) return
    const request = ++requestRef.current
    const timer = window.setTimeout(
      async () => {
        setLoading(true)
        setLoadError(null)
        try {
          const result = await loadMenuItemsPageAction({
            query: query.trim() || undefined,
            ...(venueId ? { venueId } : {}),
          })
          if (request !== requestRef.current) return
          if (!result.ok) setLoadError(failureText(result))
          else setItems(result.items)
        } catch (cause) {
          sessionEnded(cause)
          if (request === requestRef.current)
            setLoadError(REVIEW_COPY.pickerFailed)
        } finally {
          if (request === requestRef.current) setLoading(false)
        }
      },
      query ? SEARCH_DELAY : 0
    )
    return () => window.clearTimeout(timer)
  }, [open, query, sessionEnded, venueId])

  function reset() {
    setKind("dish")
    setPickedSlot(null)
    setQuery("")
    setItems([])
    setPicked(null)
    setVariantId(null)
    setReason("")
    setFieldError(null)
    setPickError(null)
    setError(null)
  }

  function close(next: boolean) {
    if (pending) return
    if (!next) reset()
    onOpenChange(next)
  }

  async function submitSlot() {
    if (!pickedSlot || !onConfirmSlot) {
      setPickError(REVIEW_COPY.pickerChooseSlot)
      return
    }
    if (
      excludedSlot &&
      excludedSlot.kind === pickedSlot.kind &&
      excludedSlot.id === pickedSlot.id
    ) {
      setPickError(REVIEW_COPY.pickerSameSlot)
      return
    }
    const trimmed = reason.trim()
    if (reasonRequired && !trimmed) {
      setFieldError(emptyReason ?? REVIEW_COPY.relinkEmpty)
      return
    }
    setPending(true)
    setError(null)
    setFieldError(null)
    setPickError(null)
    try {
      const outcome = await onConfirmSlot(pickedSlot, trimmed)
      if (!outcome.ok && !("reported" in outcome)) {
        setError(outcome.error)
        setFieldError(outcome.fieldError ?? null)
        return
      }
      reportedRef.current = true
      reset()
      onOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (kind !== "dish") {
      await submitSlot()
      return
    }
    if (!picked) {
      setPickError(REVIEW_COPY.pickerChoose)
      return
    }
    if (
      excluded &&
      excluded.itemId === picked.itemId &&
      excluded.variantId === variantId
    ) {
      setPickError(REVIEW_COPY.pickerSameItem)
      return
    }
    const trimmed = reason.trim()
    if (reasonRequired && !trimmed) {
      setFieldError(emptyReason ?? REVIEW_COPY.relinkEmpty)
      return
    }
    setPending(true)
    setError(null)
    setFieldError(null)
    setPickError(null)
    try {
      const outcome = await onConfirm(
        {
          itemId: picked.itemId,
          name: picked.name,
          variantId,
          itemRevision: picked.itemRevision,
        },
        trimmed
      )
      if (!outcome.ok && !("reported" in outcome)) {
        setError(outcome.error)
        setFieldError(outcome.fieldError ?? null)
        return
      }
      reportedRef.current = true
      reset()
      onOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  const listId = `${id}-items`
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent finalFocus={finalFocus}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {card ? (
              <DialogDescription>
                {REVIEW_COPY.photoBy(card.contributor.name)}
              </DialogDescription>
            ) : null}
          </DialogHeader>
          {card ? (
            <EvidenceThumb
              src={card.asset.thumbnailUrl}
              className="aspect-square w-20 rounded-control"
            />
          ) : null}
          {offersSlots ? (
            <SegmentedControl
              label={REVIEW_COPY.pickerKind}
              value={kind}
              onValueChange={(next) => {
                setKind(next)
                // A failed load is tried again on the next tab change.
                setSlotsError(null)
                setPickError(null)
                setError(null)
              }}
              disabled={pending}
              stack="phone"
              options={[
                { value: "dish", label: REVIEW_COPY.pickerKindDish },
                { value: "area", label: REVIEW_COPY.pickerKindPlace },
                { value: "amenity", label: REVIEW_COPY.pickerKindAmenity },
              ]}
            />
          ) : null}
          <SearchField
            id={`${id}-search`}
            label={
              kind === "dish"
                ? REVIEW_COPY.pickerSearch
                : REVIEW_COPY.pickerSearchSlots
            }
            value={query}
            onValueChange={setQuery}
            placeholder={
              kind === "dish"
                ? REVIEW_COPY.pickerPlaceholder
                : REVIEW_COPY.pickerSlotPlaceholder
            }
            autoComplete="off"
            aria-controls={listId}
            disabled={pending}
          />
          {kind !== "dish" ? (
            <SlotList
              id={id}
              listId={listId}
              kind={kind}
              slots={slots}
              loadError={slotsError}
              query={query}
              picked={pickedSlot}
              pending={pending}
              describedBy={pickError ? `${id}-pick-error` : undefined}
              onPick={(slot) => {
                setPickedSlot(slot)
                setPickError(null)
              }}
            />
          ) : (
            <fieldset
              id={listId}
              aria-describedby={pickError ? `${id}-pick-error` : undefined}
              aria-busy={loading || undefined}
              className="grid max-h-72 gap-1 overflow-y-auto rounded-card bg-surface-2 p-1"
            >
              <legend className="sr-only">{REVIEW_COPY.pickerItems}</legend>
              {loading && items.length === 0 ? (
                <p className="flex items-center gap-2 p-3 text-body text-ink-muted">
                  <Spinner />
                  {REVIEW_COPY.pickerLoading}
                </p>
              ) : loadError ? (
                <p
                  role="alert"
                  className="p-3 text-body font-semibold text-warn-fg"
                >
                  {loadError}
                </p>
              ) : items.length === 0 ? (
                <p className="p-3 text-body text-ink-muted">
                  {REVIEW_COPY.pickerEmpty}
                </p>
              ) : (
                items.map((item) => (
                  <label
                    key={item.itemId}
                    className="flex min-h-14 cursor-pointer items-center gap-3 rounded-control px-3 py-2 transition-colors duration-quick hover:bg-raised has-checked:bg-accent-soft has-focus-visible:outline-3 has-focus-visible:-outline-offset-3 has-focus-visible:outline-focus has-focus-visible:outline-solid"
                  >
                    <input
                      type="radio"
                      name={`${id}-item`}
                      value={item.itemId}
                      checked={picked?.itemId === item.itemId}
                      disabled={pending}
                      onChange={() => {
                        setPicked(item)
                        setVariantId(null)
                        setPickError(null)
                      }}
                      className="size-6 shrink-0 accent-select"
                    />
                    <span className="grid min-w-0">
                      <span className="text-label break-words text-ink">
                        {item.name}
                      </span>
                      <span className="text-meta text-ink-muted">
                        {item.section.name}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </fieldset>
          )}
          {pickError ? (
            <p
              id={`${id}-pick-error`}
              role="alert"
              className="text-body font-semibold text-warn-fg"
            >
              {pickError}
            </p>
          ) : null}
          {kind === "dish" && picked && picked.variants.length > 0 ? (
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-variant`} className="text-label text-ink">
                {REVIEW_COPY.pickerVariant}
              </label>
              <OptionSelect
                id={`${id}-variant`}
                options={picked.variants.map((v) => ({
                  id: v.variantId,
                  name: v.name,
                }))}
                value={variantId}
                onValueChange={setVariantId}
                emptyLabel={REVIEW_COPY.pickerNoVariant}
                disabled={pending}
              />
            </div>
          ) : null}
          <ReasonField
            id={`${id}-reason`}
            label={reasonLabel}
            value={reason}
            onChange={setReason}
            error={fieldError}
            disabled={pending}
            required={reasonRequired}
          />
          {error ? (
            <p role="alert" className="text-body font-semibold text-warn-fg">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => close(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={pending}
              loadingLabel={REVIEW_COPY.saving}
            >
              <ArrowsLeftRightIcon data-icon="inline-start" aria-hidden />
              {kind !== "dish"
                ? pickedSlot
                  ? REVIEW_COPY.confirmFor(pickedSlot.name)
                  : REVIEW_COPY.confirmPickSlot
                : picked
                  ? REVIEW_COPY.confirmFor(picked.name)
                  : REVIEW_COPY.confirmPick}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The venue's places or amenities, filtered by the search, as radio rows. */
function SlotList({
  id,
  listId,
  kind,
  slots,
  loadError,
  query,
  picked,
  pending,
  describedBy,
  onPick,
}: {
  id: string
  listId: string
  kind: "area" | "amenity"
  slots: FixLabelSlot[] | null
  loadError: string | null
  query: string
  picked: FixLabelSlot | null
  pending: boolean
  describedBy?: string
  onPick: (slot: FixLabelSlot) => void
}) {
  const shown = (slots ?? []).filter(
    (s) => s.kind === kind && matches(s, query)
  )
  return (
    <fieldset
      id={listId}
      aria-describedby={describedBy}
      aria-busy={slots === null && !loadError ? true : undefined}
      className="grid max-h-72 gap-1 overflow-y-auto rounded-card bg-surface-2 p-1"
    >
      <legend className="sr-only">
        {kind === "area"
          ? REVIEW_COPY.pickerKindPlace
          : REVIEW_COPY.pickerKindAmenity}
      </legend>
      {loadError ? (
        <p role="alert" className="p-3 text-body font-semibold text-warn-fg">
          {loadError}
        </p>
      ) : slots === null ? (
        <p className="flex items-center gap-2 p-3 text-body text-ink-muted">
          <Spinner />
          {REVIEW_COPY.pickerLoading}
        </p>
      ) : shown.length === 0 ? (
        <p className="p-3 text-body text-ink-muted">
          {REVIEW_COPY.pickerSlotsEmpty}
        </p>
      ) : (
        shown.map((slot) => (
          <label
            key={`${slot.kind}:${slot.id}`}
            className="flex min-h-14 cursor-pointer items-center gap-3 rounded-control px-3 py-2 transition-colors duration-quick hover:bg-raised has-checked:bg-accent-soft has-focus-visible:outline-3 has-focus-visible:-outline-offset-3 has-focus-visible:outline-focus has-focus-visible:outline-solid"
          >
            <input
              type="radio"
              name={`${id}-slot`}
              value={slot.id}
              checked={picked?.kind === slot.kind && picked.id === slot.id}
              disabled={pending}
              onChange={() => onPick(slot)}
              data-fix-slot={slot.kind}
              className="size-6 shrink-0 accent-select"
            />
            <span className="grid min-w-0">
              <span className="text-label break-words text-ink">
                {slot.name}
              </span>
              {slot.groupName && slot.groupName !== slot.name ? (
                <span className="text-meta text-ink-muted">
                  {slot.groupName}
                </span>
              ) : null}
            </span>
          </label>
        ))
      )}
    </fieldset>
  )
}
