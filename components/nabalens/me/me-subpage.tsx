import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

/**
 * The head of a page under Me (DESIGN.md §5b): "← Me", the page's title and
 * an optional action beside it.
 */
export function MeSubpageHeader({
  title,
  action = null,
}: {
  title: string
  action?: React.ReactNode
}) {
  return (
    <div className="grid gap-1">
      <Link
        href="/staff/me"
        className="inline-flex min-h-12 items-center gap-1.5 justify-self-start text-label text-ink focus-ring"
      >
        <ArrowLeftIcon aria-hidden className="size-5" />
        Me
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="type-page-title text-ink">{title}</h1>
        {action}
      </div>
    </div>
  )
}
