import { cn } from "@/lib/utils"

/**
 * A placeholder in the exact shape of what is loading (common-room.md §4): `tile`
 * (square photo), `photo` (4:3, square corners), `av` (avatar), `line`
 * (18px), `line-short` (18px, 55% wide), `title` (28px) or `button` (52px).
 * Flat `surface-2` blocks in the real layout; Common Room skeletons never
 * shimmer or pulse.
 */
function Skeleton({
  className,
  shape,
  ...props
}: React.ComponentProps<"div"> & {
  shape?: "tile" | "photo" | "av" | "line" | "line-short" | "title" | "button"
}) {
  return (
    <div
      data-slot="skeleton"
      data-shape={shape}
      aria-hidden
      className={cn(
        "rounded-control bg-surface-2",
        shape === "tile" && "aspect-square w-full",
        shape === "photo" && "aspect-4/3 w-full rounded-none",
        shape === "av" && "size-11 shrink-0 rounded-round",
        shape === "line" && "h-4.5",
        shape === "line-short" && "h-4.5 w-11/20",
        shape === "title" && "h-7 w-3/5",
        shape === "button" && "h-13",
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
    <div
      data-slot="skeleton-region"
      aria-busy="true"
      className={className}
      {...props}
    >
      <span role="status" className="sr-only">
        {label}
      </span>
      {children}
    </div>
  )
}

/*
 * Named recipes for the layouts that loading files draw (common-room.md §5): the
 * skeleton stands where the content will be, in the same card and gaps. Each
 * is its own SkeletonRegion, so `label` is required ("Loading photos…").
 */
type SkeletonRecipeProps = Omit<
  React.ComponentProps<"div">,
  "children" | "aria-busy"
> & {
  /** The status a screen reader hears, in the area's words. */
  label: string
}

const SKELETON_CARD = "grid gap-2.5 rounded-card bg-surface p-4 shadow-card"

function times(count: number) {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => i)
}

/** A feed of posts: who, the photo, two lines. */
function SkeletonFeed({
  label,
  count = 3,
  className,
  ...props
}: SkeletonRecipeProps & { count?: number }) {
  return (
    <SkeletonRegion
      label={label}
      data-recipe="feed"
      className={cn("grid gap-gutter", className)}
      {...props}
    >
      {times(count).map((post) => (
        <div
          key={post}
          className="grid gap-2.5 overflow-hidden rounded-card bg-surface pb-4 shadow-card"
        >
          <div className="flex items-center gap-2.5 px-3 pt-3">
            <Skeleton shape="av" />
            <div className="grid min-w-0 flex-1 gap-2">
              <Skeleton shape="line" className="w-2/5" />
              <Skeleton shape="line" className="w-1/4" />
            </div>
          </div>
          <Skeleton shape="photo" />
          <div className="grid gap-2 px-3">
            <Skeleton shape="line" />
            <Skeleton shape="line-short" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  )
}

/** Rows in one card with hairlines between them. */
function SkeletonList({
  label,
  count = 4,
  avatar = true,
  className,
  ...props
}: SkeletonRecipeProps & {
  count?: number
  /** Draw the leading circle. Turn off for rows with no avatar or icon. */
  avatar?: boolean
}) {
  return (
    <SkeletonRegion
      label={label}
      data-recipe="list"
      className={cn(
        "grid divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card",
        className
      )}
      {...props}
    >
      {times(count).map((row) => (
        <div key={row} className="flex min-h-18 items-center gap-3 p-3">
          {avatar ? <Skeleton shape="av" /> : null}
          <div className="grid min-w-0 flex-1 gap-2">
            <Skeleton shape="line" className="w-2/5" />
            <Skeleton shape="line" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  )
}

/** A grid of square photo tiles, as wide as the real grid. */
function SkeletonGrid({
  label,
  count = 6,
  className,
  ...props
}: SkeletonRecipeProps & { count?: number }) {
  return (
    <SkeletonRegion
      label={label}
      data-recipe="grid"
      className={cn("grid grid-cols-tiles gap-2", className)}
      {...props}
    >
      {times(count).map((tile) => (
        <Skeleton key={tile} shape="tile" />
      ))}
    </SkeletonRegion>
  )
}

/** One item's page: its title, a photo, the text and the main action. */
function SkeletonDetail({ label, className, ...props }: SkeletonRecipeProps) {
  return (
    <SkeletonRegion
      label={label}
      data-recipe="detail"
      className={cn(SKELETON_CARD, "gap-3", className)}
      {...props}
    >
      <Skeleton shape="title" />
      <Skeleton shape="line" className="w-1/3" />
      <Skeleton shape="photo" className="rounded-control" />
      <Skeleton shape="line" />
      <Skeleton shape="line-short" />
      <Skeleton shape="button" />
    </SkeletonRegion>
  )
}

/** A form: a label and a 56px field for each, then the button. */
function SkeletonForm({
  label,
  fields = 3,
  className,
  ...props
}: SkeletonRecipeProps & { fields?: number }) {
  return (
    <SkeletonRegion
      label={label}
      data-recipe="form"
      className={cn(SKELETON_CARD, "gap-4", className)}
      {...props}
    >
      {times(fields).map((field) => (
        <div key={field} className="grid gap-2">
          <Skeleton shape="line" className="w-1/3" />
          <Skeleton className="h-14" />
        </div>
      ))}
      <Skeleton shape="button" />
    </SkeletonRegion>
  )
}

export {
  Skeleton,
  SkeletonRegion,
  SkeletonFeed,
  SkeletonList,
  SkeletonGrid,
  SkeletonDetail,
  SkeletonForm,
}
