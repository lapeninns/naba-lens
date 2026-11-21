"use client"

import * as React from "react"
import { FilmStripIcon, ImageIcon } from "@phosphor-icons/react"

import type {
  AssetSearchItem,
  SearchMenuDecision,
} from "@/lib/server/media/search/types"
import { cn } from "@/lib/utils"

import { StatusChip, type ChipTone } from "../status-chip"
import {
  ASSET_USE_LINE,
  DECISION_LABEL,
  MEDIA_WORD,
  SEARCH_COPY,
  answerLine,
  dayOf,
  uploadedWhen,
} from "./search-copy"

type Line = { key: string; text: string; tone: ChipTone }

/** What the asset is for, in words (no ids, no question or task internals). */
export function subjectLines(item: AssetSearchItem): string[] {
  const { menuItems, checks, tasks, group } = item.subjects
  const lines = menuItems.map((m) =>
    SEARCH_COPY.forItem(m.itemName, m.variantName)
  )
  if (checks.some((c) => c.source === "amenity"))
    lines.push(SEARCH_COPY.amenityCheck)
  if (checks.some((c) => c.source === "knowledge"))
    lines.push(SEARCH_COPY.venueQuestion)
  if (tasks.length > 0) lines.push(SEARCH_COPY.checklistPhoto)
  if (group) lines.push(SEARCH_COPY.inSet)
  return lines
}

/**
 * The use lines: each place it is in use (with its end), each ended use, else
 * the asset-level word. A menu acceptance never changes these lines.
 */
export function useLines(item: AssetSearchItem): Line[] {
  const { use } = item
  const lines: Line[] = []
  for (const [i, d] of use.destinations.entries()) {
    if (d.state === "in_force")
      lines.push({
        key: `in-${i}`,
        text: SEARCH_COPY.inUseOn(d.label, d.until ? dayOf(d.until) : null),
        tone: "positive",
      })
  }
  for (const [i, d] of use.destinations.entries()) {
    if (d.state === "expired")
      lines.push({
        key: `ended-${i}`,
        text: SEARCH_COPY.endedOn(d.label, d.until ? dayOf(d.until) : null),
        tone: "closed",
      })
  }
  if (!lines.some((l) => l.tone === "positive")) {
    const tone: ChipTone =
      use.state === "granted"
        ? "positive"
        : use.state === "withdrawn"
          ? "closed"
          : "neutral"
    lines.unshift({ key: "asset", text: ASSET_USE_LINE[use.state], tone })
  }
  return lines
}

const DECISION_TONE: Record<SearchMenuDecision["state"], ChipTone> = {
  accepted: "positive",
  better_photo_requested: "attention",
  needs_recheck: "attention",
  withdrawn: "closed",
  invalidated: "closed",
}

/** The tile's title: the slot first ("Himali Lamb · Large"), else what it
 * is evidence for, else the media word (second handoff). */
function tileTitle(item: AssetSearchItem, media: string): string {
  const first = item.subjects.menuItems[0]
  if (first)
    return first.variantName
      ? `${first.itemName} · ${first.variantName}`
      : first.itemName
  return subjectLines(item)[0] ?? media
}

/**
 * One read-only search result as an album-style tile (second handoff): the
 * photo, the slot's name first, then "{Photo|Video} · By {name} · {date}",
 * the use line and each menu decision's chip. Never a link to a viewer,
 * preview, stream or download; no ids, notes, clearance, granter or full
 * names.
 */
