import { CONTENT_TYPE_LABELS, type MediaLabelSummary } from "@/lib/menus/types"
import { cn } from "@/lib/utils"

export const ITEM_STATE_TEXT = {
  not_on_active_menu: "Not on the current menu",
  archived: "Archived",
} as const

/** Nothing saved at all: no items, content types, note or suggestion. */
export function isEmptyLabelSummary(
  labels: MediaLabelSummary | null | undefined
) {
  return (
    !labels ||
    (labels.items.length === 0 &&
      labels.contentTypes.length === 0 &&
      !labels.note &&
      !labels.missingItem)
  )
}

/**
 * Read-only labels of one asset for the media viewer. Shows each menu item
 * with its variant and section, its menu state and "labelled as …" when the
 * item was renamed, the content types, the note and an open missing-item
 * suggestion. Renders "No labels yet" when there is nothing.
 */
export function LabelSummary({
  labels,
  className,
}: {
  labels: MediaLabelSummary | null | undefined
  className?: string
}) {
  if (!labels || isEmptyLabelSummary(labels)) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        No labels yet
      </p>
    )
  }
  return (
    <div className={cn("grid min-w-0 gap-2 text-sm", className)}>
      {labels.items.length > 0 ? (
        <ul aria-label="Menu items" className="grid gap-1">
          {labels.items.map((item) => (
            <li
              key={`${item.itemId}:${item.variantId ?? ""}`}
              className="min-w-0 break-words"
            >
              <span className="font-medium">{item.name}</span>
              {item.variantName ? <span>, {item.variantName}</span> : null}
              {item.sectionName ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {item.sectionName}
                </span>
              ) : null}
              {item.state !== "current" ? (
                <span className="ml-1.5 inline-flex h-5 items-center rounded-sm bg-muted px-1.5 align-middle text-xs font-medium text-muted-foreground">
                  {ITEM_STATE_TEXT[item.state]}
                </span>
              ) : null}
              {item.labelledAs ? (
                <span className="block text-xs text-muted-foreground">
                  labelled as {item.labelledAs}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {labels.contentTypes.length > 0 ? (
        <ul aria-label="Content types" className="flex flex-wrap gap-1.5">
          {labels.contentTypes.map((type) => (
            <li
              key={type}
              className="inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium"
            >
              {CONTENT_TYPE_LABELS[type]}
            </li>
          ))}
        </ul>
      ) : null}
      {labels.note ? (
        <p className="break-words whitespace-pre-line">
          <span className="sr-only">Note: </span>
          {labels.note}
        </p>
      ) : null}
      {labels.missingItem ? (
        <p className="break-words text-muted-foreground">
          Suggested missing item:{" "}
          <span className="text-foreground">{labels.missingItem}</span> (an
          admin will review it)
        </p>
      ) : null}
    </div>
  )
}

/** The text LabelBadge shows; include it in the tile's accessible name. */
export function labelBadgeText(
  labels: MediaLabelSummary | null | undefined
): string | null {
  if (!labels) return null
  if (!labels.hasLabels) return "Needs labels"
  const count = labels.items.length + labels.contentTypes.length
  return count === 1 ? "1 label" : `${count} labels`
}

/**
 * Tiny gallery-tile marker: "Needs labels" or a label count. Renders nothing
 * when the summary is unknown (null/undefined). Not interactive.
 */
export function LabelBadge({
  labels,
  className,
}: {
  labels: MediaLabelSummary | null | undefined
  className?: string
}) {
  const text = labelBadgeText(labels)
  if (!text) return null
  return (
    <span
      data-labelled={labels?.hasLabels || undefined}
      className={cn(
        "inline-flex h-5 items-center rounded-sm px-1.5 text-xs font-medium whitespace-nowrap",
        labels?.hasLabels
          ? "bg-black/70 text-white"
          : "bg-background/90 text-foreground ring-1 ring-foreground/15",
        className
      )}
    >
      {text}
    </span>
  )
}
