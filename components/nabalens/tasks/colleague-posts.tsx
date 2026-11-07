import Link from "next/link"
import { ImagesIcon } from "@phosphor-icons/react/dist/ssr"

import { buttonVariants } from "@/components/ui/button"

import { Post } from "../common-room"
import { formatDate } from "../format"
import { ProfileAvatar } from "../profile-avatar"
import type { MediaItem } from "../types"

/** How many of the newest posts Home shows; the Photos page has the rest. */
export const COLLEAGUE_POST_LIMIT = 3

/**
 * Newest photos from colleagues, below To do, as posts (DESIGN.md §4): the
 * person, the venue, the photo edge to edge. Read-only: each post links to
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
      className="grid gap-(--gutter)"
    >
      <div className="px-1 pt-2">
        <h2
          id="colleagues-heading"
          className="font-display text-section-title [overflow-wrap:anywhere] text-ink"
        >
          From your colleagues
        </h2>
      </div>
      <ul className="grid gap-(--gutter)">
        {posts.map((item) => (
          <li key={item.id} className="min-w-0">
            <Post
              avatar={<ProfileAvatar name={item.contributorName} />}
              name={
                <>
                  {item.contributorName}
                  <span className="sr-only">&apos;s profile</span>
                </>
              }
              nameHref={`${peopleHref}/${item.contributorId}`}
              meta={item.venueName}
              mediaHref={photosHref}
              media={
                // Signed private URLs: not routed through next/image.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.thumbnailUrl!}
                  alt={`Photo by ${item.contributorName}, ${item.venueName}, uploaded ${formatDate(item.createdAt)}`}
                  loading="lazy"
                  decoding="async"
                />
              }
            />
          </li>
        ))}
      </ul>
      <Link
        href={photosHref}
        className={buttonVariants({
          variant: "secondary",
          className: "w-full",
        })}
      >
        <ImagesIcon data-icon="inline-start" aria-hidden />
        See more photos
      </Link>
    </section>
  )
}
