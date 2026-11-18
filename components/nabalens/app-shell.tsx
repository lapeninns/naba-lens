import Link from "next/link"
import {
  ClipboardTextIcon,
  ForkKnifeIcon,
  GearSixIcon,
  ImagesIcon,
  ImagesSquareIcon,
  SignOutIcon,
  SquaresFourIcon,
  UserCircleIcon,
  UsersIcon,
} from "@phosphor-icons/react/dist/ssr"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { OfflineShell } from "./offline-notice"
import { AlbumAddTrigger } from "./album/album-add-trigger"
import { TabBadge } from "./shell/tab-badge"
import { TAB_ITEM } from "./shell/tab-item"
import { CountBadge } from "./status-chip"

type AdminSection =
  "content" | "staff" | "menus" | "coverage" | "albums" | "settings"
type StaffSection =
  "tasks" | "menu" | "portfolio" | "community" | "people" | "manage"

type AppShellProps = {
  children: React.ReactNode
  /** Signed-in person, shown next to Log out from md up. */
  userName?: string
  /** Previews only: Log out calls this instead of posting /auth/logout. */
  onLogout?: () => void
  className?: string
} & (
  | {
      variant: "staff"
      active?: StaffSection
      /**
       * Shows *Manage* for an effective venue manager. Display only: every
       * manager page, action and RPC re-checks the grant.
       */
      canManage?: boolean
      /** Kept for callers that pass the shell status; Me is a tab, so unused. */
      avatarUrl?: string | null
      /**
       * The retakes Album shows (DESIGN.md §5a), counted on the Album tab
       * while another section is open.
       */
      todoCount?: number
      /** The retakes couldn't be read: the Album tab shows "?", not nothing. */
      todoUnknown?: boolean
      /** Photos waiting for this manager's decision, counted on Manage. */
      reviewCount?: number
    }
  | {
      variant: "admin"
      active: AdminSection
      /** Defaults: /admin, /admin/staff, /admin/menus, /admin/coverage, /admin/albums and /admin/settings. */
      hrefs?: Partial<Record<AdminSection, string>>
    }
)

type Icon = typeof ImagesIcon

type NavItem<Id extends string> = {
  id: Id
  label: string
  href: string
  icon: Icon
}

const ADMIN_NAV: NavItem<AdminSection>[] = [
  { id: "content", label: "Content", href: "/admin", icon: ImagesIcon },
  { id: "staff", label: "Staff", href: "/admin/staff", icon: UsersIcon },
  { id: "menus", label: "Menus", href: "/admin/menus", icon: ForkKnifeIcon },
  {
    id: "coverage",
    label: "Coverage",
    href: "/admin/coverage",
    icon: ClipboardTextIcon,
  },
  // Album A4 (DESIGN.md §6.6): every venue's album and its biggest gaps.
  {
    id: "albums",
    label: "Albums",
    href: "/admin/albums",
    icon: SquaresFourIcon,
  },
  // Spec §8 A7, Settings and activity: one section, two pages.
  {
    id: "settings",
    label: "Settings",
    href: "/admin/settings",
    icon: GearSixIcon,
  },
]

const ME: NavItem<StaffSection> = {
  id: "portfolio",
  label: "Me",
  href: "/staff",
  icon: UserCircleIcon,
}
/** Album is the staff Home (DESIGN.md §5a). */
const ALBUM: NavItem<StaffSection> = {
  id: "tasks",
  label: "Album",
  href: "/staff/tasks",
  icon: ImagesSquareIcon,
}
const MANAGE: NavItem<StaffSection> = {
  id: "manage",
  label: "Manage",
  href: "/staff/manage",
  icon: ClipboardTextIcon,
}

// AppBar section link (md up). Like the phone tabs: muted Figtree, the
// current one in accent-text with a 3px bar under it. No other blue.
const BAR_LINK =
  "inline-flex items-center gap-2 px-3 md:max-lg:px-2 type-tab-label text-ink-muted whitespace-nowrap shadow-[inset_0_-3px_0_transparent] transition-colors duration-quick outline-none hover:bg-surface-2 hover:text-ink focus-ring-inset"

