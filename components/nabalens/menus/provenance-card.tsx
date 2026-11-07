import type { MenuVersionSummary } from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import { formatDateTime, plural, SOURCE_KIND_LABEL } from "./copy"

type ProvenanceCardProps = {
  version: Pick<
    MenuVersionSummary,
    | "status"
    | "source"
    | "revision"
    | "createdAt"
    | "createdByName"
    | "updatedAt"
    | "reviewedAt"
    | "activatedAt"
    | "activatedByName"
    | "retiredAt"
  > &
    Partial<Pick<MenuVersionSummary, "itemCount" | "sectionCount">>
  /** Panel heading; also its accessible name. */
  title?: string
  /** A closing line under the details, e.g. why the version is read-only. */
  note?: React.ReactNode
  className?: string
}

const SHORT_HASH = 12

const termClass = "text-meta text-ink-muted"

/** Where a version came from and who moved it through its states. */
export function ProvenanceCard({
  version,
  title = "Menu version",
  note,
  className,
}: ProvenanceCardProps) {
  const { source } = version
  const by = (name: string | null) => (name ? ` · ${name}` : "")

  const rows: { term: string; value: React.ReactNode }[] = []
  if (version.status === "active" && version.activatedAt) {
    rows.push({
      term: "Activated",
      value: `${formatDateTime(version.activatedAt)}${by(version.activatedByName)}`,
    })
  } else if (version.status === "retired") {
    rows.push({
      term: "Retired",
      value: formatDateTime(version.retiredAt ?? version.updatedAt),
    })
  } else if (version.status === "discarded") {
    rows.push({ term: "Discarded", value: formatDateTime(version.updatedAt) })
  } else {
    rows.push({
      term: "Last saved",
      value: `${formatDateTime(version.updatedAt)} · revision ${version.revision}`,
    })
  }
  if (version.itemCount !== undefined) {
    rows.push({
      term: "Items",
      value:
        version.sectionCount !== undefined
          ? `${version.itemCount} in ${plural(version.sectionCount, "section")}`
          : String(version.itemCount),
    })
  }
  rows.push({
    term: "Source",
    value: (
      <span className="grid gap-0.5">
        {source.label ? (
          <span className="font-mono text-mono break-all">{source.label}</span>
        ) : null}
        <span>{SOURCE_KIND_LABEL[source.kind]}</span>
      </span>
    ),
  })
  if (source.sha256) {
    rows.push({
      term: "File SHA-256",
      value: (
        <details className="group min-w-0">
          <summary className="cursor-pointer rounded-chip font-mono text-mono outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid">
            {source.sha256.slice(0, SHORT_HASH)}…
            <span className="ml-2 font-sans text-ink-muted group-open:hidden">
              Show full value
            </span>
            <span className="ml-2 hidden font-sans text-ink-muted group-open:inline">
              Hide full value
            </span>
          </summary>
          <code className="mt-1 block font-mono text-mono break-all select-all">
            {source.sha256}
          </code>
        </details>
      ),
    })
  }
  if (source.revision) {
    rows.push({
      term: "Source revision",
      value: (
        <code className="font-mono text-mono break-all">{source.revision}</code>
      ),
    })
  }
  if (source.capturedAt) {
    rows.push({
      term: "Source captured",
      value: formatDateTime(source.capturedAt),
    })
  }
  if (source.notes) {
    rows.push({
      term: "Source notes",
      value: (
        <span className="[overflow-wrap:anywhere] whitespace-pre-line">
          {source.notes}
        </span>
      ),
    })
  }
  rows.push({
    term: "Created",
    value: `${formatDateTime(version.createdAt)}${by(version.createdByName)}`,
  })
  if (version.reviewedAt) {
    rows.push({ term: "Reviewed", value: formatDateTime(version.reviewedAt) })
  }
  if (version.status === "retired" && version.activatedAt) {
    rows.push({
      term: "Activated",
      value: `${formatDateTime(version.activatedAt)}${by(version.activatedByName)}`,
    })
  }

  return (
    <section
      aria-label={title}
      className={cn(
        "grid gap-4 rounded-card bg-surface p-4 shadow-card",
        className
      )}
    >
      <h2 className="font-display text-section-title text-ink">{title}</h2>
      <dl className="grid gap-3 text-body text-ink">
        {rows.map((row) => (
          <div
            key={row.term}
            className="grid min-w-0 gap-0.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-3"
          >
            <dt className={termClass}>{row.term}</dt>
            <dd className="min-w-0 font-bold [overflow-wrap:anywhere]">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {note ? <p className="text-body text-ink-muted">{note}</p> : null}
    </section>
  )
}
