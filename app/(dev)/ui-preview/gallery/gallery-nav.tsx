"use client"

import * as React from "react"

import { fieldControlVariants } from "@/components/ui/field-control"
import { cn } from "@/lib/utils"

import { GALLERY_SECTIONS } from "./fixtures"

/*
 * The gallery's in-page nav (common-room.md §7): a list of anchors beside the
 * content from md, and one native select on a phone, where eleven links
 * would push the content off the first screen. Both stay in view while the
 * page scrolls. A native select is used on purpose: it needs no popup of our
 * own and works with every keyboard and screen reader.
 */
export function GalleryNav({ className }: { className?: string }) {
  const selectId = React.useId()
  const go = (id: string) => {
    if (!id) return
    const target = document.getElementById(id)
    if (!target) return
    // Move the address, the scroll position and focus together, as following
    // the link would.
    window.location.hash = id
    target.focus({ preventScroll: true })
    target.scrollIntoView()
  }
  return (
    <nav
      aria-label="Gallery sections"
      data-slot="gallery-nav"
      className={cn(
        "sticky top-0 z-sticky -mx-page-gutter bg-canvas px-page-gutter py-2 shadow-bar md:top-4 md:mx-0 md:max-h-[calc(100dvh-2rem)] md:overflow-y-auto md:rounded-card md:bg-surface md:p-2 md:shadow-card",
        className
      )}
    >
      <div className="grid gap-1.5 md:hidden">
        <label htmlFor={selectId} className="text-label text-ink">
          Go to section
        </label>
        <select
          id={selectId}
          defaultValue=""
          onChange={(event) => {
            go(event.target.value)
            event.target.value = ""
          }}
          className={fieldControlVariants({ size: "sm" })}
        >
          <option value="">Choose a section…</option>
          {GALLERY_SECTIONS.map((section) => (
            <option key={section.id} value={section.id}>
              {section.title}
            </option>
          ))}
        </select>
      </div>
      <ul className="hidden gap-0.5 md:grid">
        {GALLERY_SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="flex min-h-11 items-center rounded-control px-3 text-label text-ink focus-ring-inset outline-none hover:bg-surface-2"
            >
              {section.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
