import type { Metadata } from "next"
import Link from "next/link"

import {
  declareSourceAction,
  retireSourceAction,
  reviewMappingAction,
} from "@/app/_knowledge/actions"
import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import { CoverageSection } from "@/components/nabalens/coverage"
import { longDate } from "@/components/nabalens/knowledge/copy"
import {
  DeclareSourceForm,
  MappingReviewControl,
  RetireSourceControl,
} from "@/components/nabalens/knowledge/reconcile-controls"
import {
  MAPPING_KIND_LABEL,
  RECONCILE_COPY as COPY,
  SOURCE_KIND_LABEL,
} from "@/components/nabalens/knowledge/reconcile-copy"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveAdmin } from "@/lib/auth"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { getCoverageActor } from "@/lib/server/coverage"

import { adminVenues } from "../admin-venues"

export const metadata: Metadata = {
  title: "Sources and mappings · Knowledge · Naba-Lens",
}

const PATH = "/admin/knowledge/sources"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MUTED = "text-meta-touch text-ink-muted md:text-meta"
const CARD = "grid min-w-0 gap-2 rounded-card bg-surface p-4 shadow-card"

/**
 * Admin (B03 UI design §7.3): declared sources, and the old facts with the
 * latest review of each question they may map to. Every change is keyed and
 * recorded; reviews are append-only and nothing defaults to Exact.
 */
export default async function SourcesPage({
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
  const [sources, mappings, registry, venues] = await Promise.all([
    knowledgeServices
      .listSources(actor, { includeRetired: true })
      .catch(() => null),
    knowledgeServices.listLegacyMappings(actor, { cursor }).catch(() => null),
    knowledgeServices.listQuestionRegistry(actor, {}).catch(() => null),
    adminVenues(actor),
  ])
  const venueName = new Map(venues.map((v) => [v.id, v.name]))
  const questions = registry?.ok
    ? registry.questions.map((q) => ({
        key: q.key,
        label: q.guidance.question,
      }))
    : []

  return (
    <AppShell variant="admin" active="coverage" userName={profile.displayName}>
      <div className="mx-auto grid w-full max-w-(--size-reading) min-w-0 gap-(--gutter)">
        <PageHeader title={COPY.sourcesTitle} />

        <CoverageSection id="sources" title={COPY.sources}>
          {!sources?.ok ? (
            <Notice tone="negative">{COPY.failed}</Notice>
          ) : sources.sources.length === 0 ? (
            <p className="text-body-touch text-ink md:text-body">
              {COPY.noSources}
            </p>
          ) : (
            <ul className="grid gap-3">
              {sources.sources.map((s) => (
                <li key={s.sourceId} className={CARD}>
                  <p className="text-item-title [overflow-wrap:anywhere] text-ink">
                    {s.label}
                  </p>
                  <p className={MUTED}>
                    {SOURCE_KIND_LABEL[s.kind]} ·{" "}
                    {s.venueId
                      ? (venueName.get(s.venueId) ?? COPY.aVenue)
                      : COPY.allVenues}
                  </p>
                  <p className={MUTED}>
                    {COPY.declared(longDate(s.declaredAt), s.declaredBy)}
                  </p>
                  {s.retiredAt ? (
                    <p className={MUTED}>
                      {COPY.retired(longDate(s.retiredAt))}
                    </p>
                  ) : (
                    <div>
                      <RetireSourceControl
                        sourceId={s.sourceId}
                        label={s.label}
                        onRetire={retireSourceAction}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <DeclareSourceForm venues={venues} onDeclare={declareSourceAction} />
        </CoverageSection>

        <CoverageSection id="mappings" title={COPY.mappings}>
          <p className="text-body-touch text-ink md:text-body">
            {COPY.mappingsLine}
          </p>
          {!mappings?.ok ? (
            <Notice tone="negative">{COPY.failed}</Notice>
          ) : mappings.page.items.length === 0 ? (
            <p className="text-body-touch text-ink md:text-body">
              {COPY.noMappings}
            </p>
          ) : (
            <ul className="grid gap-3">
              {mappings.page.items.map((item) => (
                <li
                  key={`${item.legacyFactId}-${item.legacyRevision}`}
                  className={CARD}
                >
                  <p className="text-item-title [overflow-wrap:anywhere] text-ink">
                    {item.legacyKey}: {COPY.presence[item.presence]}
                  </p>
                  <p className={MUTED}>
                    {venueName.get(item.venueId) ?? COPY.aVenue}
                  </p>
                  {item.mappings.length ? (
                    <ul className="grid gap-1 text-body-touch text-ink md:text-body">
                      {item.mappings.map((m) => (
                        <li key={m.questionKey}>
                          {m.questionKey}:{" "}
                          {COPY.latest(
                            MAPPING_KIND_LABEL[m.kind],
                            m.reason,
                            m.reviewedBy,
                            longDate(m.reviewedAt)
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div>
                    <MappingReviewControl
                      legacyFactId={item.legacyFactId}
                      legacyRevision={item.legacyRevision}
                      legacyKey={item.legacyKey}
                      questions={questions}
                      onReview={reviewMappingAction}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {mappings?.ok && mappings.page.nextCursor ? (
            <div>
              <Link
                href={`${PATH}?cursor=${encodeURIComponent(mappings.page.nextCursor)}`}
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
