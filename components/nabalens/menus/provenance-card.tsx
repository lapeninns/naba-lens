import type { MenuVersionSummary } from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import { formatDateTime, SOURCE_KIND_LABEL } from "./copy"
import { MenuVersionStatusBadge } from "./menu-version-status-badge"

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
  >
  className?: string
}

const SHORT_HASH = 12

/** Where a version came from and who moved it through its states. */
export function ProvenanceCard({ version, className }: ProvenanceCardProps) {
  const { source } = version
  const who = (name: string | null) => (name ? ` by ${name}` : "")

  const rows: { term: string; value: React.ReactNode }[] = [
    {
      term: "Status",
      value: <MenuVersionStatusBadge status={version.status} withDescription />,
    },
    { term: "Source", value: SOURCE_KIND_LABEL[source.kind] },
  ]
  if (source.label) {
    rows.push({
      term: "Source name",
      value: <span className="break-all">{source.label}</span>,
    })
  }
  if (source.sha256) {
    rows.push({
      term: "File SHA-256",
      value: (
        <details className="group min-w-0">
          <summary className="cursor-pointer rounded-sm font-mono text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            {source.sha256.slice(0, SHORT_HASH)}…
            <span className="ml-2 font-sans text-muted-foreground group-open:hidden">
              Show full value
            </span>
            <span className="ml-2 hidden font-sans text-muted-foreground group-open:inline">
              Hide full value
            </span>
          </summary>
          <code className="mt-1 block font-mono text-xs break-all select-all">
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
        <code className="font-mono text-xs break-all">{source.revision}</code>
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
      value: <span className="whitespace-pre-line">{source.notes}</span>,
    })
  }
  rows.push(
    {
      term: "Created",
      value: `${formatDateTime(version.createdAt)}${who(version.createdByName)}`,
    },
    {
      term: "Last saved",
      value: `${formatDateTime(version.updatedAt)} (revision ${version.revision})`,
    }
  )
  if (version.reviewedAt) {
    rows.push({ term: "Reviewed", value: formatDateTime(version.reviewedAt) })
  }
  if (version.activatedAt) {
    rows.push({
      term: "Activated",
      value: `${formatDateTime(version.activatedAt)}${who(version.activatedByName)}`,
    })
  }
  if (version.retiredAt) {
    rows.push({ term: "Retired", value: formatDateTime(version.retiredAt) })
  }

  return (
    <section
      aria-label="Provenance"
      className={cn("rounded-lg border bg-card p-4", className)}
    >
      <h2 className="text-sm font-medium">Provenance</h2>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
        {rows.map((row) => (
          <div key={row.term} className="contents">
            <dt className="text-muted-foreground">{row.term}</dt>
            <dd className="mb-1 min-w-0 sm:mb-0">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
