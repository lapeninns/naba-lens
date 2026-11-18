import Link from "next/link"
import {
  ChartBarIcon,
  ClipboardTextIcon,
  DotsThreeOutlineIcon,
  ExportIcon,
  ForkKnifeIcon,
  GearSixIcon,
  ImagesIcon,
  ImagesSquareIcon,
  SignOutIcon,
  StorefrontIcon,
  UserCircleIcon,
  UsersIcon,
} from "@phosphor-icons/react/dist/ssr"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { OfflineShell } from "./offline-notice"
import { SideNav } from "./side-nav"
import { AlbumAddTrigger } from "./album/album-add-trigger"
import { TabBadge } from "./shell/tab-badge"
import { TAB_ITEM } from "./shell/tab-item"
import { CountBadge } from "./status-chip"

type AdminSection =
  | "overview"
  | "venues"
  | "content"
  | "staff"
  | "menus"
  | "coverage"
  | "albums"
  | "publishing"
  | "settings"
  | "more"
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
      /**
       * Unread notices (FA-10, S2-STAFF), counted on the Me tab while another
       * section is open: a badge, never a toast.
       */
      meCount?: number
    }
  | {
      variant: "admin"
      active: AdminSection
      /** Defaults: ADMIN_NAV's hrefs. */
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

export type AdminNavItem = NavItem<AdminSection> & {
  /** The spec's name for the section (§8), on the More page and headings. */
  fullLabel: string
  /** What the section is for, on the More page. */
  description: string
}

/**
 * Spec §8: Overview / Venues / Menus & catalog / Library / Publishing /
 * People / Settings & activity. The bar shows the short label (the spec's
 * names don't fit beside Log out within max-w-page; departures.md A-ADMIN-1).
 * Coverage and Albums are reached from Overview, which they light up.
 */
export const ADMIN_NAV: AdminNavItem[] = [
  {
    id: "overview",
    label: "Overview",
    fullLabel: "Overview",
    description: "Every venue's coverage, facts, backlog and exceptions.",
    href: "/admin/overview",
    icon: ChartBarIcon,
  },
  {
    id: "venues",
    label: "Venues",
    fullLabel: "Venues",
    description: "Names, locations, status, reviewers and setup.",
    href: "/admin/venues",
    icon: StorefrontIcon,
  },
  {
    id: "menus",
    label: "Menus",
    fullLabel: "Menus & catalog",
    description: "Menu versions, imports, schedules and change requests.",
    href: "/admin/menus",
    icon: ForkKnifeIcon,
  },
  {
    id: "content",
    label: "Library",
    fullLabel: "Library",
    description: "Every photo and video across the group.",
    href: "/admin",
    icon: ImagesIcon,
  },
  // S1-EXPORT (spec §8 A5): export packages and where photos are published.
  {
    id: "publishing",
    label: "Publishing",
    fullLabel: "Publishing",
    description: "Export packages and where photos are published.",
    href: "/admin/publishing",
    icon: ExportIcon,
  },
  {
    id: "staff",
    label: "People",
    fullLabel: "People",
    description: "Invite people, venue roles, admins and access.",
    href: "/admin/staff",
    icon: UsersIcon,
  },
  // Spec §8 A7, Settings and activity: one section, two pages.
  {
    id: "settings",
    label: "Settings",
    fullLabel: "Settings & activity",
    description: "Rules for every venue, monitoring and the activity log.",
    href: "/admin/settings",
    icon: GearSixIcon,
  },
]

/** Sections without their own nav item light up the one they belong to. */
const ADMIN_ACTIVE_ALIAS: Partial<Record<AdminSection, AdminSection>> = {
  coverage: "overview",
  albums: "overview",
}

/** The phone and tablet tab bar: three sections and More (all of them). */
const ADMIN_TABS: AdminSection[] = ["overview", "venues", "content"]
const ADMIN_MORE: NavItem<AdminSection> = {
  id: "more",
  label: "More",
  href: "/admin/more",
  icon: DotsThreeOutlineIcon,
}

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

// AppBar section link (md up), drawn as v2 Tabs: label type in ink-muted,
// the current one in ink with a 3px bottle bar under it.
const BAR_LINK =
  "inline-flex items-center gap-2 px-3 md:max-lg:px-2 text-label text-ink-muted whitespace-nowrap shadow-[inset_0_-3px_0_transparent] transition-colors duration-quick outline-none hover:text-ink focus-ring-inset"

/**
 * Page frame for signed-in pages. From md: the AppBar with the role's
 * sections, Add photos (staff) and Log out. Below md: a slim bar with the
 * wordmark, and the TabBar pinned to the bottom (staff: Album, Add photos and
 * Me, DESIGN.md §5 Tab bar; Me holds Log out). Admins get v2's SideNav from
 * bp-desktop in place of the AppBar's sections (D10); staff screens stay one
 * centred column at every width.
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
      : staff && id === "portfolio" && active !== "portfolio" && staff.meCount
        ? { count: staff.meCount, unknown: false }
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
  const active = admin
    ? (ADMIN_ACTIVE_ALIAS[admin.active] ?? admin.active)
    : (staff?.active ?? "portfolio")
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
      {/* Icon only from md to lg, so a manager's five sections still fit at
          768px; an admin's seven fit from lg with it icon only below xl. */}
      <span
        className={cn(staff && "md:max-lg:sr-only", admin && "max-xl:sr-only")}
      >
        Log out
      </span>
    </Button>
  )

  return (
    <div
      className={cn(
        "flex min-h-svh flex-col bg-canvas text-ink",
        admin && "desktop:pl-rail",
        className
      )}
    >
      <a
        href="#main"
        className="sr-only z-overlay rounded-control bg-accent px-4 py-3 text-button text-on-accent focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      {admin ? (
        <SideNav
          label={navLabel}
          active={active}
          homeHref="/admin/overview"
          items={barItems.map(({ item, href }) => ({
            id: item.id,
            label: item.label,
            href,
            icon: item.icon,
          }))}
        />
      ) : null}
      {/* v2 top bar: surface, a line under it. */}
      <header className="relative z-local bg-surface shadow-[0_1px_0_var(--line)]">
        <div className="mx-auto flex min-h-15 w-full max-w-page items-center gap-3 px-3 md:px-6 lg:gap-6">
          <Link
            href={admin ? "/admin/overview" : "/staff/tasks"}
            className={cn(
              "inline-flex flex-none items-baseline gap-2 rounded-control type-title whitespace-nowrap text-ink focus-ring outline-none max-md:py-2.5",
              // From bp-desktop the admin's name is in the SideNav.
              admin && "desktop:hidden"
            )}
          >
            Naba-Lens
            {admin ? " " : null}
            {admin ? (
              <span className="border-l border-edge-strong pl-2 font-sans text-meta text-ink-muted">
                Admin
              </span>
            ) : null}
          </Link>
          <nav
            aria-label={navLabel}
            data-slot="app-nav"
            // shrink-0: the sections keep their width and the right-hand
            // group gives way (the name truncates). At 1280px an admin's
            // seven sections, the name and Log out were 4px over, and the
            // nav shrank with the group, squeezing its links (S3-R11).
            className={cn(
              "hidden shrink-0 gap-1 self-stretch md:max-lg:gap-0",
              // Seven admin sections need lg; below it the tab bar has them,
              // and from bp-desktop the SideNav does.
              admin ? "lg:flex desktop:hidden" : "md:flex"
            )}
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
                      "text-ink shadow-[inset_0_-3px_0_var(--accent-text)]"
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
        // v2 phone gutter (space-4) on paper; centred, at most content-max.
        // overflow-x-clip (not hidden: sticky docks still stick) keeps an
        // older -mx-4 full-bleed bar from scrolling a 320px page sideways.
        className={cn(
          "mx-auto w-full max-w-page flex-1 overflow-x-clip px-page-gutter pt-4 pb-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom,0px)+2rem)] md:px-6",
          // An admin's tab bar stays up to lg.
          admin ? "md:pt-8 lg:pb-8" : "md:py-8"
        )}
      >
        <OfflineShell loadedAt={loadedAt}>{children}</OfflineShell>
      </main>
      <nav
        aria-label={navLabel}
        data-slot="tabbar"
        className={cn(
          "fixed inset-x-0 bottom-0 z-nav grid auto-cols-fr grid-flow-col bg-surface pr-[max(0.25rem,env(safe-area-inset-right,0px))] pb-[env(safe-area-inset-bottom,0px)] pl-[max(0.25rem,env(safe-area-inset-left,0px))] shadow-bar",
          admin ? "lg:hidden" : "md:hidden"
        )}
      >
        {admin
          ? [
              ...barItems.filter(({ item }) =>
                ADMIN_TABS.includes(item.id as AdminSection)
              ),
              { item: ADMIN_MORE, href: ADMIN_MORE.href },
            ].map(({ item, href }) => (
              <TabLink
                key={item.id}
                item={item}
                href={href}
                current={
                  item.id === "more"
                    ? !ADMIN_TABS.includes(active as AdminSection)
                    : active === item.id
                }
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
                  label={item.id === "portfolio" ? "unread notices" : undefined}
                />
              ) : (
                <AlbumAddTrigger key="add" kind="tab" />
              )
            )}
      </nav>
    </div>
  )
}

/**
 * One TabBar tab (v2 `nl-tab`). Exported for the dev preview, which shows
 * the bar outside a page frame; screens get it through AppShell.
 */
export function TabLink({
  item,
  href,
  current,
  count,
  unknown = false,
  label,
}: {
  item: NavItem<string>
  href: string
  current: boolean
  count?: number
  unknown?: boolean
  /** What the count counts; retakes unless said. */
  label?: string
}) {
  const Icon = item.icon
  return (
    <Link
      href={href}
      data-nav-item
      aria-current={current ? "page" : undefined}
      className={cn(
        TAB_ITEM,
        "text-ink-muted hover:bg-raised hover:text-ink",
        // Active tab (v2 TabBar): bottle, a 3px bar along the top edge.
        current &&
          "text-accent-text before:absolute before:inset-x-1/4 before:top-0 before:h-[3px] before:rounded-b-[3px] before:bg-accent-text hover:text-accent-text"
      )}
    >
      <Icon aria-hidden className="size-6" />
      {item.label}
      <TabBadge
        count={count}
        unknown={unknown}
        label={label ?? retakeLabel(count)}
      />
    </Link>
  )
}

function retakeLabel(count: number | undefined) {
  return count === 1 ? "retake" : "retakes"
}
