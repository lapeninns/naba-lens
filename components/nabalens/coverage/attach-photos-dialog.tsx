"use client"

import * as React from "react"
import { PaperclipIcon } from "@phosphor-icons/react"

import { formatDate } from "@/components/nabalens/format"
import { LoadMoreButton } from "@/components/nabalens/load-more-button"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import {
  ASSET_REASON_LABEL,
  COVERAGE_LIMITS,
  failureText,
  labelFor,
  plural,
} from "./copy"
import { EvidenceThumb } from "./evidence-image"
import type {
  CoverageResult,
  Page,
  SkippedPhoto,
  SubmittablePhoto,
  SubmittedPhoto,
} from "./types"
import { useRequestIds } from "./use-request-id"

export type LoadVenuePhotosHandler = (
  cursor: string | null
) => Promise<CoverageResult<Page<SubmittablePhoto>>>

export type AttachPhotosHandler = (input: {
  requestId: string
  assetIds: string[]
  acceptNow: boolean
}) => Promise<
  CoverageResult<{
    submitted: SubmittedPhoto[]
    skipped: SkippedPhoto[]
    replayed: boolean
  }>
>

/** The reply was lost: the photos may be attached. The request id is kept. */
const NETWORK_ERROR =
  "We couldn't confirm the photos were attached. Check your connection, then try again or refresh to see if they were. They won't be attached twice."

type SkippedNote = SkippedPhoto & { photo: string | null }

/** Names each skipped photo while it is still in the list (a reload may drop it). */
function noteSkipped(
  skipped: SkippedPhoto[],
  photos: SubmittablePhoto[]
): SkippedNote[] {
  const byId = new Map(photos.map((p) => [p.assetId, p]))
  return skipped.map((s) => {
    const p = byId.get(s.assetId)
    return {
      ...s,
      photo: p
        ? `${p.uploader.displayName}, ${formatDate(p.uploadedAt)}`
        : null,
    }
  })
}

/**
 * Attach ready photos already taken at this venue (by active colleagues; admins
 * also see retained photos of people who left). Attaching never changes who
 * took the photo and never earns monthly credit.
 */
