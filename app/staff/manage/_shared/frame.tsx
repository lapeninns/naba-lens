import Link from "next/link"

import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { ManageNav, type ManageSection } from "@/components/nabalens/coverage"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import type { CoverageFailure } from "@/lib/server/coverage/types"
import { periodKeyOf, periodView } from "@/lib/server/coverage/time"

import { readVenueCoverage, unexpected, type ManageContext } from "./context"

/** "November 2026" in UK time, for the scope line. */
export function currentMonthLabel(): string {
  return periodView(periodKeyOf(new Date())).label
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
  children: React.ReactNode
}) {
  let reviewCount = pendingReview
  if (reviewCount === undefined) {
    const read = await readVenueCoverage(ctx)
    if (!read.ok) return <RefusedPage ctx={ctx} failure={read} />
    reviewCount = read.coverage.summary.pendingReview
  }
  const body = (
    <div className="grid gap-6 md:gap-8">
      <div>
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
          label={
            ctx.mode === "admin"
              ? `Coverage for ${ctx.venue.name}`
              : `Manage ${ctx.venue.name}`
          }
        />
      </div>
      {children}
    </div>
  )

  return ctx.mode === "admin" ? (
    <AppShell
      variant="admin"
      active="coverage"
      userName={ctx.viewerName}
      logoutAction={logout}
    >
      {body}
    </AppShell>
  ) : (
    <AppShell
      variant="staff"
      active="manage"
      canManage
      reviewCount={reviewCount}
      userName={ctx.viewerName}
      logoutAction={logout}
    >
      {body}
    </AppShell>
  )
}

/**
 * Staff without an effective manager grant: never granted, revoked, moved
 * venue or deactivated. The services don't tell staff why a grant ended, so
 * one version covers every case.
 */
export function NotManagerPage({ viewerName }: { viewerName: string }) {
  return (
    <AppShell
      variant="staff"
      active="manage"
      userName={viewerName}
      logoutAction={logout}
    >
      <PageHeader scope={currentMonthLabel()} title="Manage isn't available" />
      <div className="grid max-w-(--size-reading) gap-3 text-body-touch md:text-body">
        <p>
          Manage is for venue managers. An admin can make you a venue manager
          for your venue.
        </p>
        <p className="text-ink-muted">
          You still have Home, Photos, Add, People and Me.
        </p>
        <div>
          <Link
            href="/staff/tasks"
            className={buttonVariants({ variant: "primary", size: "touch" })}
          >
            Go to Home
          </Link>
        </div>
      </div>
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
