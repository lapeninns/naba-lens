import Link from "next/link"
import { SignOutIcon } from "@phosphor-icons/react/dist/ssr"

import { Button } from "@/components/ui/button"

import { LayoutOfflineShell } from "../offline-notice"
import { ProfileAvatar } from "../profile-avatar"
import { MANAGER_COPY } from "./copy"
import { managerHrefs } from "./hrefs"
import { ManagerAddButton, ManagerNav } from "./manager-nav"
import { ReviewCountProvider } from "./review-count"

const FOCUS = "outline-none focus-ring"

/**
 * Page frame of the venue manager workspace: the wordmark, the venue's name,
 * Overview · Review · Album · Requests · Venue at every width (v2's SideNav
 * from bp-desktop, a row under the header from md, a bottom tab bar on
 * phones), Account and Log out. Add shows
 * only inside the workspace's Add host, once R8 says this account can upload
 * (B02-c); there is no Photos, People or Me.
 * The Review badge count lives in a ReviewCountProvider, so Review can move
 * it as decisions land.
 */
export function ManagerShell({
  venueName,
  userName,
  reviewCount,
  confirmCount,
  loadedAt,
  children,
}: {
  venueName: string
  userName: string
  /** Photos waiting for a decision; omitted when it could not be read. */
  reviewCount?: number
  /** Amenity findings waiting for a decision; omitted when it could not be read. */
  confirmCount?: number
  /**
   * The layout's render time (ISO), for the offline banner. A layout isn't
   * re-rendered on navigation, only on refresh, so pages under it pass their
   * own to their OfflineNotice.
   */
  loadedAt?: string
  children: React.ReactNode
}) {
  return (
    <ReviewCountProvider count={reviewCount}>
      <div className="flex min-h-svh flex-col bg-canvas text-ink desktop:pl-rail">
        <a
          href="#main"
          className="sr-only z-overlay rounded-control bg-accent px-4 py-3 text-button text-on-accent focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        <ManagerNav
          kind="rail"
          reviewCount={reviewCount}
          confirmCount={confirmCount}
        />
        {/* v2 VenueBar: surface, a line under it, the venue named in full.
            From bp-desktop the name Naba-Lens moves to the SideNav. */}
        <header className="relative z-local bg-surface shadow-[0_1px_0_var(--line)]">
          <div className="mx-auto flex min-h-15 w-full max-w-page items-center gap-3 px-3 md:gap-4 md:px-6">
            <Link
              href={managerHrefs.overview}
              className={`inline-flex flex-none items-baseline rounded-control type-title whitespace-nowrap text-ink max-md:py-2.5 desktop:hidden ${FOCUS}`}
            >
              Naba-Lens
            </Link>
            {/* Two lines, then the full name on hover; each page's header
                names the venue in full too. */}
            <p
              data-slot="venue-name"
              title={venueName}
              // Below 352px the header holds Add beside the account; every
              // page header names the venue there instead (S2-MGR).
              className="line-clamp-2 min-w-0 border-l border-edge-strong pl-3 text-heading [overflow-wrap:anywhere] text-ink max-[22rem]:sr-only desktop:border-l-0 desktop:pl-0"
            >
              {venueName}
            </p>
            <div className="ml-auto flex flex-none items-center gap-2">
              <ManagerAddButton />
              <span className="hidden max-w-48 truncate text-meta text-ink-muted lg:inline">
                {userName}
              </span>
              <Link
                href={managerHrefs.account}
                className={`-mr-1 grid size-12 place-items-center rounded-round ${FOCUS}`}
              >
                {/* The avatar is aria-hidden, so this text is the whole name. */}
                <span className="sr-only">
                  {MANAGER_COPY.account}: {userName}
                </span>
                <ProfileAvatar name={userName} size="sm" />
              </Link>
              <form
                action="/auth/logout"
                method="post"
                data-logout
                className="hidden md:block"
              >
                <Button
                  type="submit"
                  variant="quiet"
                  className="lg:whitespace-nowrap"
                >
                  <SignOutIcon data-icon="inline-start" aria-hidden />
                  {MANAGER_COPY.logOut}
                </Button>
              </form>
            </div>
          </div>
          <div className="mx-auto hidden w-full max-w-page px-2 md:block md:px-4 desktop:hidden">
            <ManagerNav
              kind="tabs"
              reviewCount={reviewCount}
              confirmCount={confirmCount}
            />
          </div>
        </header>
        <main
          id="main"
          className="mx-auto w-full max-w-page flex-1 overflow-x-clip px-page-gutter pt-4 pb-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px)+2rem)] md:px-6 md:py-8"
        >
          <LayoutOfflineShell loadedAt={loadedAt}>
            {children}
          </LayoutOfflineShell>
        </main>
        <ManagerNav
          kind="bar"
          reviewCount={reviewCount}
          confirmCount={confirmCount}
        />
      </div>
    </ReviewCountProvider>
  )
}
