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

/**
 * One read-only search result: the thumbnail and what is known about the
 * asset. Never a link to a viewer, preview, stream or download; no ids,
 * notes, clearance, granter or full names.
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
  const subjects = subjectLines(item)
  const first = item.subjects.menuItems[0]
  const alt = first
    ? SEARCH_COPY.thumbAlt(media, first.itemName)
    : SEARCH_COPY.thumbAltPlain(media, when)

  return (
    <article
      tabIndex={-1}
      data-asset-card
      aria-label={`${media}, ${SEARCH_COPY.uploadedAt(when)}`}
      className="flex h-full min-w-0 gap-3 rounded-card bg-surface p-3 shadow-card outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
    >
      <Thumb url={item.thumbnailUrl} alt={alt} mediaType={item.mediaType} />
      <div className="grid min-w-0 flex-1 content-start gap-1.5 text-body [overflow-wrap:anywhere]">
        <h3 className="font-display text-label text-ink">
          {SEARCH_COPY.uploadedAt(when)}
        </h3>
        <p className="text-ink-muted">
          {[
            media,
            showVenue ? item.venueName : null,
            item.uploaderFirstName
              ? SEARCH_COPY.by(item.uploaderFirstName)
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {subjects.length > 0 ? (
          <ul className="grid gap-0.5 text-ink">
            {subjects.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        ) : null}
        <ul
          aria-label={SEARCH_COPY.useHeading}
          className="flex flex-wrap gap-1.5"
        >
          {useLines(item).map((line) => (
            <li key={line.key} className="max-w-full">
              <StatusChip tone={line.tone}>{line.text}</StatusChip>
            </li>
          ))}
        </ul>
        {item.menuDecisions.length > 0 ? (
          <ul aria-label={SEARCH_COPY.decisionsHeading} className="grid gap-1">
            {item.menuDecisions.map((d) => (
              <li
                key={`${d.itemId}:${d.variantId ?? ""}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1"
              >
                <span className="text-ink">
                  {d.variantName
                    ? `${d.itemName} · ${d.variantName}`
                    : d.itemName}
                </span>
                {d.state === "accepted" ? (
                  <StatusChip state="accepted" />
                ) : (
                  <StatusChip tone={DECISION_TONE[d.state]}>
                    {DECISION_LABEL[d.state]}
                  </StatusChip>
                )}
                {d.isPrimary ? (
                  <span className="text-meta font-bold text-ink">
                    {SEARCH_COPY.menuPhoto}
                  </span>
                ) : null}
              </li>
            ))}
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
    "relative block size-24 shrink-0 overflow-hidden rounded-control bg-media-placeholder md:size-28"
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
