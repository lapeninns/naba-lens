import { ImagesIcon } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/utils"

export const STAFF_EMPTY_COPY =
  "Your portfolio starts here. Upload your first photo or video."

type EmptyStateProps = {
  title?: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

/** Keeps the gallery's frame when there is nothing in it. */
export function EmptyState({
  title = STAFF_EMPTY_COPY,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center",
        className
      )}
    >
      <ImagesIcon className="size-8 text-muted-foreground" aria-hidden />
      <p className="max-w-sm text-base font-medium text-balance">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
