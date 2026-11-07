"use client"

import * as React from "react"
import { CheckIcon } from "@phosphor-icons/react"

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
  /**
   * `grid`: two-up tiles inside the task's guide card. `posts`: one post per
   * angle (number, name, the example edge to edge, the tip), the guide page.
   */
  layout?: "grid" | "posts"
}

/**
 * Four example angles of one dish, in order. Dish buttons switch the example;
 * each tile opens the full-screen viewer at that angle.
 */
export function DishGuide({
  suggested,
  initialDish,
  headingLevel = 3,
  layout = "grid",
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

  const posts = layout === "posts"

  return (
    <div className="flex min-w-0 flex-col gap-(--gutter)">
      <div
        role="group"
        aria-label="Example dish"
        className="flex flex-wrap gap-2"
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
                "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-round bg-surface-2 px-4 text-label whitespace-nowrap text-ink transition-colors duration-(--duration-quick) outline-none hover:bg-raised focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid",
                pressed &&
                  "bg-accent-soft text-accent-text shadow-[inset_0_0_0_2px_var(--accent-text)] hover:bg-accent-soft"
              )}
            >
              {pressed ? (
                <CheckIcon aria-hidden weight="bold" className="size-[18px]" />
              ) : null}
              {d.name}
            </button>
          )
        })}
      </div>

      <ul
        className={
          posts
            ? "grid gap-(--gutter)"
            : "grid grid-cols-2 gap-x-2 gap-y-4 md:grid-cols-4 md:gap-x-3"
        }
      >
        {GUIDE_ANGLES.map((angle, index) => {
          const image = dish.images[angle.id]
          const isSuggested = suggested.includes(angle.id)
          const number = (
            <span
              aria-hidden
              className={cn(
                "grid shrink-0 place-items-center rounded-round font-display font-extrabold tabular-nums",
                posts
                  ? "size-9 bg-ink text-[1.1875rem] text-surface"
                  : "absolute top-2 left-2 size-8 bg-tile-badge text-label text-on-tile-badge"
              )}
            >
              {index + 1}
            </span>
          )
          const tile = (
            <button
              type="button"
              aria-label={`${angle.name}${isSuggested ? ", suggested" : ""}. Open example`}
              onClick={(event) => {
                opener.current = event.currentTarget
                setViewer({ open: true, index })
              }}
              className={cn(
                "relative block w-full cursor-zoom-in overflow-hidden bg-stage outline-none focus-visible:outline-3 focus-visible:outline-focus focus-visible:outline-solid",
                posts
                  ? "focus-visible:-outline-offset-3"
                  : "rounded-control focus-visible:outline-offset-2"
              )}
            >
              {/* Pre-sized static example; no image optimiser (no-image-optimiser.test.ts). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.src}
                srcSet={`${image.src} ${image.width}w, ${image.src2x} ${image.width2x}w`}
                sizes={
                  posts
                    ? "(min-width: 640px) 600px, 100vw"
                    : "(min-width: 768px) 25vw, 50vw"
                }
                width={image.width}
                height={image.height}
                alt=""
                loading="lazy"
                decoding="async"
                className="aspect-4/3 h-auto w-full object-cover"
              />
              {posts ? null : number}
            </button>
          )
          const name = (
            <Heading
              className={cn(
                "font-display text-ink",
                posts ? "text-section-title" : "text-item-title"
              )}
            >
              {angle.name}
            </Heading>
          )
          const suggestedMark = isSuggested ? (
            <span aria-hidden className="text-meta text-ink-muted">
              Suggested
            </span>
          ) : null
          if (posts) {
            return (
              <li
                key={angle.id}
                className="grid min-w-0 overflow-hidden rounded-card bg-surface shadow-card"
              >
                <div className="flex min-w-0 items-center gap-2.5 p-3">
                  {number}
                  {name}
                  {suggestedMark}
                </div>
                {tile}
                <p className="px-3 pt-3 pb-3.5 text-body text-ink">
                  {angle.tip}
                </p>
              </li>
            )
          }
          return (
            <li key={angle.id} className="flex min-w-0 flex-col gap-1.5">
              {tile}
              <div className="grid gap-0">
                {name}
                {suggestedMark}
              </div>
              <p className="text-body text-ink-muted">{angle.tip}</p>
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
