import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { EmptyState } from "@/components/nabalens/empty-state"
import { StatusChip } from "@/components/nabalens/status-chip"
import { packageHref, type ExportArea } from "@/lib/server/exports/hrefs"
import type { ExportPackageSummary } from "@/lib/server/exports/model"

import { EXPORTS_COPY, londonDate, PACKAGE_CHIP, packageTitle } from "./copy"

/*
 * Export packages, newest first. A package that needs rebuilding (a photo in
 * it was withdrawn since it was made) says so before anyone downloads it
 * (AC32). Each row is one link to the package.
 */
export function PackageList({
  area,
  packages,
  emptyAction,
}: {
  area: ExportArea
  packages: ExportPackageSummary[]
  emptyAction?: React.ReactNode
}) {
  if (packages.length === 0) {
    return (
      <EmptyState
        inline
        title={EXPORTS_COPY.noPackages}
        description={EXPORTS_COPY.noPackagesText}
        action={emptyAction}
      />
    )
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
      {packages.map((p) => (
        <li key={p.id}>
          <Link
            href={packageHref(area, p.id)}
            className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 focus-ring hover:bg-surface-2"
          >
            <span className="grid min-w-0 gap-1">
              <span className="text-label break-words text-ink">
                {packageTitle(p)}
              </span>
              {p.note ? (
                <span className="text-body break-words text-ink">{p.note}</span>
              ) : null}
              <span className="text-meta text-ink-muted">
                {EXPORTS_COPY.items(p.itemCount)} ·{" "}
                {EXPORTS_COPY.madeBy(p.createdBy, londonDate(p.createdAt))}
                {p.lastExportedAt
                  ? ` · ${EXPORTS_COPY.exportedOn(londonDate(p.lastExportedAt))}`
                  : ""}
              </span>
              <span className="flex flex-wrap gap-1.5">
                <StatusChip state={PACKAGE_CHIP[p.state]} />
                {p.mode === "internal" ? (
                  <StatusChip state="internal_only" />
                ) : null}
              </span>
            </span>
            <CaretRightIcon aria-hidden className="size-5 text-ink-muted" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
