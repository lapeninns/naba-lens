"use client"

import { CaretDownIcon } from "@phosphor-icons/react"

import {
  GUIDANCE_TITLE,
  shownGuidance,
  type GuidanceScreen,
} from "./screen-guidance"

/**
 * B10-05a: a screen's guidance lines, closed until asked for (the PhotoTips
 * pattern), so someone who knows the screen is never slowed down. Renders
 * nothing when the screen has no shipped line. Pages render it only while
 * screenGuidance() is "on".
 */
export function ScreenGuide({
  screen,
  className,
}: {
  screen: GuidanceScreen
  className?: string
}) {
  const lines = shownGuidance(screen)
  if (lines.length === 0) return null
  return (
    <details
      className={`group rounded-touch border border-line-control ${className ?? ""}`}
      data-screen-guide={screen}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-touch px-4 py-2 text-label-touch text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid md:text-label [&::-webkit-details-marker]:hidden">
        {GUIDANCE_TITLE}
        <CaretDownIcon
          aria-hidden
          weight="bold"
          className="size-5 shrink-0 text-ink-muted transition-transform group-open:rotate-180"
        />
      </summary>
      <ul className="grid list-disc gap-1.5 px-4 ps-9 pt-1 pb-4 text-body text-ink">
        {lines.map((line) => (
          <li key={line.id} className="break-words">
            {line.text}
          </li>
        ))}
      </ul>
    </details>
  )
}
