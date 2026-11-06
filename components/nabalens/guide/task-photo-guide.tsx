import Link from "next/link"

import { GUIDE_ANGLES, type GuideAngle } from "@/lib/guide/dish-guide"

import { DishGuide } from "./dish-guide"

export const GUIDE_PATH = "/staff/tasks/guide"

/** "This section needs 2 photos. Start with the marked angles." */
export function guideLede(photoTarget: number | null | undefined): string {
  if (typeof photoTarget !== "number" || !(photoTarget >= 1)) return ""
  const target = Math.floor(photoTarget)
  const needs = `This section needs ${target} ${target === 1 ? "photo" : "photos"}.`
  if (target >= GUIDE_ANGLES.length) return `${needs} Use all four angles.`
  return target === 1
    ? `${needs} Start with the marked angle.`
    : `${needs} Start with the marked angles.`
}

/**
 * "How to photograph it" on a food menu-section task: the four example angles
 * with the first ones marked for the section's photo target.
 */
export function TaskPhotoGuide({
  photoTarget,
  suggested,
}: {
  photoTarget: number | null | undefined
  suggested: GuideAngle[]
}) {
  const lede = guideLede(photoTarget)
  return (
    <section
      aria-labelledby="photo-guide-heading"
      className="grid gap-4 rounded-panel border border-line bg-panel p-4 md:p-5"
    >
      <div className="grid gap-1">
        <h2
          id="photo-guide-heading"
          className="text-section-title-touch md:text-section-title"
        >
          How to photograph it
        </h2>
        {lede ? (
          <p className="max-w-(--size-reading) text-body-touch text-ink-muted md:text-body">
            {lede}
          </p>
        ) : null}
      </div>
      <DishGuide suggested={suggested} />
      <p className="max-w-(--size-reading) text-body-touch text-ink-muted md:text-body-sm">
        Examples, not your menu. Same plain dark background every time.
      </p>
      <Link
        href={GUIDE_PATH}
        className="inline-flex min-h-11 items-center self-start text-body-touch font-semibold text-accent-text underline underline-offset-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid md:min-h-0 md:text-body"
      >
        See the full photo guide
      </Link>
    </section>
  )
}
