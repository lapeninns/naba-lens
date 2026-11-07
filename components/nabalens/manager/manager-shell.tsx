import Link from "next/link"
import { SignOutIcon } from "@phosphor-icons/react/dist/ssr"

import { Button } from "@/components/ui/button"

import { OfflineShell } from "../offline-notice"
import { ProfileAvatar } from "../profile-avatar"
import { MANAGER_COPY } from "./copy"
import { managerHrefs } from "./hrefs"
import { ManagerNav } from "./manager-nav"
import { ReviewCountProvider } from "./review-count"

const FOCUS =
  "outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"

/**
 * Page frame of the venue manager workspace: the wordmark, the venue's name,
 * Overview · Review · Menu · Amenities at every width (a row under the
 * header from md, a bottom tab bar on phones), Account and Log out. It has no
 * Add, upload, Photos, People or Me: a manager account reviews and does not
 * contribute (amenity evidence goes through the check's Capture myself page).
 * The Review badge count lives in a ReviewCountProvider, so Review can move
 * it as decisions land.
 */
export function ManagerShell({
  venueName,
  userName,
  reviewCount,
  children,
}: {
  venueName: string
  userName: string
  /** Photos waiting for a decision; omitted when it could not be read. */
  reviewCount?: number
  children: React.ReactNode
}) {
  return (
    <ReviewCountProvider count={reviewCount}>
      <div className="flex min-h-svh flex-col bg-bg text-ink">
        <a
          href="#main"
          className="sr-only z-50 rounded-control bg-accent px-4 py-3 text-button text-on-accent focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        {/* Common Room top bar: white, a hairline under it. */}
        <header className="relative z-10 bg-surface shadow-[0_1px_0_var(--line)]">
          <div className="mx-auto flex min-h-15 w-full max-w-(--size-page) items-center gap-3 px-3 md:gap-4 md:px-6">
            <Link
              href={managerHrefs.overview}
              className={`inline-flex flex-none items-baseline rounded-control font-display text-[1.5rem] leading-none font-extrabold tracking-[-0.02em] whitespace-nowrap text-ink max-md:py-2.5 ${FOCUS}`}
            >
              Naba-Lens
            </Link>
            <p
              data-slot="venue-name"
              className="min-w-0 truncate border-l border-line-control pl-3 text-meta-strong text-ink-muted"
            >
              {venueName}
            </p>
            <div className="ml-auto flex flex-none items-center gap-2">
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
          <div className="mx-auto hidden w-full max-w-(--size-page) px-2 md:block md:px-4">
            <ManagerNav kind="tabs" reviewCount={reviewCount} />
          </div>
        </header>
        <main
          id="main"
          className="mx-auto w-full max-w-(--size-page) flex-1 overflow-x-clip px-(--page-gutter) pt-4 pb-[calc(var(--size-tabbar)+env(safe-area-inset-bottom,0px)+2rem)] md:px-6 md:py-8"
        >
          <OfflineShell>{children}</OfflineShell>
        </main>
        <ManagerNav kind="bar" reviewCount={reviewCount} />
      </div>
    </ReviewCountProvider>
  )
}