/**
 * Page frame for signed-in pages. From md: the AppBar with the role's
 * sections, Add photos (staff) and Log out. Below md: a slim bar with the
 * wordmark, and the TabBar pinned to the bottom (staff: Album, Add photos and
 * Me, DESIGN.md §5 Tab bar; Me holds Log out).
 */
export function AppShell(props: AppShellProps) {
  const { children, userName, onLogout, className } = props
  const staff = props.variant === "staff" ? props : null
  const admin = props.variant === "admin" ? props : null
  // The Album tab counts the retakes Album shows (DESIGN.md §5a), never
  // the empty slots, and only while another section is open.
  const retakes = (id: string) =>
    staff && id === "tasks" && active !== "tasks"
      ? { count: staff.todoCount, unknown: !!staff.todoUnknown }
      : null
  const barItems: { item: NavItem<string>; href: string; count?: number }[] =
    admin
      ? ADMIN_NAV.map((item) => ({
          item,
          href: admin.hrefs?.[item.id] ?? item.href,
        }))
      : [
          // Album's places (DESIGN.md §5 Tab bar), and Manage. Our menu,
          // Photos and People are reached from Me.
          ALBUM,
          ME,
          ...(staff?.canManage ? [MANAGE] : []),
        ].map((item) => ({
          item,
          href: item.href,
          count: item.id === "manage" ? staff?.reviewCount : undefined,
        }))
  const active = admin ? admin.active : (staff?.active ?? "portfolio")
  const navLabel = admin ? "Admin" : "Staff"
  // Pages render this shell themselves, so each navigation and refresh
  // renders it again: the server's time now is when this content was read.
  // Rendered in the browser (an error boundary), it has no such time.
  const loadedAt =
    typeof window === "undefined" ? new Date().toISOString() : undefined

  const logoutButton = (
    <Button
      variant="quiet"
      className="max-md:min-h-11 lg:whitespace-nowrap"
      type={onLogout ? "button" : "submit"}
      onClick={onLogout}
    >
      <SignOutIcon data-icon="inline-start" aria-hidden />
      {/* Icon only from md to lg, so a manager's five sections still fit at 768px. */}
      <span className={cn(staff && "md:max-lg:sr-only")}>Log out</span>
    </Button>
  )

  return (
    <div
      className={cn("flex min-h-svh flex-col bg-canvas text-ink", className)}
    >
      <a
        href="#main"
        className="sr-only z-overlay rounded-control bg-accent px-4 py-3 text-button text-on-accent focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      {/* Common Room top bar: white, a hairline under it. */}
      <header className="relative z-local bg-surface shadow-[0_1px_0_var(--line)]">
        <div className="mx-auto flex min-h-15 w-full max-w-page items-center gap-3 px-3 md:px-6 lg:gap-6">
          <Link
            href={admin ? "/admin" : "/staff/tasks"}
            className="inline-flex flex-none items-baseline gap-2 rounded-control font-display text-[1.5rem] leading-none font-extrabold tracking-[-0.02em] whitespace-nowrap text-ink focus-ring outline-none max-md:py-2.5"
          >
            Naba-Lens
            {admin ? " " : null}
            {admin ? (
              <span className="border-l border-edge-strong pl-2 font-sans text-meta font-semibold tracking-normal text-ink-muted">
                Admin
              </span>
            ) : null}
          </Link>
          <nav
            aria-label={navLabel}
            data-slot="app-nav"
            className="hidden min-w-0 gap-1 self-stretch md:flex md:max-lg:gap-0"
          >
            {barItems.map(({ item, href, count }) => {
              const current = active === item.id
              const retakeBadge = retakes(item.id)
              return (
                <Link
                  key={item.id}
                  href={href}
                  data-nav-item
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    BAR_LINK,
                    current &&
                      "font-extrabold text-accent-text shadow-[inset_0_-3px_0_var(--accent-text)] hover:text-accent-text"
                  )}
                >
                  {item.label}
                  {count ? (
                    <CountBadge
                      count={count}
                      label="to review"
                      tone="warn"
                      className="-ml-0.5"
                    />
                  ) : null}
                  {/* The same retake count as the phone's Album tab. */}
                  {retakeBadge ? (
                    <TabBadge
                      placement="inline"
                      count={retakeBadge.count}
                      unknown={retakeBadge.unknown}
                      label={retakeLabel(retakeBadge.count)}
                    />
                  ) : null}
                </Link>
              )
            })}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {staff ? (
              <div className="hidden md:block">
                <AlbumAddTrigger kind="bar" />
              </div>
            ) : null}
            {userName ? (
              // From xl only: at lg the name pushes the right-hand group
              // over the last section.
              <span className="hidden max-w-40 truncate text-meta text-ink-muted xl:inline">
                {userName}
              </span>
            ) : null}
            <div className={cn(staff && "hidden md:block")}>
              {onLogout ? (
                logoutButton
              ) : (
                <form action="/auth/logout" method="post" data-logout>
                  {logoutButton}
                </form>
              )}
            </div>
          </div>
        </div>
      </header>
      <main
        id="main"
        // Feed gutter 12px on phones (common-room.md §2), on the grey canvas.
        // overflow-x-clip (not hidden: sticky docks still stick) keeps an
        // older -mx-4 full-bleed bar from scrolling a 320px page sideways.
        className="mx-auto w-full max-w-page flex-1 overflow-x-clip px-page-gutter pt-4 pb-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px)+2rem)] md:px-6 md:py-8"
      >
        <OfflineShell loadedAt={loadedAt}>{children}</OfflineShell>
      </main>
      <nav
        aria-label={navLabel}
        data-slot="tabbar"
        className="fixed inset-x-0 bottom-0 z-nav grid auto-cols-fr grid-flow-col bg-surface pr-[max(0.25rem,env(safe-area-inset-right,0px))] pb-[env(safe-area-inset-bottom,0px)] pl-[max(0.25rem,env(safe-area-inset-left,0px))] shadow-bar md:hidden"
      >
        {admin
          ? barItems.map(({ item, href }) => (
              <TabLink
                key={item.id}
                item={item}
                href={href}
                current={active === item.id}
              />
            ))
          : [ALBUM, null, ME].map((item) =>
              item ? (
                <TabLink
                  key={item.id}
                  item={item}
                  href={item.href}
                  current={active === item.id}
                  count={retakes(item.id)?.count}
                  unknown={retakes(item.id)?.unknown}
                />
              ) : (
                <AlbumAddTrigger key="add" kind="tab" />
              )
            )}
      </nav>
    </div>
  )
}

function TabLink({
  item,
  href,
  current,
  count,
  unknown = false,
}: {
  item: NavItem<string>
  href: string
  current: boolean
  count?: number
  unknown?: boolean
}) {
  const Icon = item.icon
  return (
    <Link
      href={href}
      data-nav-item
      aria-current={current ? "page" : undefined}
      className={cn(
        TAB_ITEM,
        "text-ink-muted hover:bg-surface-2 hover:text-ink",
        // Active tab: accent-text, 800, a 3px bar along the top. The only
        // light blue on the screen.
        current &&
          "font-extrabold text-accent-text before:absolute before:inset-x-[18%] before:top-0 before:h-[3px] before:rounded-b-[3px] before:bg-accent-text hover:text-accent-text"
      )}
    >
      <Icon aria-hidden className="size-[26px]" />
      {item.label}
      <TabBadge count={count} unknown={unknown} label={retakeLabel(count)} />
    </Link>
  )
}

function retakeLabel(count: number | undefined) {
  return count === 1 ? "retake" : "retakes"
}
