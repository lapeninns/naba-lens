"use client"

import * as React from "react"
import {
  ArrowsLeftRightIcon,
  MagnifyingGlassIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react"

import { loadMenuItemsPageAction } from "@/app/manager/actions"
import { failureText } from "@/components/nabalens/coverage/copy"
import { EvidenceThumb } from "@/components/nabalens/coverage/evidence-image"
import {
  ReasonField,
  useReportedFocus,
  type ReasonOutcome,
} from "@/components/nabalens/coverage/reason-dialog"
import { OptionSelect } from "@/components/nabalens/option-select"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { ManagerMenuItem, QueueCard } from "@/lib/server/menu-photos/types"

import { REVIEW_COPY } from "./review-copy"

/** The item a photo is matched to, with the revision the decision checks. */
export type PickedItem = {
  itemId: string
  name: string
  variantId: string | null
  itemRevision: number
}

const SEARCH_DELAY = 300

/**
 * Choose the menu item a photo shows: search the venue's active menu
 * (debounced), pick an item and optionally an option, then confirm. A reason
 * is required when correcting a staff label (`reasonRequired`); otherwise a
 * note is optional. The decision carries the picked item's revision.
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
  const requestRef = React.useRef(0)

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
        } catch {
          if (request === requestRef.current)
            setLoadError(REVIEW_COPY.pickerFailed)
        } finally {
          if (request === requestRef.current) setLoading(false)
        }
      },
      query ? SEARCH_DELAY : 0
    )
    return () => window.clearTimeout(timer)
  }, [open, query, venueId])

  function reset() {
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

  async function submit(event: React.FormEvent) {
    event.preventDefault()
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
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-search`} className="text-label text-ink">
              {REVIEW_COPY.pickerSearch}
            </label>
            <span className="relative block">
              <MagnifyingGlassIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-4 z-10 size-5 -translate-y-1/2 text-ink-muted"
              />
              <Input
                id={`${id}-search`}
                type="search"
                value={query}
                placeholder={REVIEW_COPY.pickerPlaceholder}
                autoComplete="off"
                aria-controls={listId}
                onChange={(e) => setQuery(e.currentTarget.value)}
                disabled={pending}
                className="pl-11"
              />
            </span>
          </div>
          <fieldset
            id={listId}
            aria-describedby={pickError ? `${id}-pick-error` : undefined}
            aria-busy={loading || undefined}
            className="grid max-h-72 gap-1 overflow-y-auto rounded-card bg-surface-2 p-1"
          >
            <legend className="sr-only">{REVIEW_COPY.pickerItems}</legend>
            {loading && items.length === 0 ? (
              <p className="flex items-center gap-2 p-3 text-body text-ink-muted">
                <SpinnerGapIcon
                  aria-hidden
                  className="size-5 motion-safe:animate-spin"
                />
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
                  className="flex min-h-14 cursor-pointer items-center gap-3 rounded-control px-3 py-2 transition-colors duration-(--duration-quick) hover:bg-raised has-checked:bg-accent-soft has-focus-visible:outline-3 has-focus-visible:-outline-offset-3 has-focus-visible:outline-focus has-focus-visible:outline-solid"
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
          {pickError ? (
            <p
              id={`${id}-pick-error`}
              role="alert"
              className="text-body font-semibold text-warn-fg"
            >
              {pickError}
            </p>
          ) : null}
          {picked && picked.variants.length > 0 ? (
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
              size="touch"
              onClick={() => close(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="touch"
              variant="primary"
              disabled={pending}
              aria-busy={pending || undefined}
            >
              {pending ? (
                <SpinnerGapIcon aria-hidden className="animate-spin" />
              ) : (
                <ArrowsLeftRightIcon data-icon="inline-start" aria-hidden />
              )}
              {pending
                ? REVIEW_COPY.saving
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
