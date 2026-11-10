import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { reconcileAction } from "@/app/_knowledge/actions"
import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import { CoverageSection } from "@/components/nabalens/coverage"
import { dateAndTime } from "@/components/nabalens/knowledge/copy"
import { ApplyRunControl } from "@/components/nabalens/knowledge/reconcile-controls"
import {
  DRY_RUN_FRESH_MS,
  RECONCILE_COPY as COPY,
} from "@/components/nabalens/knowledge/reconcile-copy"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveAdmin } from "@/lib/auth"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { getCoverageActor } from "@/lib/server/coverage"

import { adminVenues } from "../../admin-venues"

export const metadata: Metadata = { title: "Run · Knowledge · Naba-Lens" }

const RUNS = "/admin/knowledge/runs"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MUTED = "text-meta-touch text-ink-muted md:text-meta"

/** A dry run may be applied while it is under a day old (§7.4). */
function freshDryRun(run: { mode: string; startedAt: string }) {
  return (
    run.mode === "dry_run" &&
    Date.now() - Date.parse(run.startedAt) < DRY_RUN_FRESH_MS
  )
}

/**
 * One run (B03 UI design §7.4): what it found, and for a dry run under a day
 * old, Import for managers to decide. Nothing becomes an answer by itself.
 */
export default async function RunPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const profile = await requireActiveAdmin()
  const { runId } = await params
  if (!UUID.test(runId)) notFound()
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const actor = auth.actor
  const [read, venues] = await Promise.all([
    knowledgeServices.getReconciliationRun(actor, { runId }).catch(() => null),
    adminVenues(actor),
  ])
  if (read && !read.ok && read.code === "not_found") notFound()
  const venueName = new Map(venues.map((v) => [v.id, v.name]))
  const name = (id: string | null) =>
    id ? (venueName.get(id) ?? COPY.aVenue) : COPY.allOfThem
  const run = read?.ok ? read.run : null
  const fresh = run !== null && freshDryRun(run)

  return (
    <AppShell variant="admin" active="coverage" userName={profile.displayName}>
      <div className="mx-auto grid w-full max-w-(--size-reading) min-w-0 gap-(--gutter)">
        <div>
          <Link
            href={RUNS}
            className={buttonVariants({ variant: "row-link", size: "sm" })}
          >
            {COPY.runs}
          </Link>
        </div>
        {!run ? (
          <>
            <PageHeader title={COPY.runsTitle} />
            <Notice
              tone="negative"
              action={
                <Link
                  href={`${RUNS}/${runId}`}
                  className={buttonVariants({
                    variant: "secondary",
                    size: "touch",
                  })}
                >
                  {COPY.tryAgain}
                </Link>
              }
            >
              {COPY.failed}
            </Notice>
          </>
        ) : (
          <>
            <PageHeader
              title={`${COPY.runKind[run.kind]} · ${COPY.runMode[run.mode]} · ${name(run.venueId)}`}
            />
            <p className={MUTED}>{dateAndTime(run.startedAt)}</p>
            <p className="text-body-touch text-ink md:text-body">
              {COPY.summary(run.counts)}
            </p>
            {run.mode === "dry_run" ? (
              fresh ? (
                <ApplyRunControl
                  count={run.counts.proposals}
                  kind={run.kind}
                  venueId={run.venueId}
                  onReconcile={reconcileAction}
                  runsHref={RUNS}
                />
              ) : (
                <p className="text-body-touch text-ink md:text-body">
                  {COPY.applyStale}
                </p>
              )
            ) : null}
            <CoverageSection id="would-create" title={COPY.wouldCreate}>
              {run.wouldCreate.length ? (
                <ul className="grid gap-1 text-body-touch text-ink md:text-body">
                  {run.wouldCreate.map((p, i) => (
                    <li key={i}>{COPY.proposal(p, name(p.venueId))}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-body-touch text-ink md:text-body">
                  {COPY.noneListed}
                </p>
              )}
            </CoverageSection>
            <CoverageSection id="conflicts" title={COPY.conflicts}>
              {run.conflicts.length ? (
                <ul className="grid gap-1 text-body-touch text-ink md:text-body">
                  {run.conflicts.map((p, i) => (
                    <li key={i}>{COPY.proposal(p, name(p.venueId))}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-body-touch text-ink md:text-body">
                  {COPY.noneListed}
                </p>
              )}
            </CoverageSection>
            <CoverageSection id="revisions" title={COPY.revisions}>
              {Object.keys(run.sourceRevisions).length ? (
                <ul className="grid gap-1 text-body-touch text-ink md:text-body">
                  {Object.entries(run.sourceRevisions).map(
                    ([source, revision]) => (
                      <li key={source}>
                        {source}: {String(revision)}
                      </li>
                    )
                  )}
                </ul>
              ) : (
                <p className="text-body-touch text-ink md:text-body">
                  {COPY.noneListed}
                </p>
              )}
            </CoverageSection>
          </>
        )}
      </div>
    </AppShell>
  )
}
