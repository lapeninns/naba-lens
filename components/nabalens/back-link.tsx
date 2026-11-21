import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

/**
 * The one back link (redesign R1): "← Place", above the page title, a 48px
 * target on staff screens and 40px on manager and admin desktops. Names the
 * page it goes to, never "Back".
 */
export function BackLink({
  href,
  children,
  compact = false,
  onClick,
  className,
}: {
  href: string
  /** The name of the page it goes to. */
  children: React.ReactNode
  /** 40px, for manager and admin desktop pages. */
  compact?: boolean
  /**
   * For a step inside one page (sign-in's "Use a different email"): the
   * handler may preventDefault and change the step instead. href is still
   * the real page, for opening in a new tab.
   */
  onClick?: React.MouseEventHandler<HTMLAnchorElement>
  className?: string
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "-ml-1 inline-flex items-center gap-1.5 self-start justify-self-start rounded-control px-1 text-label text-ink focus-ring outline-none hover:underline",
        compact ? "min-h-10" : "min-h-12",
        className
      )}
    >
      <ArrowLeftIcon aria-hidden className="size-5 shrink-0" />
      {children}
    </Link>
  )
}
