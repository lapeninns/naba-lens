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
import { Photo } from "@/components/ui/photo"
import type { ContentType, SaveLabelsInput } from "@/lib/menus/types"
import {
  ALBUM_UPLOAD_TRAY,
  STAFF_PHOTO_ROUTES,
} from "@/lib/config/album-upload-tray"
import { cn } from "@/lib/utils"

import { MATCH_LATER_COPY } from "./copy"
import {
  readLastPlace,
  readRecentSlots,
  writeLastPlace,
  writeRecentSlot,
} from "./last-place"
import { MatchPicker, type BoardState } from "./match-picker"
import { ALBUM_HREF } from "./match-screen"
import { placeKey, type MatchSlot, type SharedKind } from "./model"

/** Where Match later lives. */
export const MATCH_LATER_HREF = "/staff/album/match-later"

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
  href = MATCH_LATER_HREF,
}: {
  count: number
  href?: string
}) {
  if (count <= 0) return null
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
        <span className="text-heading">{MATCH_LATER_COPY.title}</span>
        <span className="text-body text-ink-muted tabular-nums">
          {MATCH_LATER_COPY.row(count)}
        </span>
      </span>
      <span className="text-label text-accent-text">
        {MATCH_LATER_COPY.rowAction}
      </span>
      <CaretRightIcon aria-hidden className="size-5 shrink-0" />
    </Link>
  )
}

type LabelTarget = { venueId: string; catalogueVersionId: string | null }

/** What the server said, as the screen shows it. */
type Problem = { id: string; message: string } | null

/*
 * Match later (DESIGN.md §2.8, §6.1): one unmatched photo at a time on the
 * stage, the strip of the rest, and the match picker. A dish saves the dish
 * as the photo's menu label, an area its venue-area label (G-9), Not for a
 * slot what it shows; each matched photo leaves the list. Match later is
 * the one place a photo is matched after it was sent: it was sent without a
 * slot on purpose (D9).
 */
export function MatchLaterScreen({
  photos: initial,
  headingLevel = 1,
}: {
  photos: MatchLaterPhoto[]
  headingLevel?: 1 | 2
}) {
  const router = useRouter()
  const [photos, setPhotos] = React.useState(initial)
  const [shown, setShown] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [problem, setProblem] = React.useState<Problem>(null)
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
    if (result.ok) return null
    return result.code === "forbidden" || result.code === "not_found"
      ? MATCH_LATER_COPY.refused
      : result.message || MATCH_LATER_COPY.saveFailed
  }

  const settle = async (
    item: MatchLaterPhoto,
    send: () => Promise<string | null>,
    slot: MatchSlot | null
  ) => {
    setBusy(true)
    setProblem(null)
    let message: string | null
    try {
      message = await send()
    } catch {
      message = MATCH_LATER_COPY.saveFailed
    }
    setBusy(false)
    if (message) {
      setProblem({ id: item.id, message })
      return
    }
    if (slot) {
      setVisit((v) => [slot.id, ...v.filter((id) => id !== slot.id)])
      writeLastPlace(placeKey(slot.place))
      setLast(placeKey(slot.place))
      writeRecentSlot(
        board.state === "ready" ? (board.board.venue?.id ?? null) : null,
        slot.id
      )
    }
    setPhotos((list) => list.filter((p) => p.id !== item.id))
    setShown(null)
    router.refresh()
  }

  const match = (slot: MatchSlot) => {
    if (!photo) return
    const item = photo
    void settle(
      item,
      async () => {
        if (slot.target.kind === "dish")
          return saveLabels(item, {
            items: [{ itemId: slot.target.itemId, variantId: null }],
            contentTypes: [],
          })
        const result = await setAreaLabelAction(item.id, slot.target.subjectId)
        return result.ok ? null : result.message || MATCH_LATER_COPY.saveFailed
      },
      slot
    )
  }

  // I'm not sure (FA-4, spec §5.3): the manager chooses the slot, here too
  // (S3-R12: a photo that reached Match later because the first request
  // failed is offered it again).
  const unsure = () => {
    if (!photo) return
    const item = photo
    void settle(
      item,
      async () => {
        const result = await requestLabelHelpAction(item.id)
        return result.ok ? null : result.message || MATCH_LATER_COPY.saveFailed
      },
      null
    )
  }

  const share = (kind: SharedKind) => {
    if (!photo) return
    const item = photo
    void settle(
      item,
      () =>
        saveLabels(item, { items: [], contentTypes: [kind as ContentType] }),
      null
    )
  }

  return (
    <div className="grid gap-4 pb-4" data-slot="match-later">
      <div>
        <Link
          href={ALBUM_UPLOAD_TRAY ? STAFF_PHOTO_ROUTES.home : ALBUM_HREF}
          className="inline-flex min-h-12 items-center gap-1 text-label text-ink focus-ring"
        >
          <ArrowLeftIcon aria-hidden className="size-5" />
          {ALBUM_UPLOAD_TRAY ? "Home" : MATCH_LATER_COPY.back}
        </Link>
      </div>
      <header className="grid gap-1">
        <Title className="type-display text-ink">
          {MATCH_LATER_COPY.title}
        </Title>
        <p className="text-caption text-ink-muted tabular-nums">
          {photos.length > 0 ? MATCH_LATER_COPY.row(photos.length) : null}
        </p>
      </header>

      {photo ? (
        <>
          <p className="text-body text-ink-muted">{MATCH_LATER_COPY.intro}</p>
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
          {problem && problem.id === photo.id ? (
            <Notice tone="negative" role="alert">
              {problem.message}
            </Notice>
          ) : null}
          <MatchPicker
            key={photo.id}
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
            onMatch={match}
            onShared={share}
            onUnsure={unsure}
          />
        </>
      ) : (
        <p className="text-body text-ink" role="status">
          {MATCH_LATER_COPY.empty}
        </p>
      )}
    </div>
  )
}
