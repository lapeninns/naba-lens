import Link from "next/link"

import { AppShell } from "@/components/nabalens/app-shell"
import { Card } from "@/components/nabalens/common-room"
import { ManageNav, type ManageSection } from "@/components/nabalens/coverage"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import type { CoverageFailure } from "@/lib/server/coverage/types"
import { periodKeyOf, periodView } from "@/lib/server/coverage/time"

import {
  AdminVenueHeader,
  type AdminVenueView,
} from "@/app/admin/_components/admin-venue-header"

import { currentStaffShell } from "../../_shell/shell-status"
import { triageConfirmCount } from "@/components/nabalens/manager/overview/triage-card"

import {
  readVenueCoverage,
  readVenueTriage,
  unexpected,
  type ManageContext,
} from "./context"

/** "November 2026" in UK time, for the scope line. */
export function currentMonthLabel(): string {
  return periodView(periodKeyOf(new Date())).label
}

/**
 * Where each coverage section sits among one venue's admin tabs (redesign
 * R5, ia.md "Venues › one venue"). Pages that differ pass `adminView`.
 */
const ADMIN_VIEW: Record<ManageSection, AdminVenueView> = {
  overview: { tab: "coverage", pick: "month" },
  menu: { tab: "coverage", pick: "menu" },
  review: { tab: "review", pick: "checklist" },
  menu_items: { tab: "album", pick: "menu" },
  amenities: { tab: "album", pick: "amenities" },
  checklist: { tab: "checklist" },
  team: { tab: "team" },
  search: { tab: "coverage" },
}

/**
 * Page frame for one venue's coverage tools (manager or admin): the shell,
 * the page header scoped to the venue and month, and the five section tabs.
 * Detail pages keep the tabs with their parent section current.
 */
export async function ManageFrame({
  ctx,
  section,
  title,
  summary,
  actions,
  month,
  venueScope,
  pendingReview,
  adminView,
  back,
  children,
}: {
  ctx: ManageContext
  section: ManageSection
  title: string
  summary?: React.ReactNode
  actions?: React.ReactNode
  /** Scope month when the page shows another month than this one. */
  month?: string
  /** Replaces the venue name in the scope line (the admin venue switcher). */
  venueScope?: React.ReactNode
  /** Review count when the page already has it; read otherwise. */
  pendingReview?: number
  /** Admin only: the venue tab and pick, when not the section's own. */
  adminView?: AdminVenueView
  /**
   * Admin only: a detail page's parent (its href and title). Tab roots go
   * back to Venues and take the tab's name as their title.
   */
  back?: { href: string; label: string }
  children: React.ReactNode
}) {
  const [shell, read, triage] = await Promise.all([
    ctx.mode === "manager" ? currentStaffShell() : null,
    pendingReview === undefined ? readVenueCoverage(ctx) : null,
    // Only the manager tabs count findings on Amenities.
    ctx.mode === "manager" ? readVenueTriage(ctx) : null,
  ])
  let reviewCount = pendingReview
  if (read) {
    if (!read.ok) return <RefusedPage ctx={ctx} failure={read} />
    reviewCount = read.coverage.summary.pendingReview
  }
  if (ctx.mode === "admin") {
    // One venue lights Venues and has its own tabs (redesign R5, ia.md).
    return (
      <AppShell variant="admin" active="venues" userName={ctx.viewerName}>
        <div className="grid min-w-0 gap-gutter md:gap-4">
          <AdminVenueHeader
            venueId={ctx.venueId}
            venueName={ctx.venue.name}
            month={month ?? currentMonthLabel()}
            view={adminView ?? ADMIN_VIEW[section]}
            title={title}
            summary={summary}
            actions={actions}
            back={back}
            pendingReview={reviewCount}
          />
          {children}
        </div>
      </AppShell>
    )
  }
  const body = (
    <div className="grid min-w-0 gap-gutter md:gap-4">
      <div className="grid min-w-0 gap-1">
        <PageHeader
          venueScope={!venueScope}
          scope={[venueScope ?? ctx.venue.name, month ?? currentMonthLabel()]}
          title={title}
          summary={summary}
          actions={actions}
        />
        <ManageNav
          basePath={ctx.basePath}
          active={section}
          pendingReview={reviewCount}
          confirmCount={triage ? triageConfirmCount(triage) : null}
          label={`Manage ${ctx.venue.name}`}
        />
      </div>
      {children}
    </div>
  )

  return (
    // This page has just proved the grant and read the venue's count, so they
    // win over the shared status (same source, possibly a later read).
    <AppShell
      variant="staff"
      active="manage"
      {...shell}
      canManage
      reviewCount={reviewCount}
      userName={ctx.viewerName}
    >
      {body}
    </AppShell>
  )
}

/**
 * Staff without an effective manager grant: never granted, revoked, moved
 * venue or deactivated. The services don't tell staff why a grant ended, so
 * one version covers every case. New grants go to venue manager accounts
 * only, so the way in is an account change, never a grant to this account.
 * It names no tabs: it says what the account can open and links there
 * (redesign R4, ia.md).
 */
export async function NotManagerPage({ viewerName }: { viewerName: string }) {
  const shell = await currentStaffShell()
  return (
    <AppShell variant="staff" active="manage" {...shell} userName={viewerName}>
      <PageHeader scope={currentMonthLabel()} title="Manage isn't available" />
      <Card className="max-w-reading text-body">
        <p>
          Manage is for venue managers. To manage your venue, ask an admin to
          change your account to a venue manager account.
        </p>
        <p className="text-ink-muted">
          Your account can still add photos and see what your venue&apos;s album
          needs.
        </p>
        <div>
          <Link
            href="/staff/home"
            className={buttonVariants({ variant: "primary" })}
          >
            Go to Today
          </Link>
        </div>
      </Card>
    </AppShell>
  )
}

/** Shown when a read is refused mid-session (grant revoked, moved venue). */
export function RefusedPage({
  ctx,
  failure,
}: {
  ctx: ManageContext
  failure: CoverageFailure
}) {
  if (ctx.mode === "manager")
    return <NotManagerPage viewerName={ctx.viewerName} />
  unexpected(failure)
}

export function isRefusal(failure: CoverageFailure): boolean {
  return failure.code === "not_permitted" || failure.code === "wrong_venue"
}
