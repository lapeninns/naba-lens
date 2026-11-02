import Link from "next/link"
import { SignOutIcon } from "@phosphor-icons/react/dist/ssr"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type AdminSection = "content" | "staff" | "menus" | "coverage"
type StaffSection = "tasks" | "portfolio" | "community" | "people" | "manage"

type AppShellProps = {
  children: React.ReactNode
  /** Signed-in person, shown next to Log out from sm up. */
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
    }
  | {
      variant: "admin"
      active: AdminSection
      /** Defaults: /admin, /admin/staff, /admin/menus and /admin/coverage. */
      hrefs?: Partial<Record<AdminSection, string>>
    }
)

const NAV: { id: AdminSection; label: string; href: string }[] = [
  { id: "content", label: "Content", href: "/admin" },
  { id: "staff", label: "Staff", href: "/admin/staff" },
  { id: "menus", label: "Menus", href: "/admin/menus" },
  { id: "coverage", label: "Coverage", href: "/admin/coverage" },
]

type StaffNavItem = { id: StaffSection; label: string; href: string }

const STAFF_NAV: StaffNavItem[] = [
  { id: "tasks", label: "My tasks", href: "/staff/tasks" },
  { id: "community", label: "Explore", href: "/staff/community" },
  { id: "people", label: "People", href: "/staff/people" },
  { id: "portfolio", label: "My portfolio", href: "/staff" },
]

const MANAGE_NAV: StaffNavItem = {
  id: "manage",
  label: "Manage",
  href: "/staff/manage",
}

const NAV_LINK =
  "inline-flex h-11 items-center rounded-md text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"

/**
 * Shared page frame with staff discovery or administration navigation.
 */
export function AppShell(props: AppShellProps) {
  const { children, userName, onLogout, logoutAction, className } = props
  const logoutButton = (
    <Button
      variant="ghost"
      size="lg"
      type={logoutAction ? "submit" : "button"}
      onClick={logoutAction ? undefined : onLogout}
      className="h-11 sm:h-9"
    >
      <SignOutIcon data-icon="inline-start" aria-hidden />
      Log out
    </Button>
  )
  const staffNav =
    props.variant === "staff" && props.canManage
      ? [...STAFF_NAV, MANAGE_NAV]
      : STAFF_NAV

  return (
    <div className={cn("flex min-h-svh flex-col bg-background", className)}>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="border-b bg-background">
        {/* Phones: the sections take their own full-width row (four admin
            sections plus Log out do not fit beside the wordmark at 360px). The
            staff row stays separate up to md, and wraps on phones, because
            five staff sections do not fit beside the wordmark at 640px. */}
        <div
          className={cn(
            "mx-auto flex min-h-14 w-full max-w-7xl flex-wrap items-center gap-x-2 px-4 sm:gap-x-6 sm:px-6",
            props.variant === "admin"
              ? "sm:h-14 sm:flex-nowrap"
              : "md:h-14 md:flex-nowrap"
          )}
        >
          <span className="text-base font-semibold tracking-tight">
            Naba-Lens
          </span>
          {props.variant === "admin" ? (
            <nav
              aria-label="Admin"
              className="order-last -mx-4 flex w-[calc(100%+2rem)] min-w-0 items-center gap-1 border-t px-3 sm:order-none sm:mx-0 sm:w-auto sm:border-t-0 sm:px-0"
            >
              {NAV.map((item) => {
                const current = props.active === item.id
                return (
                  <Link
                    key={item.id}
                    href={props.hrefs?.[item.id] ?? item.href}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      NAV_LINK,
                      "px-3 sm:h-9",
                      current && "bg-muted text-foreground"
                    )}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          ) : (
            <nav
              aria-label="Staff"
              className="order-last -mx-4 flex w-[calc(100%+2rem)] min-w-0 flex-wrap items-center gap-1 border-t px-3 sm:-mx-6 sm:w-[calc(100%+3rem)] sm:px-5 md:order-none md:mx-0 md:w-auto md:flex-nowrap md:border-t-0 md:px-0"
            >
              {staffNav.map((item) => {
                const current = (props.active ?? "portfolio") === item.id
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      NAV_LINK,
                      "px-2.5 sm:px-3 md:h-9",
                      current && "bg-muted text-foreground"
                    )}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          )}
          <div className="ml-auto flex min-w-0 items-center gap-3">
            {userName ? (
              <span
                className={cn(
                  "hidden max-w-48 truncate text-sm text-muted-foreground",
                  props.variant === "staff" ? "lg:inline" : "sm:inline"
                )}
              >
                {userName}
              </span>
            ) : null}
            {logoutAction ? (
              <form action={logoutAction}>{logoutButton}</form>
            ) : (
              logoutButton
            )}
          </div>
        </div>
      </header>
      <main
        id="main"
        className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8"
      >
        {children}
      </main>
    </div>
  )
}
