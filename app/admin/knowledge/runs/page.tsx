import type { Metadata } from "next"
import Link from "next/link"

import { reconcileAction } from "@/app/_knowledge/actions"
import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import { CoverageSection } from "@/components/nabalens/coverage"
import { dateAndTime } from "@/components/nabalens/knowledge/copy"
import { StartDryRunForm } from "@/components/nabalens/knowledge/reconcile-controls"
import { RECONCILE_COPY as COPY } from "@/components/nabalens/knowledge/reconcile-copy"
import { Notice } from "@/components/nabalens/notice"
import { VenueFactsHeader } from "@/app/admin/_components/admin-tabs"
import { buttonVariants } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireActiveAdmin } from "@/lib/auth"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { getCoverageActor } from "@/lib/server/coverage"

import { adminVenues } from "../admin-venues"

export const metadata: Metadata = { title: "Imports · Venue facts" }

const PATH = "/admin/knowledge/runs"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RunRow = {
  runId: string
  kind: "legacy" | "external"
  mode: "dry_run" | "apply"
  venueId: string | null
  startedAt: string
  startedBy: string
  counts: {
    proposals: number
    skipped: number
    conflicting: number
    corroborating: number
  }
}

/** A runs-list row as the screen reads it; null when it can't be read. */
function runRow(raw: Record<string, unknown>): RunRow | null {
  const counts = raw.counts as RunRow["counts"] | undefined
  if (
    typeof raw.runId !== "string" ||
    (raw.kind !== "legacy" && raw.kind !== "external") ||
    (raw.mode !== "dry_run" && raw.mode !== "apply") ||
    typeof raw.startedAt !== "string" ||
    !counts ||
    typeof counts.proposals !== "number"
  )
    return null
  return {
    runId: raw.runId,
    kind: raw.kind,
    mode: raw.mode,
    venueId: typeof raw.venueId === "string" ? raw.venueId : null,
    startedAt: raw.startedAt,
    startedBy: typeof raw.startedBy === "string" ? raw.startedBy : COPY.someone,
    counts,
  }
}

/** The runs table's columns (second handoff, Venue facts › Imports). */
const RUN_COLUMNS = {
  run: "Import",
  started: "Started",
  proposals: "Would be imported",
  skipped: "Skipped",
  conflicting: "Disagree",
  corroborating: "Agree",
}

/** Admin (B03 UI design §7.4): reconciliation runs, and a new dry run. */
export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>
}) {
  const profile = await requireActiveAdmin()
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const actor = auth.actor
  const raw = (await searchParams).cursor
  const cursor = typeof raw === "string" && UUID.test(raw) ? raw : null
  const [runs, venues] = await Promise.all([
    knowledgeServices
      .listReconciliationRuns(actor, { cursor })
      .catch(() => null),
    adminVenues(actor),
  ])
  const venueName = new Map(venues.map((v) => [v.id, v.name]))
  const rows = runs?.ok
    ? runs.page.items.map(runRow).filter((r): r is RunRow => r !== null)
    : []

  return (
    <AppShell variant="admin" active="settings" userName={profile.displayName}>
      <div className="grid w-full min-w-0 gap-gutter">
        <VenueFactsHeader active="imports" />
        <StartDryRunForm
          venues={venues}
          onReconcile={reconcileAction}
          runBase={PATH}
        />
        <CoverageSection id="runs" title={COPY.runs}>
          {!runs?.ok ? (
            <Notice tone="negative">{COPY.failed}</Notice>
          ) : rows.length === 0 ? (
            <p className="text-body text-ink">{COPY.noRuns}</p>
          ) : (
            // Second handoff: a DataTable with the four counts as columns.
            <Table stacked framed aria-label={COPY.runs}>
              <TableHeader>
                <TableRow>
                  <TableHead>{RUN_COLUMNS.run}</TableHead>
                  <TableHead>{RUN_COLUMNS.started}</TableHead>
                  <TableHead numeric>{RUN_COLUMNS.proposals}</TableHead>
                  <TableHead numeric>{RUN_COLUMNS.skipped}</TableHead>
                  <TableHead numeric>{RUN_COLUMNS.conflicting}</TableHead>
                  <TableHead numeric>{RUN_COLUMNS.corroborating}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.runId}>
                    <TableHead scope="row" className="h-auto whitespace-normal">
                      <span className="grid gap-0.5 py-1">
                        <Link
                          href={`${PATH}/${r.runId}`}
                          className="inline-flex min-h-11 items-center text-label text-ink underline decoration-1 underline-offset-4 focus-ring outline-none hover:decoration-2"
                        >
                          {COPY.runKind[r.kind]} · {COPY.runMode[r.mode]}
                        </Link>
                        <span className="text-meta font-normal text-ink-muted">
                          {r.venueId
                            ? (venueName.get(r.venueId) ?? COPY.aVenue)
                            : COPY.allOfThem}
                        </span>
                      </span>
                    </TableHead>
                    <TableCell
                      label={RUN_COLUMNS.started}
                      className="whitespace-normal text-ink-muted"
                    >
                      {r.startedBy}, {dateAndTime(r.startedAt)}
                    </TableCell>
                    <TableCell label={RUN_COLUMNS.proposals} numeric>
                      {r.counts.proposals}
                    </TableCell>
                    <TableCell label={RUN_COLUMNS.skipped} numeric>
                      {r.counts.skipped}
                    </TableCell>
                    <TableCell label={RUN_COLUMNS.conflicting} numeric>
                      {r.counts.conflicting}
                    </TableCell>
                    <TableCell label={RUN_COLUMNS.corroborating} numeric>
                      {r.counts.corroborating}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {runs?.ok && runs.page.nextCursor ? (
            <div>
              <Link
                href={`${PATH}?cursor=${encodeURIComponent(runs.page.nextCursor)}`}
                className={buttonVariants({ variant: "secondary" })}
              >
                {COPY.showOlder}
              </Link>
            </div>
          ) : null}
        </CoverageSection>
      </div>
    </AppShell>
  )
}
