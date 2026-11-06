import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

export const STAFF_EMPTY_COPY =
  "Your profile starts here. Add your first photo or video."

type EmptyStateProps = {
  title?: string
  description?: React.ReactNode
  action?: React.ReactNode
  /**
   * `first-use`: three empty frames and the action that fills the list.
   * `filtered`: nothing matches; say the filters and offer "Clear filters".
   * `done`: a plain line in the list's place, nothing waiting.
   */
  variant?: "first-use" | "filtered" | "done"
  /** Drop the frame inside a panel. */
  inline?: boolean
  className?: string
}

/** What a list or grid shows when it has nothing in it: why, and what fills it. */
export function EmptyState({
  title = STAFF_EMPTY_COPY,
  description,
  action,
  variant = "first-use",
  inline = false,
  className,
}: EmptyStateProps) {
  if (variant === "done") {
    return (
      <div
        data-slot="empty-state"
        className={cn("py-4 text-body-touch text-ink-muted md:text-body", className)}
      >
        <p>{title}</p>
        {description ? <p>{description}</p> : null}
      </div>
    )
  }
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "grid justify-items-center gap-3 text-center",
        inline
          ? "py-8"
          : "rounded-panel border border-line px-6 py-12",
        className
      )}
    >
      {variant === "filtered" ? (
        <MagnifyingGlassIcon aria-hidden className="size-7 text-ink-muted" />
      ) : (
        <span aria-hidden className="mb-1 flex gap-1.5">
          {[0, 1, 2].map((frame) => (
            <span
              key={frame}
              className="size-10 rounded-print border border-line-control"
            />
          ))}
        </span>
      )}
      <p className="max-w-[32ch] text-item-title-touch text-ink md:text-item-title">
        {title}
      </p>
      {description ? (
        <div className="max-w-[46ch] text-body-touch text-ink-muted md:text-body-sm">
          {description}
        </div>
      ) : null}
      {action ? (
        <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>
      ) : null}
    </div>
  )
}
