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
        // Common Room empty state (DESIGN.md §5): icon, what appears here,
        // how it gets there, one action at most. A white card on the canvas.
        "grid justify-items-center gap-2.5 text-center",
        inline ? "px-4 py-8" : "rounded-card bg-surface px-5 py-8 shadow-card",
        className
      )}
    >
      <span
        aria-hidden
        className="mb-1 grid size-18 place-items-center rounded-round bg-surface-2 text-ink-muted"
      >
        {variant === "filtered" ? (
          <MagnifyingGlassIcon className="size-9" />
        ) : (
          <ImageIcon className="size-9" />
        )}
      </span>
      <Title className="max-w-[32ch] font-display text-section-title text-ink">
        {title}
      </Title>
      {description ? (
        <div className="max-w-[40ch] text-body text-ink-muted">
          {description}
        </div>
      ) : null}
      {action ? (
        <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>
      ) : null}
    </div>
  )
}
