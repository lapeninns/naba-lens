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
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveAdmin } from "@/lib/auth"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { getCoverageActor } from "@/lib/server/coverage"

import { adminVenues } from "../admin-venues"

export const metadata: Metadata = { title: "Runs · Knowledge · Naba-Lens" }

const PATH = "/admin/knowledge/runs"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MUTED = "text-meta-touch text-ink-muted md:text-meta"

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
    <AppShell variant="admin" active="coverage" userName={profile.displayName}>
      <div className="mx-auto grid w-full max-w-(--size-reading) min-w-0 gap-(--gutter)">
        <PageHeader title={COPY.runsTitle} />
        <StartDryRunForm
          venues={venues}
          onReconcile={reconcileAction}
          runBase={PATH}
        />
        <CoverageSection id="runs" title={COPY.runs}>
          {!runs?.ok ? (
            <Notice tone="negative">{COPY.failed}</Notice>
          ) : rows.length === 0 ? (
            <p className="text-body-touch text-ink md:text-body">
              {COPY.noRuns}
            </p>
          ) : (
            <ul className="grid gap-3">
              {rows.map((r) => (
                <li
                  key={r.runId}
                  className="grid gap-1 rounded-card bg-surface p-4 shadow-card"
                >
                  <Link
                    href={`${PATH}/${r.runId}`}
                    className="text-item-title text-ink underline-offset-2 hover:underline"
                  >
                    {COPY.runKind[r.kind]} · {COPY.runMode[r.mode]} ·{" "}
                    {r.venueId
                      ? (venueName.get(r.venueId) ?? COPY.aVenue)
                      : COPY.allOfThem}
                  </Link>
                  <p className={MUTED}>
                    {COPY.started(r.startedBy, dateAndTime(r.startedAt))}
                  </p>
                  <p className="text-body-touch text-ink md:text-body">
                    {COPY.summary(r.counts)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {runs?.ok && runs.page.nextCursor ? (
            <div>
              <Link
                href={`${PATH}?cursor=${encodeURIComponent(runs.page.nextCursor)}`}
                className={buttonVariants({
                  variant: "secondary",
                  size: "touch",
                })}
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
