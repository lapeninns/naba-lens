import Link from "next/link"

import { formatDate } from "../format"
import { ProfileAvatar } from "../profile-avatar"
import type { MediaItem } from "../types"

/** How many of the newest posts Home shows; the Photos page has the rest. */
export const COLLEAGUE_POST_LIMIT = 3

/**
 * Newest photos from colleagues, below To do. Read-only: each post links to
 * the Photos page, which owns the viewer. Renders nothing without posts.
 */
export function ColleaguePosts({
  items,
  photosHref,
  peopleHref,
}: {
  items: MediaItem[]
  /** The Photos page ("/staff/community"). */
  photosHref: string
  /** Where a person's profile lives ("/staff/people"). */
  peopleHref: string
}) {
  const posts = items
    .filter((item) => item.mediaType === "image" && item.thumbnailUrl)
    .slice(0, COLLEAGUE_POST_LIMIT)
  if (posts.length === 0) return null

  return (
    <section
      aria-labelledby="colleagues-heading"
      className="flex flex-col gap-4"
    >
      <h2
        id="colleagues-heading"
        className="font-display text-section-title-touch break-words text-ink md:text-section-title"
      >
        From your colleagues
      </h2>
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((item) => (
          <li key={item.id} className="flex min-w-0 flex-col gap-2">
            <Link
              href={`${peopleHref}/${item.contributorId}`}
              aria-label={`${item.contributorName}'s profile`}
              className="flex min-w-0 items-center gap-2 text-body-touch font-medium text-ink md:text-body"
            >
              <ProfileAvatar name={item.contributorName} size="sm" />
              <span className="min-w-0 truncate" aria-hidden>
                {item.contributorName}
              </span>
            </Link>
            <Link
              href={photosHref}
              className="block aspect-square overflow-hidden rounded-print bg-media-placeholder outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
            >
              {/* Signed private URLs: not routed through next/image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.thumbnailUrl!}
                alt={`Photo by ${item.contributorName}, ${item.venueName}, uploaded ${formatDate(item.createdAt)}`}
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
            </Link>
            <p className="text-meta-touch text-ink-muted md:text-meta">
              {item.venueName}
            </p>
          </li>
        ))}
      </ul>
      <Link
        href={photosHref}
        className="w-fit text-body-touch font-medium text-ink underline underline-offset-3 md:text-body"
      >
        See more photos
      </Link>
    </section>
  )
}
