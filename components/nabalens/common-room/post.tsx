import Link from "next/link"

import { cn } from "@/lib/utils"

type PostProps = Omit<React.ComponentProps<"article">, "title"> & {
  /** The face: usually <ProfileAvatar name=… src=… /> (decorative). */
  avatar?: React.ReactNode
  /** The person's name; a link to their profile when `nameHref` is set. */
  name: React.ReactNode
  nameHref?: string
  /** "The Railway · 2 Nov 2026, 14:06": venue and time, muted. */
  meta?: React.ReactNode
  /** Right of the head (a Close link, a menu). */
  headEnd?: React.ReactNode
  /** The photo, edge to edge (no radius). */
  media?: React.ReactNode
  /** Wrap the media in a link (opens the viewer or the task). */
  mediaHref?: string
  /** Accessible name for the media link when the media has no text. */
  mediaLabel?: string
  /** The state chip, in the foot. */
  chip?: React.ReactNode
  /** Foot text beside the chip (what it was for). */
  foot?: React.ReactNode
  /** 16:9 media: accepted photos in a thread, admin library. */
  compact?: boolean
  /** Heading level for the name (h2/h3) when the post needs one in the outline. */
  nameAs?: "h2" | "h3" | "p"
}

/**
 * A colleague's photo as a post (DESIGN.md §4): avatar, name, venue and time,
 * the photo edge to edge, then what it shows (children), its state chip.
 * No likes, comments, reactions or counts. Presentational only.
 */
export function Post({
  avatar,
  name,
  nameHref,
  meta,
  headEnd,
  media,
  mediaHref,
  mediaLabel,
  chip,
  foot,
  compact = false,
  nameAs: NameTag = "p",
  className,
  children,
  ...props
}: PostProps) {
  const mediaBox = media ? (
    <div
      className={cn(
        "relative overflow-hidden bg-media-placeholder [&_img]:size-full [&_img]:object-cover",
        compact ? "aspect-video" : "aspect-[4/3]"
      )}
    >
      {media}
    </div>
  ) : null
  return (
    <article
      data-slot="cr-post"
      className={cn(
        "grid min-w-0 overflow-hidden rounded-card bg-surface shadow-card",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2.5 p-3">
        {avatar}
        <div className="grid min-w-0 flex-1 leading-snug">
          <NameTag className="font-bold [overflow-wrap:anywhere] text-ink">
            {nameHref ? (
              <Link
                href={nameHref}
                className="-my-2.5 inline-flex min-h-11 items-center rounded-control outline-none hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
              >
                {name}
              </Link>
            ) : (
              name
            )}
          </NameTag>
          {meta ? (
            <span className="text-meta [overflow-wrap:anywhere] text-ink-muted">
              {meta}
            </span>
          ) : null}
        </div>
        {headEnd}
      </div>
      {mediaBox && mediaHref ? (
        <Link
          href={mediaHref}
          aria-label={mediaLabel}
          className="block outline-none focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus focus-visible:outline-solid"
        >
          {mediaBox}
        </Link>
      ) : (
        mediaBox
      )}
      {children ? (
        <div className="grid gap-1 px-3 pt-3 text-body">{children}</div>
      ) : null}
      {chip || foot ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2.5 pb-3 text-meta text-ink-muted">
          {foot ? <span className="min-w-0">{foot}</span> : null}
          {chip}
        </div>
      ) : (
        <div className="h-3" aria-hidden />
      )}
    </article>
  )
}
