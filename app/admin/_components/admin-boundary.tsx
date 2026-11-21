"use client"

import { useParams, usePathname } from "next/navigation"
import { ArrowClockwiseIcon } from "@phosphor-icons/react"

import { AppShell, type AdminSection } from "@/components/nabalens/app-shell"
import { BackLink } from "@/components/nabalens/back-link"
import { ERROR_COPY, ErrorState } from "@/components/nabalens/error-state"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

import {
  ADMIN_VENUE_TAB_LABELS,
  AdminVenueTabs,
  type AdminVenueTab,
} from "./admin-tabs"

/** Error notices say Retry (redesign R5, ia.md decision 11). */
export const ADMIN_BOUNDARY_COPY = {
  retry: "Retry",
  requestId: (digest: string) => `Request ID ${digest}`,
} as const

type FrameProps = {
  /** The nav section the page lights (ia.md "Admin route map"). */
  section: AdminSection
  /** The page's own title, as the page shows it. */
  title: string
  /** A detail page's parent: its href and title. */
  back?: { href: string; label: string }
  /** The section's tabs, with this page's tab current. */
  tabs?: React.ReactNode
}

function Frame({
  section,
  title,
  back,
  tabs,
  children,
}: FrameProps & { children: React.ReactNode }) {
  return (
    <AppShell variant="admin" active={section}>
      <div className="flex flex-col gap-6">
        <div className="grid min-w-0 gap-1">
          {back ? (
            <BackLink href={back.href} compact>
              {back.label}
            </BackLink>
          ) : null}
          <PageHeader title={title} className="pb-0 md:pb-0">
            {tabs}
          </PageHeader>
        </div>
        {children}
      </div>
    </AppShell>
  )
}

/**
 * An admin segment's error boundary (redesign R5): the admin nav stays, the
 * page keeps its own title, tabs and back link, and the notice names what
 * failed and offers Retry. Never titled after another page.
 */
export function AdminErrorPage({
  error,
  retry,
  what,
  children,
  ...frame
}: FrameProps & {
  error?: Error & { digest?: string }
  retry: () => void
  /** What failed, as a notice title ("Albums couldn't be loaded"). */
  what?: string
  /** What to do, when more than "check your connection". */
  children?: React.ReactNode
}) {
  return (
    <Frame {...frame}>
      <OfflineNotice />
      <ErrorState
        title={what ?? ERROR_COPY.couldNotLoad(frame.title)}
        action={
          <Button type="button" variant="primary" onClick={() => retry()}>
            <ArrowClockwiseIcon aria-hidden />
            {ADMIN_BOUNDARY_COPY.retry}
          </Button>
        }
        detail={
          error?.digest
            ? ADMIN_BOUNDARY_COPY.requestId(error.digest)
            : undefined
        }
      >
        {children}
      </ErrorState>
    </Frame>
  )
}

/** An admin segment's loading state: the page's frame, then placeholders. */
export function AdminLoadingPage({
  label,
  rows = 4,
  ...frame
}: FrameProps & {
  /** Read by screen readers: "Loading imports…". */
  label: string
  rows?: number
}) {
  return (
    <Frame {...frame}>
      <SkeletonRegion
        label={label}
        className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card"
      >
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="grid min-h-16 gap-2 px-4 py-3.5">
            <Skeleton shape="line" style={{ width: `${60 - (i % 3) * 8}%` }} />
            <Skeleton shape="line" style={{ width: `${34 - (i % 2) * 6}%` }} />
          </div>
        ))}
      </SkeletonRegion>
    </Frame>
  )
}

/**
 * The tab of one venue a /admin/coverage/[venueId]/** path sits in, for the
 * boundaries, which get no page props (redesign R5, ia.md route map).
 */
export function adminVenueTabOf(pathname: string): AdminVenueTab {
  const rest = pathname.replace(/^\/admin\/coverage\/[^/]+/, "")
  if (rest.startsWith("/menu-photos") || rest.startsWith("/review"))
    return "review"
  if (rest.startsWith("/menu/items") || rest.startsWith("/amenities"))
    return "album"
  if (rest.startsWith("/checklist")) return "checklist"
  if (rest.startsWith("/team")) return "team"
  return "coverage"
}

function useVenueFrame(): FrameProps {
  const pathname = usePathname() ?? ""
  const params = useParams<{ venueId?: string }>()
  const venueId = params?.venueId ?? ""
  const tab = adminVenueTabOf(pathname)
  return {
    section: "venues",
    title: ADMIN_VENUE_TAB_LABELS[tab],
    back: { href: "/admin/venues", label: "Venues" },
    tabs: venueId ? (
      <AdminVenueTabs venueId={venueId} venueName="This venue" active={tab} />
    ) : undefined,
  }
}

/** One venue's error boundary: the page's tab title and the venue's tabs. */
export function AdminVenueErrorPage({
  error,
  retry,
}: {
  error?: Error & { digest?: string }
  retry: () => void
}) {
  const frame = useVenueFrame()
  return (
    <AdminErrorPage
      {...frame}
      what={`${frame.title} couldn't be loaded`}
      error={error}
      retry={retry}
    />
  )
}

/** One venue's loading state, under the page's tab title. */
export function AdminVenueLoadingPage({ label }: { label: string }) {
  return <AdminLoadingPage {...useVenueFrame()} label={label} />
}
