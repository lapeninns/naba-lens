import { cn } from "@/lib/utils"

/**
 * A placeholder in the exact shape of what is loading: `tile` (square), `av`
 * (avatar), `line` (12px) or `title` (22px). It pulses gently on `well` and
 * stands still when motion is reduced.
 */
function Skeleton({
  className,
  shape,
  ...props
}: React.ComponentProps<"div"> & {
  shape?: "tile" | "av" | "line" | "title"
}) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        "animate-pulse rounded-chip bg-well [animation-duration:1600ms]",
        shape === "tile" && "aspect-square w-full rounded-print",
        shape === "av" && "size-10 rounded-round",
        shape === "line" && "h-3",
        shape === "title" && "h-[22px] w-[55%]",
        className
      )}
      {...props}
    />
  )
}

/**
 * The waiting region: `aria-busy` and one visually hidden status ("Loading
 * photos…"). Render the page header, filters and navigation for real around it.
 */
function SkeletonRegion({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { label: string }) {
  return (
    <div aria-busy="true" className={className} {...props}>
      <span role="status" className="sr-only">
        {label}
      </span>
      {children}
    </div>
  )
}

export { Skeleton, SkeletonRegion }