export function AttachPhotosDialog({
  requirementTitle,
  viewerId,
  onLoad,
  onAttach,
  onStale,
}: {
  requirementTitle: string
  viewerId: string
  onLoad: LoadVenuePhotosHandler
  onAttach: AttachPhotosHandler
  onStale?: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [photos, setPhotos] = React.useState<SubmittablePhoto[]>([])
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [loaded, setLoaded] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<string[]>([])
  const [acceptNow, setAcceptNow] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [skipped, setSkipped] = React.useState<SkippedNote[]>([])
  const intents = useRequestIds()

  async function load(next: string | null) {
    setLoading(true)
    setLoadError(null)
    try {
      const result = await onLoad(next)
      if (!result.ok) {
        setLoadError(failureText(result))
        return
      }
      setPhotos((current) => {
        const base = next ? current : []
        const seen = new Set(base.map((p) => p.assetId))
        return [...base, ...result.items.filter((p) => !seen.has(p.assetId))]
      })
      setCursor(result.nextCursor)
      setLoaded(true)
    } catch {
      setLoadError("Photos could not load. Try again.")
    } finally {
      setLoading(false)
    }
  }

  function openDialog() {
    setOpen(true)
    setSelected([])
    setSkipped([])
    setError(null)
    setAcceptNow(false)
    void load(null)
  }

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length >= COVERAGE_LIMITS.batchMax
          ? current
          : [...current, id]
    )
  }

  async function attach() {
    if (selected.length === 0) return
    const payload = { assetIds: [...selected].sort(), acceptNow }
    const requestId = intents.requestIdFor("attach", payload)
    setPending(true)
    setError(null)
    try {
      const result = await onAttach({ requestId, ...payload })
      if (!result.ok) {
        if (result.code !== "unavailable") intents.settle("attach")
        setError(failureText(result))
        const refused = result.assetErrors ?? []
        setSkipped(noteSkipped(refused, photos))
        if (refused.length > 0) {
          const ids = new Set(refused.map((s) => s.assetId))
          setSelected((current) => current.filter((id) => !ids.has(id)))
          void load(null)
        }
        if (result.code !== "invalid_input") onStale?.()
        return
      }
      intents.settle("attach")
      setSkipped(noteSkipped(result.skipped, photos))
      if (result.skipped.length === 0) {
        setOpen(false)
      } else {
        setSelected([])
        void load(null)
      }
    } catch {
      setError(NETWORK_ERROR)
    } finally {
      setPending(false)
    }
  }

  const ownSelected = photos.some(
    (p) => selected.includes(p.assetId) && p.uploader.id === viewerId
  )

  return (
    <>
      <Button variant="secondary" size="touch" onClick={openDialog}>
        <PaperclipIcon data-icon="inline-start" aria-hidden />
        Attach existing photos
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next)
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Attach photos to “{requirementTitle}”</DialogTitle>
            <DialogDescription>
              Ready photos taken at this venue. The photographer stays the
              author; attached photos count for venue coverage only, not monthly
              targets. Choose up to {COVERAGE_LIMITS.batchMax}.
            </DialogDescription>
          </DialogHeader>
          {skipped.length > 0 ? (
            <div
              role="alert"
              className="grid gap-1 rounded-card bg-warn-bg px-4 py-3 text-body text-ink shadow-[inset_4px_0_0_var(--warn-fg)]"
            >
              <p>
                {plural(skipped.length, "photo was", "photos were")} not
                attached:
              </p>
              <ul className="list-disc pl-5">
                {skipped.map((s) => (
                  <li key={s.assetId}>
                    {s.photo ? (
                      <span className="font-bold">{s.photo}: </span>
                    ) : null}
                    {labelFor(ASSET_REASON_LABEL, s.reason)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!loaded && loading ? (
            <p className="text-body text-ink-muted">Loading photos…</p>
          ) : loaded && photos.length === 0 ? (
            <p className="text-body text-ink-muted">
              No ready photos from this venue yet.
            </p>
          ) : (
            <ul
              aria-label="Venue photos"
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            >
              {photos.map((photo) => {
                const checked = selected.includes(photo.assetId)
                const full =
                  !checked && selected.length >= COVERAGE_LIMITS.batchMax
                return (
                  <li key={photo.assetId}>
                    <label
                      className={
                        photo.eligible
                          ? "grid cursor-pointer gap-1.5 rounded-control bg-surface-2 p-1.5 has-checked:bg-accent-soft has-checked:shadow-[inset_0_0_0_3px_var(--select)] has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus has-focus-visible:outline-solid"
                          : "grid gap-1.5 rounded-control bg-surface-2 p-1.5 text-ink-muted"
                      }
                    >
                      <EvidenceThumb src={photo.thumbnailUrl} />
                      <span className="flex items-start gap-1.5 text-meta">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!photo.eligible || full || pending}
                          onChange={() => toggle(photo.assetId)}
                          className="mt-0.5 size-6 accent-select"
                        />
                        <span className="grid min-w-0">
                          <span className="[overflow-wrap:anywhere]">
                            {photo.uploader.displayName}
                            {photo.uploader.id === viewerId ? " (you)" : null}
                          </span>
                          <span className="text-ink-muted">
                            {formatDate(photo.uploadedAt)}
                            {!photo.uploader.active ? " · left" : null}
                          </span>
                          {!photo.eligible && photo.reason ? (
                            <span className="text-ink-muted">
                              {labelFor(ASSET_REASON_LABEL, photo.reason)}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {loaded ? (
            <LoadMoreButton
              hasMore={!!cursor}
              loading={loading}
              error={loadError}
              onLoadMore={() => void load(cursor)}
            />
          ) : loadError ? (
            <p role="alert" className="text-body font-semibold text-warn-fg">
              {loadError}
            </p>
          ) : null}
          <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-control bg-surface-2 px-3 py-3 hover:bg-raised has-checked:bg-accent-soft">
            <input
              type="checkbox"
              checked={acceptNow}
              onChange={(e) => setAcceptNow(e.currentTarget.checked)}
              disabled={pending}
              className="mt-0.5 size-6 accent-select"
            />
            <span className="grid gap-0.5 text-body">
              <span className="font-bold">Accept them now</span>
              <span className="text-ink-muted">
                {ownSelected
                  ? "You took at least one of these: accepting it is recorded as a self-review."
                  : "Otherwise they wait in the review queue."}
              </span>
            </span>
          </label>
          {error ? (
            <p role="alert" className="text-body font-semibold text-warn-fg">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="secondary"
              size="touch"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              size="touch"
              onClick={() => void attach()}
              disabled={selected.length === 0 || pending}
              aria-busy={pending || undefined}
            >
              {pending
                ? "Attaching…"
                : `Attach ${plural(selected.length, "photo")}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
