import Link from "next/link"
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { IconDisc } from "./common-room/icon-disc"

export const NOT_FOUND_COPY = {
  title: "We can't find that page",
  body: "The link may be old, or what it showed has been moved or removed.",
} as const

/**
 * A missing page or record: what happened, and the one way back (the screen's
 * one blue button). One white card on the grey canvas.
 */
export function NotFoundCard({
  backHref,
  backLabel,
  titleAs: Title = "h1",
  className,
}: {
  backHref: string
  backLabel: string
  /** The title's element: the page's `h1` unless shown inside another page. */
  titleAs?: "h1" | "h2" | "h3" | "h4"
  className?: string
}) {
  return (
    <section
      aria-labelledby="not-found-title"
      className={cn(
        "grid justify-items-center gap-3 rounded-card bg-surface px-5 py-8 text-center text-ink shadow-card",
        className
      )}
    >
      <IconDisc size="lg" className="text-ink-muted">
        <MagnifyingGlassIcon />
      </IconDisc>
      <Title id="not-found-title" className="type-section-title text-balance">
        {NOT_FOUND_COPY.title}
      </Title>
      <p className="text-body text-pretty text-ink-muted">
        {NOT_FOUND_COPY.body}
      </p>
      <Link
        href={backHref}
        className={buttonVariants({
          variant: "primary",
          className: "mt-2 w-full md:w-auto md:min-w-55",
        })}
      >
        {backLabel}
      </Link>
    </section>
  )
}
