import { ImageIcon, MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

export const STAFF_EMPTY_COPY =
  "Your profile starts here. Add your first photo or video."

type EmptyStateProps = {
  title?: string
  description?: React.ReactNode
  action?: React.ReactNode
  /**
   * `first-use`: a photo icon disc and the action that fills the list.
   * `filtered`: nothing matches; say the filters and offer "Clear filters".
   * `done`: a plain line in the list's place, nothing waiting.
   */
  variant?: "first-use" | "filtered" | "done"
  /** Drop the frame inside a panel. */
  inline?: boolean
  /** The title's element: a heading when the empty state is the whole page. */
  titleAs?: "p" | "h1" | "h2"
  className?: string
}

/** What a list or grid shows when it has nothing in it: why, and what fills it. */
export function EmptyState({
  title = STAFF_EMPTY_COPY,
  description,
  action,
  variant = "first-use",
  inline = false,
  titleAs: Title = "p",
  className,
}: EmptyStateProps) {
  if (variant === "done") {
    return (
      <div
        data-slot="empty-state"
        className={cn("px-1 py-4 text-body text-ink-muted", className)}
      >
        <Title>{title}</Title>
        {description ? <p>{description}</p> : null}
      </div>
    )
  }
  return (
    <div
      data-slot="empty-state"
      className={cn(
        // v2 EmptyState (`nl-empty`, D10): a 32px line icon in ink-muted, a
        // title, one sentence, at most one action. No illustration and no
        // card; `inline` only tightens the space inside a panel.
        "grid justify-items-center gap-2 text-center",
        inline ? "px-4 py-6" : "px-4 py-8",
        className
      )}
    >
      <span aria-hidden className="text-ink-muted">
        {variant === "filtered" ? (
          <MagnifyingGlassIcon className="size-8" />
        ) : (
          <ImageIcon className="size-8" />
        )}
      </span>
      <Title className="max-w-[32ch] type-title text-ink">{title}</Title>
      {description ? (
        <div className="max-w-[36ch] text-body text-ink-muted">
          {description}
        </div>
      ) : null}
      {action ? (
        <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>
      ) : null}
    </div>
  )
}
