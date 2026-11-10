"use client"

import Link from "next/link"
import { CaretDownIcon } from "@phosphor-icons/react"

import {
  GUIDE_RULES,
  GUIDE_SAFETY,
  GUIDE_SUBJECT_TIPS,
} from "@/lib/guide/dish-guide"

import { PHOTO_TIPS_TITLE } from "./photo-tips-copy"

/**
 * "What a useful photo shows": optional photo tips (B02 D8), closed until
 * asked for, so someone who knows the process goes straight to the camera.
 * The dish guide's rules, the subject tips and the safety line; the example
 * photos stay on the full guide page (`guideHref`, staff only).
 */
export function PhotoTips({ guideHref }: { guideHref?: string | null }) {
  return (
    <details className="group rounded-touch border border-line-control">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-touch px-4 py-2 text-label-touch text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid md:text-label [&::-webkit-details-marker]:hidden">
        {PHOTO_TIPS_TITLE}
        <CaretDownIcon
          aria-hidden
          weight="bold"
          className="size-5 shrink-0 text-ink-muted transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="grid gap-3 px-4 pt-1 pb-4">
        <ul className="grid list-disc gap-1.5 ps-5 text-body text-ink">
          {GUIDE_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        {GUIDE_SUBJECT_TIPS.map((tip) => (
          <section key={tip.title} className="grid gap-1">
            <h3 className="text-label-touch text-ink md:text-label">
              {tip.title}
            </h3>
            <p className="text-body text-ink-muted">{tip.text}</p>
          </section>
        ))}
        <p className="text-meta-touch text-ink-muted md:text-meta">
          {GUIDE_SAFETY}
        </p>
        {guideHref ? (
          <Link
            href={guideHref}
            className="inline-flex min-h-11 items-center self-start rounded-control text-label text-ink underline outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
          >
            See the full photo guide
          </Link>
        ) : null}
      </div>
    </details>
  )
}
