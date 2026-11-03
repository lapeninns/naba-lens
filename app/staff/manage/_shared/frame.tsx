import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { logout } from "@/app/_media/actions"
import { AppShell } from "@/components/nabalens/app-shell"
import { ManageNav, type ManageSection } from "@/components/nabalens/coverage"
import { buttonVariants } from "@/components/ui/button"
import type { CoverageFailure } from "@/lib/server/coverage/types"

import { unexpected, type ManageContext } from "./context"

/** Page frame for one venue's coverage tools (manager or admin). */
export function ManageFrame({
  ctx,
  section,
  title,
  description,
  pendingReview,
  back,
  children,
}: {
  ctx: ManageContext
  section: ManageSection
  title: string
  description?: React.ReactNode
  pendingReview?: number
  /** Replaces the section navigation with a link back (detail pages). */
  back?: { href: string; label: string }
  children: React.ReactNode
}) {
  const body = (
    <div className="grid gap-6">
      <div className="grid gap-3">
        {ctx.mode === "admin" && !back ? (
          <Link
            href="/admin/coverage"
            className={buttonVariants({
              variant: "ghost",
              className: "h-11 w-fit sm:h-9",
            })}
          >
            <ArrowLeftIcon data-icon="inline-start" aria-hidden />
            All venues
          </Link>
        ) : null}
        {back ? (
          <Link
            href={back.href}
            className={buttonVariants({
              variant: "ghost",
              className: "h-11 w-fit sm:h-9",
            })}
          >
            <ArrowLeftIcon data-icon="inline-start" aria-hidden />
            {back.label}
          </Link>
        ) : null}
        <div className="grid gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            {ctx.venue.name}
            {ctx.mode === "admin" ? " · admin view" : " · venue manager"}
          </p>
          <h1 className="font-display text-page-title-compact break-words md:text-page-title">
            {title}
          </h1>
          {description ? (
            <p className="max-w-prose text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {back ? null : (
          <ManageNav
            basePath={ctx.basePath}
            active={section}
            pendingReview={pendingReview}
            label={
              ctx.mode === "admin"
                ? `Coverage for ${ctx.venue.name}`
                : `Manage ${ctx.venue.name}`
            }
          />
        )}
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
      userName={ctx.viewerName}
      logoutAction={logout}
    >
      {body}
    </AppShell>
  )
}

/** Staff without an effective manager grant (never granted, revoked or moved venue). */
export function NotManagerPage({ viewerName }: { viewerName: string }) {
  return (
    <AppShell
      variant="staff"
      active="manage"
      userName={viewerName}
      logoutAction={logout}
    >
      <div className="grid max-w-prose gap-3">
        <h1 className="font-display text-page-title-compact md:text-page-title">
          Venue manager tools
        </h1>
        <p className="text-sm text-muted-foreground">
          These tools are for venue managers. An admin can make you the manager
          of the venue you work at. Manager access ends when you move to another
          venue or your account changes, and needs a new grant.
        </p>
        <Link
          href="/staff/tasks"
          className={buttonVariants({
            variant: "outline",
            size: "touch",
            className: "w-fit",
          })}
        >
          Go to My tasks
        </Link>
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