export function SearchCard({
  item,
  showVenue,
  now,
}: {
  item: AssetSearchItem
  /** Admins see the venue's name; a manager's venue is the page's. */
  showVenue: boolean
  now: Date
}) {
  const media = MEDIA_WORD[item.mediaType]
  const when = uploadedWhen(item.uploadedAt, now)
  const first = item.subjects.menuItems[0]
  const title = tileTitle(item, media)
  // The title names the first menu item; the rest still say what it is for.
  const subjects = subjectLines(item).filter((line, i) =>
    first ? i > 0 : line !== title
  )
  const alt = first
    ? SEARCH_COPY.thumbAlt(media, first.itemName)
    : SEARCH_COPY.thumbAltPlain(media, when)

  return (
    <article
      tabIndex={-1}
      data-asset-card
      aria-label={`${title}, ${SEARCH_COPY.uploadedAt(when)}`}
      className="grid h-full min-w-0 content-start overflow-hidden rounded-card bg-surface edge focus-ring outline-none"
    >
      <Thumb url={item.thumbnailUrl} alt={alt} mediaType={item.mediaType} />
      <div className="grid min-w-0 content-start gap-1 p-3 text-meta [overflow-wrap:anywhere]">
        <h3 className="text-label text-ink">{title}</h3>
        <p className="text-ink-muted">
          {[
            media,
            showVenue ? item.venueName : null,
            item.uploaderFirstName
              ? SEARCH_COPY.by(item.uploaderFirstName)
              : null,
            when,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {subjects.length > 0 ? (
          <ul className="grid gap-0.5 text-ink-muted">
            {subjects.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        ) : null}
        <ul aria-label={SEARCH_COPY.useHeading} className="grid gap-0.5">
          {useLines(item).map((line) => (
            <li
              key={line.key}
              className={
                line.tone === "positive" ? "text-ink" : "text-ink-muted"
              }
            >
              {line.text}
            </li>
          ))}
        </ul>
        {item.answers.length > 0 ? (
          <ul aria-label={SEARCH_COPY.answersHeading} className="grid gap-0.5">
            {item.answers.map((answer) => (
              <li key={answer.checkId} className="text-ink-muted">
                {answerLine(answer)}
              </li>
            ))}
          </ul>
        ) : null}
        {item.menuDecisions.length > 0 ? (
          <ul
            aria-label={SEARCH_COPY.decisionsHeading}
            className="mt-1 grid gap-1"
          >
            {item.menuDecisions.map((d) => {
              // The tile's title already names a lone decision's dish.
              const named =
                item.menuDecisions.length > 1 ||
                d.itemId !== first?.itemId ||
                (d.variantId ?? null) !== (first?.variantId ?? null)
              return (
                <li
                  key={`${d.itemId}:${d.variantId ?? ""}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1"
                >
                  {d.state === "accepted" ? (
                    <StatusChip state="accepted" />
                  ) : (
                    <StatusChip tone={DECISION_TONE[d.state]}>
                      {DECISION_LABEL[d.state]}
                    </StatusChip>
                  )}
                  {named ? (
                    <span className="text-ink">
                      {d.variantName
                        ? `${d.itemName} · ${d.variantName}`
                        : d.itemName}
                    </span>
                  ) : null}
                  {d.isPrimary ? (
                    <span className="font-semibold text-ink">
                      {SEARCH_COPY.menuPhoto}
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </article>
  )
}

/**
 * A plain <img> on the authorised thumbnail route (signed per request, 60 s):
 * deliberately not next/image, so private media never passes through a shared
 * optimisation cache. One reload on error, then a quiet icon with a word.
 */
function Thumb({
  url,
  alt,
  mediaType,
}: {
  url: string | null
  alt: string
  mediaType: AssetSearchItem["mediaType"]
}) {
  const [attempt, setAttempt] = React.useState(0)
  const Icon = mediaType === "video" ? FilmStripIcon : ImageIcon
  const frame =
    "relative block aspect-square w-full overflow-hidden bg-media-placeholder"
  if (!url || attempt > 1) {
    return (
      <span className={cn(frame, "grid place-items-center text-ink-muted")}>
        <span className="grid justify-items-center gap-1 px-1 text-center text-meta">
          <Icon aria-hidden className="size-7" />
          {SEARCH_COPY.noThumb}
        </span>
      </span>
    )
  }
  return (
    <span className={frame}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={attempt === 0 ? url : `${url}?retry=1`}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setAttempt((a) => a + 1)}
        className="absolute inset-0 size-full object-cover"
      />
    </span>
  )
}
