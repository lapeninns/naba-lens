import { cn } from "@/lib/utils"

/** A section's h2 with its quiet count or rule, and an optional trailing action. */
export function MenuSectionHead({
  id,
  title,
  count,
  action,
  as: Heading = "h2",
  className,
}: {
  id?: string
  title: React.ReactNode
  count?: React.ReactNode
  action?: React.ReactNode
  as?: "h2" | "h3"
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-3",
        className
      )}
    >
      <Heading
        id={id}
        className="text-section-title-touch text-ink md:text-section-title"
      >
        {title}
      </Heading>
      {count ? (
        <span className="text-meta-touch text-ink-muted md:text-meta">
          {count}
        </span>
      ) : null}
      {action ? <span className="ml-auto self-center">{action}</span> : null}
    </div>
  )
}

/** Row list frame shared by the menus screens. */
export const menuListClassName =
  "divide-y divide-line overflow-hidden rounded-panel border border-line bg-panel"

/** A whole row that opens something. */
export const menuRowLinkClassName =
  "flex min-h-16 items-center gap-3 px-4 py-3 text-ink outline-none hover:bg-fill-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"

export const menuItemTitleClassName =
  "text-item-title-touch text-ink md:text-item-title"

export const menuMetaClassName = "text-meta-touch text-ink-muted md:text-meta"
