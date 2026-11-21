"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeftIcon,
  CaretRightIcon,
  ImagesIcon,
} from "@phosphor-icons/react"

import { setAreaLabelAction } from "@/app/_labels/area-actions"
import {
  loadMatchBoardAction,
  requestLabelHelpAction,
} from "@/app/staff/_shell/match-actions"
import {
  loadUploadLabelContext,
  saveUploadLabels,
} from "@/app/staff/_shell/upload-label-api"
import { Notice } from "@/components/nabalens/notice"
import { Button } from "@/components/ui/button"
import { Photo } from "@/components/ui/photo"
import { SelectableTile } from "@/components/ui/selectable-tile"
import type { ContentType, SaveLabelsInput } from "@/lib/menus/types"
import { STAFF_PHOTO_ROUTES } from "@/lib/config/album-upload-tray"
import { STAFF_ALBUM_POSTS } from "@/lib/config/staff-album-posts"
import {
  LABEL_PHOTO,
  MATCH_LATER_HREF,
  photoHref,
  slotPageHref,
} from "@/lib/staff/my-uploads"
import { cn } from "@/lib/utils"

import { MATCH_LATER_COPY, folderPath } from "./copy"
import {
  readLastPlace,
  readRecentSlots,
  writeLastPlace,
  writeRecentSlot,
} from "./last-place"
import { MatchPicker, type BoardState } from "./match-picker"
import { placeKey, type MatchSlot, type SharedKind } from "./model"

/** A photo added without a slot, as Match later shows it. */
export type MatchLaterPhoto = {
  id: string
  thumbnailUrl: string | null
  createdAt: string
  /** The photo's label revision (0 = none yet), for the save. */
  revision: number
}

/*
 * Album's "Match later" row (DESIGN.md §5a step 5): the number of photos the
 * person added without a slot, and a way to match them. Nothing when there
 * are none. Album Home places it (AL-8 or the coordinator wires it).
 */
export function MatchLaterRow({
  count,
  href = STAFF_ALBUM_POSTS ? `${MATCH_LATER_HREF}?select=1` : MATCH_LATER_HREF,
}: {
  count: number
  href?: string
}) {
  if (count <= 0) return null
  // Posting (D21): these photos are in the Album already, waiting for a label.
  const words = STAFF_ALBUM_POSTS
    ? {
        title: "Label photos",
        row: (n: number) =>
          n === 1 ? "1 photo to label" : `${n} photos to label`,
        action: "Label",
      }
    : {
        title: MATCH_LATER_COPY.title,
        row: MATCH_LATER_COPY.row,
        action: MATCH_LATER_COPY.rowAction,
      }
  return (
    <Link
      href={href}
      data-slot="match-later-row"
      // The same v2 JobCard shape as Home's other rows (home-rows.tsx).
      className="flex min-h-16 w-full items-center gap-3 rounded-card bg-surface p-4 text-start text-ink edge focus-ring transition-colors duration-quick hover:bg-raised"
    >
      <span className="flex size-14 shrink-0 items-center justify-center rounded-square bg-surface-2 text-ink-muted">
        <ImagesIcon aria-hidden className="size-6" />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="text-heading">{words.title}</span>
        <span className="text-body text-ink-muted tabular-nums">
          {words.row(count)}
        </span>
      </span>
      <span className="text-label text-accent-text">{words.action}</span>
      <CaretRightIcon aria-hidden className="size-5 shrink-0" />
    </Link>
  )
}

type LabelTarget = { venueId: string; catalogueVersionId: string | null }

/*
 * Match later (DESIGN.md §2.8, §5e, §6.1): a single photo on the stage or a
 * selection of photos, with the same match picker. A dish saves the dish
 * as the photo's menu label, an area its venue-area label (G-9), Not for a
 * slot what it shows; each matched photo leaves the list. Match later is
 * the one place a photo is matched after it was sent: it was sent without a
 * slot on purpose (D9).
 */
