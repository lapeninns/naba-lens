import Link from "next/link"
import {
  ClipboardTextIcon,
  ForkKnifeIcon,
  HouseIcon,
  ImagesIcon,
  SignOutIcon,
  UserCircleIcon,
  UsersIcon,
} from "@phosphor-icons/react/dist/ssr"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { OfflineShell } from "./offline-notice"
import { ProfileAvatar } from "./profile-avatar"
import { AddTrigger, TAB_ITEM } from "./shell/add-context"
import { CountBadge } from "./status-chip"

type AdminSection = "content" | "staff" | "menus" | "coverage"
type StaffSection =
  "tasks" | "menu" | "portfolio" | "community" | "people" | "manage"

type AppShellProps = {
  children: React.ReactNode
  /** Signed-in person, shown next to Log out from md up. */
  userName?: string
  /** Log out handler, or a server action used as the form action. */
  onLogout?: () => void
  logoutAction?: (formData: FormData) => void | Promise<void>
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
      /** The phone bar's link to Me shows this photo, or initials. */
      avatarUrl?: string | null
      /** Things in To do, counted on Home while another section is open. */
      todoCount?: number
      /** Photos waiting for this manager's decision, counted on Manage. */
      reviewCount?: number
    }
  | {
      variant: "admin"
      active: AdminSection
      /** Defaults: /admin, /admin/staff, /admin/menus and /admin/coverage. */
      hrefs?: Partial<Record<AdminSection, string>>
    }
)

type Icon = typeof HouseIcon

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
]

const HOME: NavItem<StaffSection> = {
  id: "tasks",
  label: "Home",
  href: "/staff/tasks",
  icon: HouseIcon,
}
/**
 * Our menu (menu items with an accepted photo). In the AppBar only: the phone
 * TabBar keeps its five tabs, and phones reach Our menu from Home's card.
 */
