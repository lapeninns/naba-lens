"use client"

import * as React from "react"
import { CaretDownIcon, QuestionIcon } from "@phosphor-icons/react"

/*
 * "If you can't add photos" as a row on the Photo guide (screens-2 handoff):
 * a closed disclosure holding the whole help section, unchanged inside. A
 * link to it (`#cant-add`, from Help and Settings) opens it.
 */
export function CantAddDisclosure({
  id,
  title,
  summary,
  children,
}: {
  id: string
  title: string
  summary: string
  children: React.ReactNode
}) {
  const ref = React.useRef<HTMLDetailsElement>(null)
  React.useEffect(() => {
    const openIfAsked = () => {
      if (window.location.hash === `#${id}` && ref.current) {
        ref.current.open = true
        ref.current.scrollIntoView({ block: "start" })
      }
    }
    openIfAsked()
    window.addEventListener("hashchange", openIfAsked)
    return () => window.removeEventListener("hashchange", openIfAsked)
  }, [id])
  return (
    <details
      ref={ref}
      id={id}
      className="group scroll-mt-20 rounded-card bg-surface shadow-card"
      data-slot="cant-add"
    >
      {/* Drawn as a v2 ListRow: icon, two lines, and the open mark. */}
      <summary className="grid min-h-16 cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-card px-4 py-3 text-left text-ink focus-ring outline-none hover:bg-raised [&::-webkit-details-marker]:hidden">
        <QuestionIcon aria-hidden className="size-5 text-ink-muted" />
        <span className="grid min-w-0 gap-0.5">
          <span className="text-label">{title}</span>
          <span className="text-meta text-ink-muted">{summary}</span>
        </span>
        <CaretDownIcon
          aria-hidden
          weight="bold"
          className="size-5 text-ink-muted transition-transform duration-quick group-open:rotate-180"
        />
      </summary>
      <div className="px-1 pb-1">{children}</div>
    </details>
  )
}