export function MatchLaterScreen({
  photos: initial,
  headingLevel = 1,
  focused = false,
  selectPhotos = false,
}: {
  photos: MatchLaterPhoto[]
  headingLevel?: 1 | 2
  focused?: boolean
  selectPhotos?: boolean
}) {
  const router = useRouter()
  // Labelling after posting (D21): tick the photos, choose one label, read
  // what it will do, then Save. Undo on the result. The 20 Nov 2026 handoff.
  const posting = STAFF_ALBUM_POSTS && !focused
  const [photos, setPhotos] = React.useState(initial)
  const [shown, setShown] = React.useState<string | null>(null)
  const [batch, setBatch] = React.useState(
    selectPhotos || (posting && initial.length > 1)
  )
  const [pending, setPending] = React.useState<MatchSlot | null>(null)
  const saveButton = React.useRef<HTMLButtonElement>(null)
  // The label revision each photo was saved at here, for Undo.
  const savedAt = React.useRef(new Map<string, number>())
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = React.useState(false)
  const saving = React.useRef(false)
  const [problem, setProblem] = React.useState<string | null>(null)
  const [receipt, setReceipt] = React.useState<{
    count: number
    slot: MatchSlot
    items: MatchLaterPhoto[]
  } | null>(null)
  const [undone, setUndone] = React.useState<number | null>(null)
  const [board, setBoard] = React.useState<BoardState>({ state: "loading" })
  const [boardTry, setBoardTry] = React.useState(0)
  // Slots matched on this screen, newest first: marked, and first under
  // Recent, so the next photo of the same dish is one tap (X4).
  const [visit, setVisit] = React.useState<readonly string[]>([])
  const taken = React.useMemo(() => new Set(visit), [visit])
  const [last, setLast] = React.useState<string | null>(null)
  const [recent, setRecent] = React.useState<readonly string[]>([])
  // Browser storage is read after hydration, never during the render.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLast(readLastPlace())
    setRecent(readRecentSlots(null))
  }, [])
  const target = React.useRef<Promise<LabelTarget | null> | null>(null)
  const Title = `h${headingLevel}` as "h1"

  React.useEffect(() => {
    let live = true
    void loadMatchBoardAction()
      .then((result) => {
        if (!live) return
        setBoard(
          result.ok
            ? { state: "ready", board: result.board }
            : { state: "error", message: result.message }
        )
      })
      .catch(() => {
        if (live) setBoard({ state: "error", message: "" })
      })
    return () => {
      live = false
    }
  }, [boardTry])

  // The venue and menu version a label save needs, read once when needed.
  const labelTarget = () => {
    target.current ??= loadUploadLabelContext(new AbortController().signal)
      .then((context) =>
        context.ok
          ? {
              venueId: context.catalogue.venueId,
              catalogueVersionId:
                context.catalogue.status === "active"
                  ? context.catalogue.versionId
                  : null,
            }
          : null
      )
      .catch(() => null)
      .then((result) => {
        if (!result) target.current = null
        return result
      })
    return target.current
  }

  const photo = photos.find((p) => p.id === shown) ?? photos[0] ?? null
  const index = photo ? photos.indexOf(photo) : -1
  const chosen = batch
    ? photos.filter((p) => selected.has(p.id))
    : photo
      ? [photo]
      : []
  const fromPhotos = focused || selectPhotos

  const saveLabels = async (
    item: MatchLaterPhoto,
    labels: Pick<SaveLabelsInput, "items" | "contentTypes">
  ): Promise<string | null> => {
    const where = await labelTarget()
    if (!where) return MATCH_LATER_COPY.saveFailed
    const result = await saveUploadLabels(where.venueId, {
      assetId: item.id,
      expectedRevision: item.revision,
      catalogueVersionId: where.catalogueVersionId,
      note: null,
      missingItem: null,
      ...labels,
    })
    if (result.ok) {
      if (result.state !== "saved") return MATCH_LATER_COPY.saveFailed
      savedAt.current.set(item.id, result.labels.revision)
      return null
    }
    if (result.code === "catalogue_changed") target.current = null
    return result.code === "forbidden" || result.code === "not_found"
      ? MATCH_LATER_COPY.refused
      : result.message || MATCH_LATER_COPY.saveFailed
  }

  const settle = async (
    send: (item: MatchLaterPhoto) => Promise<string | null>,
    slot: MatchSlot | null
  ) => {
    if (saving.current || chosen.length === 0) return
    saving.current = true
    setBusy(true)
    setProblem(null)
    setReceipt(null)
    setUndone(null)
    setPending(null)
    const saved = new Set<string>()
    const failures: string[] = []
    for (const item of chosen) {
      try {
        const error = await send(item)
        if (error) failures.push(error)
        else saved.add(item.id)
      } catch {
        failures.push(MATCH_LATER_COPY.saveFailed)
      }
    }
    saving.current = false
    setBusy(false)
    if (failures.length > 0) {
      setProblem(
        chosen.length === 1
          ? failures[0]!
          : MATCH_LATER_COPY.batchFailed(failures.length, failures[0]!)
      )
    }
    if (saved.size === 0) return
    if (slot) {
      setReceipt({
        count: saved.size,
        slot,
        items: chosen.filter((p) => saved.has(p.id)),
      })
      setVisit((v) => [slot.id, ...v.filter((id) => id !== slot.id)])
      writeLastPlace(placeKey(slot.place))
      setLast(placeKey(slot.place))
      writeRecentSlot(
        board.state === "ready" ? (board.board.venue?.id ?? null) : null,
        slot.id
      )
    }
    setPhotos((list) => list.filter((p) => !saved.has(p.id)))
    setSelected((list) => new Set([...list].filter((id) => !saved.has(id))))
    setShown(null)
    if (focused && photo) router.replace(photoHref(photo.id))
  }

  // Posting: a chosen result only fills the confirm bar; Save applies it.
  const choose = (slot: MatchSlot) => {
    if (!posting) return match(slot)
    setProblem(null)
    setPending(slot)
  }

  React.useEffect(() => {
    if (!pending) return
    saveButton.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPending(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [pending])

  // Undo the last save: the photos lose that label and come back to label.
  const undo = async () => {
    if (!receipt || saving.current) return
    saving.current = true
    setBusy(true)
    setProblem(null)
    const back: MatchLaterPhoto[] = []
    for (const item of receipt.items) {
      try {
        if (receipt.slot.target.kind === "dish") {
          const where = await labelTarget()
          const revision = savedAt.current.get(item.id)
          if (!where || revision === undefined) continue
          const result = await saveUploadLabels(where.venueId, {
            assetId: item.id,
            expectedRevision: revision,
            catalogueVersionId: where.catalogueVersionId,
            note: null,
            missingItem: null,
            items: [],
            contentTypes: [],
          })
          if (result.ok && result.state === "saved")
            back.push({ ...item, revision: result.labels.revision })
        } else {
          const result = await setAreaLabelAction(item.id, null)
          if (result.ok) back.push(item)
        }
      } catch {
        // Counted below: the photo keeps its label.
      }
    }
    saving.current = false
    setBusy(false)
    if (back.length < receipt.items.length)
      setProblem(MATCH_LATER_COPY.undoFailed)
    if (back.length === 0) return
    const ids = new Set(back.map((p) => p.id))
    setPhotos((list) => [...back, ...list.filter((p) => !ids.has(p.id))])
    setReceipt(null)
    setUndone(back.length)
  }

  const match = (slot: MatchSlot) => {
    void settle(async (item) => {
      if (slot.target.kind === "dish")
        return saveLabels(item, {
          items: [{ itemId: slot.target.itemId, variantId: null }],
          contentTypes: [],
        })
      const result = await setAreaLabelAction(item.id, slot.target.subjectId)
      return result.ok ? null : result.message || MATCH_LATER_COPY.saveFailed
    }, slot)
  }

  // I'm not sure (FA-4, spec §5.3): the manager chooses the slot, here too
  // (S3-R12: a photo that reached Match later because the first request
  // failed is offered it again).
  const unsure = () => {
    void settle(async (item) => {
      const result = await requestLabelHelpAction(item.id)
      return result.ok ? null : result.message || MATCH_LATER_COPY.saveFailed
    }, null)
  }

  const share = (kind: SharedKind) => {
    void settle(
      (item) =>
        saveLabels(item, { items: [], contentTypes: [kind as ContentType] }),
      null
    )
  }

  const toggleBatch = () => {
    setBatch((value) => !value)
    setSelected(new Set())
    setProblem(null)
  }

  const togglePhoto = (id: string, checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <div className="grid gap-4 pb-4" data-slot="match-later">
      <div>
        <Link
          href={
            fromPhotos ? STAFF_PHOTO_ROUTES.photos : STAFF_PHOTO_ROUTES.home
          }
          className="inline-flex min-h-12 items-center gap-1 text-label text-ink focus-ring"
        >
          <ArrowLeftIcon aria-hidden className="size-5" />
          {fromPhotos ? "My photos" : "Today"}
        </Link>
      </div>
      <header className="grid gap-1">
        <Title className="type-display text-ink">
          {focused
            ? LABEL_PHOTO
            : STAFF_ALBUM_POSTS
              ? "Label photos"
              : MATCH_LATER_COPY.title}
        </Title>
        {posting ? (
          <p className="text-body text-ink-muted">
            {MATCH_LATER_COPY.labelIntro}
          </p>
        ) : (
          <p className="text-caption text-ink-muted tabular-nums">
            {!focused && photos.length > 0
              ? MATCH_LATER_COPY.row(photos.length)
              : null}
          </p>
        )}
      </header>

      {receipt && posting ? (
        <Notice tone="positive">
          <p role="status" className="font-semibold">
            {MATCH_LATER_COPY.labelledAs(receipt.count, receipt.slot.name)}
          </p>
          <p className="text-ink-muted">{folderPath(receipt.slot)}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Link
              className="inline-flex min-h-12 items-center text-label underline focus-ring"
              href={slotPageHref(
                receipt.slot.target.kind === "dish"
                  ? { kind: "dish", slotId: receipt.slot.target.itemId }
                  : { kind: "area", slotId: receipt.slot.target.subjectId }
              )}
            >
              {MATCH_LATER_COPY.openThisFolder}
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => void undo()}
              className="inline-flex min-h-12 items-center text-label underline focus-ring disabled:opacity-60"
            >
              {MATCH_LATER_COPY.undo}
            </button>
          </div>
        </Notice>
      ) : receipt ? (
        <Notice tone="positive">
          <p role="status">{MATCH_LATER_COPY.labelled(receipt.count)}</p>
          <Link
            className="text-label underline focus-ring"
            href={slotPageHref(
              receipt.slot.target.kind === "dish"
                ? { kind: "dish", slotId: receipt.slot.target.itemId }
                : { kind: "area", slotId: receipt.slot.target.subjectId }
            )}
          >
            {MATCH_LATER_COPY.openFolder(receipt.slot.name)}
          </Link>
        </Notice>
      ) : null}
      {undone ? (
        <p role="status" className="text-body text-ink">
          {MATCH_LATER_COPY.undone(undone)}
        </p>
      ) : null}
      {problem ? (
        <Notice tone="negative" role="alert">
          {problem}
        </Notice>
      ) : null}
      {posting && batch && photos.length > 0 ? (
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="type-section-title text-ink">
            {MATCH_LATER_COPY.toLabel}{" "}
            <span className="text-ink-muted tabular-nums">{photos.length}</span>
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              setSelected(
                selected.size === photos.length
                  ? new Set()
                  : new Set(photos.map((p) => p.id))
              )
            }
            className="inline-flex min-h-12 items-center text-label text-accent-text underline underline-offset-4 focus-ring"
          >
            {selected.size === photos.length
              ? MATCH_LATER_COPY.clearSelection
              : MATCH_LATER_COPY.selectAll(photos.length)}
          </button>
        </div>
      ) : null}
      {!posting &&
      !focused &&
      (photos.length > 1 || (batch && photos.length > 0)) ? (
        <Button
          variant="secondary"
          className="w-fit"
          disabled={busy}
          onClick={toggleBatch}
        >
          {batch ? MATCH_LATER_COPY.singleMode : MATCH_LATER_COPY.batchMode}
        </Button>
      ) : null}

      {batch && photos.length > 0 ? (
        <>
          <ul
            className="grid grid-cols-3 gap-2 sm:grid-cols-4"
            aria-label={MATCH_LATER_COPY.batchMode}
          >
            {photos.map((item, i) => (
              <li key={item.id}>
                <SelectableTile
                  label={`photo ${i + 1}`}
                  checked={selected.has(item.id)}
                  disabled={busy}
                  onCheckedChange={(checked) => togglePhoto(item.id, checked)}
                >
                  <Photo
                    src={item.thumbnailUrl ?? `/api/media/${item.id}/thumb`}
                    alt=""
                    ratio="1/1"
                    radius="none"
                  />
                </SelectableTile>
              </li>
            ))}
          </ul>
          <p className="text-body text-ink-muted" role="status">
            {chosen.length === 0
              ? MATCH_LATER_COPY.selectHint
              : posting
                ? MATCH_LATER_COPY.selected(chosen.length)
                : MATCH_LATER_COPY.batchHint(chosen.length)}
          </p>
        </>
      ) : null}
      {!batch && photo ? (
        <>
          {!focused ? (
            <p className="text-body text-ink-muted">{MATCH_LATER_COPY.intro}</p>
          ) : null}
          {photos.length > 1 ? (
            <ul
              aria-label={MATCH_LATER_COPY.title}
              className="-mx-page-gutter flex gap-2 overflow-x-auto px-page-gutter pb-1"
            >
              {photos.map((p, i) => (
                <li key={p.id} className="shrink-0">
                  <button
                    type="button"
                    aria-current={p === photo ? "true" : undefined}
                    aria-label={`Photo ${i + 1} of ${photos.length}`}
                    disabled={busy}
                    onClick={() => {
                      setProblem(null)
                      setShown(p.id)
                    }}
                    className={cn(
                      "block size-14 overflow-hidden rounded-control bg-media-placeholder focus-ring",
                      p === photo &&
                        "ring-3 ring-accent ring-offset-2 ring-offset-canvas"
                    )}
                  >
                    {p.thumbnailUrl ? (
                      <Photo
                        src={p.thumbnailUrl}
                        alt=""
                        ratio="1/1"
                        radius="none"
                      />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="-mx-page-gutter grid h-[min(42dvh,24rem)] place-items-center bg-stage">
            {photo.thumbnailUrl ? (
              // A signed URL that expires: next/image would cache it.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo.thumbnailUrl}
                alt={`Photo ${index + 1} of ${photos.length}`}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-body text-on-stage">
                Photo {index + 1} of {photos.length}
              </span>
            )}
          </div>
        </>
      ) : null}
      {chosen.length > 0 ? (
        <MatchPicker
          key={batch ? "batch" : photo?.id}
          board={board}
          onRetryBoard={() => {
            setBoard({ state: "loading" })
            setBoardTry((n) => n + 1)
          }}
          current={null}
          last={last}
          taken={taken}
          visit={visit}
          recent={recent}
          busy={busy}
          onMatch={choose}
          labelling={posting}
          onShared={share}
          onUnsure={STAFF_ALBUM_POSTS ? undefined : unsure}
        />
      ) : photos.length === 0 && !receipt ? (
        <p className="text-body text-ink" role="status">
          {MATCH_LATER_COPY.empty}
        </p>
      ) : null}
      {pending && chosen.length > 0 ? (
        <div
          data-slot="label-confirm"
          className="border-edge sticky bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px))] z-dock -mx-page-gutter grid gap-2 border-t bg-surface px-page-gutter py-3 shadow-raised md:bottom-0"
        >
          <p className="text-heading text-ink">
            {MATCH_LATER_COPY.confirm(chosen.length, pending.name)}
          </p>
          <p className="text-body text-ink-muted">{folderPath(pending)}</p>
          <div className="flex items-center gap-3">
            <Button
              ref={saveButton}
              variant="primary"
              className="flex-1"
              disabled={busy}
              onClick={() => match(pending)}
            >
              {MATCH_LATER_COPY.save}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              {MATCH_LATER_COPY.change}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
