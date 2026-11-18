import Link from "next/link"

import {
  actionWords,
  revisionText,
  sourceWords,
  type ActivityItem,
} from "@/lib/ops/activity"

const DATE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

const ROLE: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  staff: "Staff",
  system: "System",
}

/**
 * One row per change: what, who (linking to their other changes), where,
 * when, the revision it moved and the reason given. A list, not a table, so
 * it reads at 320px without sideways scrolling (DESIGN.md §8).
 */
export function ActivityList({
  items,
  filters,
}: {
  items: ActivityItem[]
  /** The current filters, kept on the person links. */
  filters: string
}) {
  return (
    <ol className="grid divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
      {items.map((item) => {
        const revision = revisionText(item)
        const query = new URLSearchParams(filters)
        if (item.actorId) query.set("person", item.actorId)
        const personHref = item.actorId ? `/admin/activity?${query}` : null
        return (
          <li
            key={`${item.source}-${item.id}`}
            className="grid gap-1 px-4 py-3.5"
          >
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-bold text-ink">
                {actionWords(item.action)}
              </span>
              <span className="text-meta text-ink-muted">
                {sourceWords(item.source)}
              </span>
            </p>
            <p className="text-body text-ink">
              {personHref ? (
                <Link href={personHref} className="text-accent-text underline">
                  {item.actorName ?? "Former account"}
                </Link>
              ) : (
                "System"
              )}{" "}
              <span className="text-ink-muted">
                · {ROLE[item.actorRole] ?? item.actorRole}
              </span>
              {item.venueName ? (
                <span className="text-ink-muted"> · {item.venueName}</span>
              ) : null}
            </p>
            <p className="font-mono text-meta text-ink-muted tabular-nums">
              <time dateTime={item.at}>{DATE.format(new Date(item.at))}</time>
              {revision ? ` · ${revision}` : null}
            </p>
            {item.reason ? (
              <p className="text-body text-ink">&ldquo;{item.reason}&rdquo;</p>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
