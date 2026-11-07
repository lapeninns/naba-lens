import { cn } from "@/lib/utils"

/**
 * A placeholder in the exact shape of what is loading: `tile` (square), `av`
 * (avatar), `line` (18px) or `title` (28px). Flat `surface-2` blocks in the
 * real layout; Common Room skeletons never shimmer or pulse.
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
        "rounded-control bg-surface-2",
        shape === "tile" && "aspect-square w-full rounded-control",
        shape === "av" && "size-11 rounded-round",
        shape === "line" && "h-[18px]",
        shape === "title" && "h-7 w-[60%]",
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
