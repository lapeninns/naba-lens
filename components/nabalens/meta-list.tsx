import { cn } from "@/lib/utils"

export type MetaItem = {
  /** The label, such as "Uploaded" or "Taken". */
  label: string
  /** The value. Leave the row out when it does not apply; never "N/A". */
  value: React.ReactNode
  /**
   * Keep the label for screen readers only, for a value that names itself
   * ("Taken 12 Nov 2026"); the value then spans both columns.
   */
  labelHidden?: boolean
}

/**
 * v2 MetaList (`nl-meta`, D10): facts about one photo or record as label and
 * value pairs in a `<dl>`: labels in caption ink-muted, values in ink, two
 * columns, values wrap. Rows are shown in the order given. Uploaded and Taken
 * are separate rows; an unknown capture date is written "Capture date
 * unknown" by the caller, never the upload date.
 */
export function MetaList({
  items,
  className,
}: {
  items: MetaItem[]
  className?: string
}) {
  return (
    <dl
      data-slot="meta-list"
      className={cn(
        "grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-2",
        className
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt
            className={cn(
              "text-meta text-ink-muted",
              item.labelHidden && "sr-only"
            )}
          >
            {item.label}
          </dt>
          <dd
            className={cn(
              "text-label font-normal [overflow-wrap:anywhere] text-ink",
              item.labelHidden && "col-span-2"
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
