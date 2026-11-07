import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { Card } from "../common-room/card"

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
    <Card as="section" aria-labelledby="photo-guide-heading">
      <div className="grid gap-1">
        <h2
          id="photo-guide-heading"
          className="font-display text-section-title text-ink"
        >
          How to photograph it
        </h2>
        {lede ? (
          <p className="max-w-(--size-reading) text-body text-ink-muted">
            {lede}
          </p>
        ) : null}
      </div>
      <DishGuide suggested={suggested} />
      <p className="max-w-(--size-reading) text-body text-ink-muted">
        Examples, not your menu. Same plain dark background every time.
      </p>
      <Link
        href={GUIDE_PATH}
        className="-my-1 inline-flex min-h-11 items-center gap-1 justify-self-start rounded-control text-label text-ink underline underline-offset-3 outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
      >
        See the full photo guide
        <CaretRightIcon aria-hidden weight="bold" className="size-4" />
      </Link>
    </Card>
  )
}
