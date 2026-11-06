"use client"

import * as React from "react"

import {
  GUIDE_ANGLES,
  GUIDE_DISHES,
  type GuideAngle,
} from "@/lib/guide/dish-guide"
import { cn } from "@/lib/utils"

import { GuideViewer } from "./guide-viewer"

type DishGuideProps = {
  /** Angles marked "Suggested" (suggestedAngles); none on the guide page. */
  suggested: GuideAngle[]
  /** Dish id shown first; Mixed grill by default. */
  initialDish?: string
  /** Level of each angle name, under the surrounding section heading. */
  headingLevel?: 3 | 4
}

/**
 * Four example angles of one dish, in order. Dish buttons switch the example;
 * each tile opens the full-screen viewer at that angle.
 */
export function DishGuide({
  suggested,
  initialDish,
  headingLevel = 3,
}: DishGuideProps) {
  const [dishId, setDishId] = React.useState(
    () =>
      GUIDE_DISHES.find((d) => d.id === initialDish)?.id ?? GUIDE_DISHES[0].id
  )
  const [viewer, setViewer] = React.useState<{ open: boolean; index: number }>({
    open: false,
    index: 0,
  })
  const opener = React.useRef<HTMLButtonElement | null>(null)
  const dish = GUIDE_DISHES.find((d) => d.id === dishId) ?? GUIDE_DISHES[0]
  const Heading = `h${headingLevel}` as const

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div
        role="group"
        aria-label="Example dish"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {GUIDE_DISHES.map((d) => {
          const pressed = d.id === dish.id
          return (
            <button
              key={d.id}
              type="button"
              aria-pressed={pressed}
              onClick={() => setDishId(d.id)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center rounded-control border border-line-control bg-panel px-3.5 text-body-touch whitespace-nowrap text-ink transition-colors duration-(--duration-quick) outline-none hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid md:text-body",
                pressed &&
                  "border-accent bg-accent-soft font-semibold text-accent-text hover:bg-accent-soft"
              )}
            >
              {d.name}
            </button>
          )
        })}
      </div>

      <ul className="grid grid-cols-2 gap-x-3 gap-y-5 md:grid-cols-4 md:gap-x-4">
        {GUIDE_ANGLES.map((angle, index) => {
          const image = dish.images[angle.id]
          const isSuggested = suggested.includes(angle.id)
          return (
            <li key={angle.id} className="flex min-w-0 flex-col gap-1.5">
              <button
                type="button"
                aria-label={`${angle.name}${isSuggested ? ", suggested" : ""}. Open example`}
                onClick={(event) => {
                  opener.current = event.currentTarget
                  setViewer({ open: true, index })
                }}
                className="relative block overflow-hidden rounded-control bg-viewer outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
              >
                {/* Pre-sized static example; no image optimiser (no-image-optimiser.test.ts). */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.src}
                  srcSet={`${image.src} ${image.width}w, ${image.src2x} ${image.width2x}w`}
                  sizes="(min-width: 768px) 25vw, 50vw"
                  width={image.width}
                  height={image.height}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="aspect-4/3 h-auto w-full object-cover"
                />
                <span
                  aria-hidden
                  className="absolute top-2 left-2 grid size-7 place-items-center rounded-round bg-tile-badge text-chip-touch text-on-tile-badge tabular-nums md:text-chip"
                >
                  {index + 1}
                </span>
                {isSuggested ? (
                  <span
                    aria-hidden
                    className="absolute right-2 bottom-2 rounded-chip bg-positive-soft px-1.5 py-0.5 text-chip-touch text-ink md:text-chip"
                  >
                    Suggested
                  </span>
                ) : null}
              </button>
              <Heading className="text-item-title-touch text-ink md:text-item-title">
                {angle.name}
              </Heading>
              <p className="text-body-touch text-ink-muted md:text-body-sm">
                {angle.tip}
              </p>
            </li>
          )
        })}
      </ul>

      <GuideViewer
        dish={dish}
        index={viewer.index}
        onIndexChange={(index) => setViewer((v) => ({ ...v, index }))}
        open={viewer.open}
        onOpenChange={(open) => setViewer((v) => ({ ...v, open }))}
        returnFocus={() => opener.current}
      />
    </div>
  )
}
