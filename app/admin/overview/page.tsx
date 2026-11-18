import type { Metadata } from "next"

import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireActiveAdmin } from "@/lib/auth"
import { parseOverviewFilters, recentPeriods } from "@/lib/admin/overview"
import { loadGroupOverview } from "@/lib/server/admin/venues"
import { getCoverageActor } from "@/lib/server/coverage"
import { periodKeyOf } from "@/lib/server/coverage/time"
import { loadOpsStatus } from "@/lib/server/ops"

import { ExceptionsPanel } from "../settings/ops-panel"
import {
  OVERVIEW_COPY,
  OverviewFiltersForm,
  OverviewView,
} from "./overview-view"

export const metadata: Metadata = { title: OVERVIEW_COPY.title }

/**
 * Admin Overview (spec §8 A1): operational exceptions and venues needing
 * attention first, then every venue's numbers, each linked to its records.
 * Filters (venue, categories, menu version, reporting period) live in the
 * URL. Admins only: the layout's gate, requireActiveAdmin here, and the
 * database (admin_group_overview refuses anyone else). A failed monitoring
 * read shows a notice in its place, not a failed page.
 */
export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireActiveAdmin()
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const now = new Date()
  const current = periodKeyOf(now)
  const filters = parseOverviewFilters(await searchParams, current)
  const [read, status, venues] = await Promise.all([
    loadGroupOverview(auth.actor, filters),
    loadOpsStatus(auth.actor),
    auth.actor.db
      .from("venues")
      .select("id, name")
      .eq("active", true)
      .order("name"),
  ])
  if (!read.ok) throw new Error(read.message)

  return (
    <AppShell variant="admin" active="overview" userName={profile.displayName}>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <PageHeader
            scope={OVERVIEW_COPY.scope}
            title={OVERVIEW_COPY.title}
            summary={<p>{OVERVIEW_COPY.summary}</p>}
            className="pb-0 md:pb-0"
          />
          <OfflineNotice />
        </div>

        {status.ok ? (
          <ExceptionsPanel status={status.status} />
        ) : (
          <Notice
            tone="negative"
            role="alert"
            title="Monitoring couldn't be loaded"
          >
            {status.nextAction}
          </Notice>
        )}

        <OverviewFiltersForm
          filters={filters}
          venues={(venues.data ?? []) as { id: string; name: string }[]}
          periods={recentPeriods(current)}
        />

        <OverviewView rows={read.rows} filters={filters} now={now} />
      </div>
    </AppShell>
  )
}