const OUR_MENU: NavItem<StaffSection> = {
  id: "menu",
  label: "Our menu",
  href: "/staff/menu",
  icon: ForkKnifeIcon,
}
const PHOTOS: NavItem<StaffSection> = {
  id: "community",
  label: "Photos",
  href: "/staff/community",
  icon: ImagesIcon,
}
const PEOPLE: NavItem<StaffSection> = {
  id: "people",
  label: "People",
  href: "/staff/people",
  icon: UsersIcon,
}
const ME: NavItem<StaffSection> = {
  id: "portfolio",
  label: "Me",
  href: "/staff",
  icon: UserCircleIcon,
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
  "inline-flex items-center gap-2 px-3 font-display text-tab-label text-ink-muted whitespace-nowrap shadow-[inset_0_-3px_0_transparent] transition-colors duration-(--duration-quick) outline-none hover:bg-surface-2 hover:text-ink focus-visible:outline-3 focus-visible:outline-solid focus-visible:-outline-offset-3 focus-visible:outline-focus"

/**
 * Page frame for signed-in pages. From md: the AppBar with the role's
 * sections, Add photos (staff) and Log out. Below md: a slim bar (wordmark,
 * and a link to Me for staff) and the TabBar pinned to the bottom.
 */
export function AppShell(props: AppShellProps) {
  const { children, userName, onLogout, logoutAction, className } = props
  const staff = props.variant === "staff" ? props : null
  const admin = props.variant === "admin" ? props : null

  const barItems: { item: NavItem<string>; href: string; count?: number }[] =
    admin
      ? ADMIN_NAV.map((item) => ({
          item,
          href: admin.hrefs?.[item.id] ?? item.href,
        }))
      : [
          HOME,
          OUR_MENU,
          PHOTOS,
          PEOPLE,
          ME,
          ...(staff?.canManage ? [MANAGE] : []),
        ].map((item) => ({
          item,
          href: item.href,
          count: item.id === "manage" ? staff?.reviewCount : undefined,
        }))
  const active = admin ? admin.active : (staff?.active ?? "portfolio")
  const navLabel = admin ? "Admin" : "Staff"

  const logoutButton = (
    <Button
      variant="quiet"
      className="max-md:min-h-11 lg:whitespace-nowrap"
      type={logoutAction ? "submit" : "button"}
      onClick={logoutAction ? undefined : onLogout}
    >
      <SignOutIcon data-icon="inline-start" aria-hidden />
      {/* Icon only from md to lg, so a manager's five sections still fit at 768px. */}
      <span className={cn(staff && "md:max-lg:sr-only")}>Log out</span>
    </Button>
  )

  return (
    <div className={cn("flex min-h-svh flex-col bg-bg text-ink", className)}>
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-accent px-4 py-3 text-button text-on-accent focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      {/* Common Room top bar: white, a hairline under it. */}
      <header className="relative z-10 bg-surface shadow-[0_1px_0_var(--line)]">
        <div className="mx-auto flex min-h-15 w-full max-w-(--size-page) items-center gap-3 px-3 md:gap-4 md:px-6 lg:gap-6">
          <Link
            href={admin ? "/admin" : "/staff/tasks"}
            className="inline-flex flex-none items-baseline gap-2 rounded-control font-display text-[1.5rem] leading-none font-extrabold tracking-[-0.02em] whitespace-nowrap text-ink outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid max-md:py-2.5"
          >
            Naba-Lens
            {admin ? " " : null}
            {admin ? (
              <span className="border-l border-line-control pl-2 font-sans text-meta-strong tracking-normal text-ink-muted">
                Admin
              </span>
            ) : null}
          </Link>
          <nav
            aria-label={navLabel}
            data-slot="app-nav"
            className="hidden min-w-0 gap-1 self-stretch md:flex"
          >
            {barItems.map(({ item, href, count }) => {
              const current = active === item.id
              return (
                <Link
                  key={item.id}
                  href={href}
                  data-nav-item
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    BAR_LINK,
                    current &&
                      "font-extrabold text-accent-text shadow-[inset_0_-3px_0_var(--accent-text)] hover:text-accent-text",
                    // A manager's six sections don't fit from md to lg; there
                    // Our menu is reached from Home and Manage instead.
                    item.id === "menu" && staff?.canManage && "md:max-lg:hidden"
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
                </Link>
              )
            })}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {staff ? (
              <div className="hidden md:block">
                <AddTrigger kind="bar" />
              </div>
            ) : null}
            {userName ? (
              <span className="hidden max-w-48 truncate text-meta text-ink-muted lg:inline">
                {userName}
              </span>
            ) : null}
            <div className={cn(staff && "hidden md:block")}>
              {logoutAction ? (
                <form action={logoutAction} data-logout>
                  {logoutButton}
                </form>
              ) : (
                logoutButton
              )}
            </div>
            {staff ? (
              <Link
                href={ME.href}
                className="-mr-1 grid size-12 place-items-center rounded-round outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid md:hidden"
              >
                {/* The avatar is aria-hidden, so this text is the whole name.
                    axe's label-content-name-mismatch flags an aria-label that
                    omits the visible initials; a text name is not checked. */}
                <span className="sr-only">
                  {userName ? `Me: ${userName}` : "Me"}
                </span>
                <ProfileAvatar
                  name={userName ?? "Me"}
                  src={staff.avatarUrl}
                  size="sm"
                />
              </Link>
            ) : null}
          </div>
        </div>
      </header>
      <main
        id="main"
        // Feed gutter 12px on phones (DESIGN.md §2), on the grey canvas.
        // overflow-x-clip (not hidden: sticky docks still stick) keeps an
        // older -mx-4 full-bleed bar from scrolling a 320px page sideways.
        className="mx-auto w-full max-w-(--size-page) flex-1 overflow-x-clip px-(--page-gutter) pt-4 pb-[calc(var(--size-tabbar)+env(safe-area-inset-bottom,0px)+2rem)] md:px-6 md:py-8"
      >
        <OfflineShell>{children}</OfflineShell>
      </main>
      <nav
        aria-label={navLabel}
        data-slot="tabbar"
        className="fixed inset-x-0 bottom-0 z-40 grid auto-cols-fr grid-flow-col bg-surface px-1 pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-1px_0_var(--line)] md:hidden"
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
          : [HOME, PHOTOS, null, PEOPLE, ME].map((item) =>
              item ? (
                <TabLink
                  key={item.id}
                  item={item}
                  href={item.href}
                  current={active === item.id}
                  count={
                    item.id === "tasks" && active !== "tasks"
                      ? staff?.todoCount
                      : undefined
                  }
                />
              ) : (
                <AddTrigger key="add" kind="tab" />
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
}: {
  item: NavItem<string>
  href: string
  current: boolean
  count?: number
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
      {count ? (
        <CountBadge
          count={count}
          label={count === 1 ? "thing to do" : "things to do"}
          tone="warn"
          className="absolute top-1 left-[calc(50%+6px)] ring-2 ring-surface"
        />
      ) : null}
    </Link>
  )
}
