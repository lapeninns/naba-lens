import Link from "next/link"
import { SignOutIcon } from "@phosphor-icons/react/dist/ssr"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type AdminSection = "content" | "staff"

type AppShellProps = {
  children: React.ReactNode
  /** Signed-in person, shown next to Log out from sm up. */
  userName?: string
  /** Log out handler, or a server action used as the form action. */
  onLogout?: () => void
  logoutAction?: (formData: FormData) => void | Promise<void>
  className?: string
} & (
  | { variant: "staff" }
  | {
      variant: "admin"
      active: AdminSection
      /** Defaults: /admin and /admin/staff. */
      hrefs?: Partial<Record<AdminSection, string>>
    }
)

const NAV: { id: AdminSection; label: string; href: string }[] = [
  { id: "content", label: "Content", href: "/admin" },
  { id: "staff", label: "Staff", href: "/admin/staff" },
]

/**
 * Page frame. Staff get the wordmark and Log out only; admin also get the two
 * sections, Content and Staff. Nothing else belongs in this navigation.
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

  return (
    <div className={cn("flex min-h-svh flex-col bg-background", className)}>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-4 sm:gap-6 sm:px-6">
          <span className="text-base font-semibold tracking-tight">
            NabaLens
          </span>
          {props.variant === "admin" ? (
            <nav aria-label="Admin" className="flex min-w-0 items-center gap-1">
              {NAV.map((item) => {
                const current = props.active === item.id
                return (
                  <Link
                    key={item.id}
                    href={props.hrefs?.[item.id] ?? item.href}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "inline-flex h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9",
                      current && "bg-muted text-foreground"
                    )}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          ) : null}
          <div className="ml-auto flex min-w-0 items-center gap-3">
            {userName ? (
              <span className="hidden max-w-48 truncate text-sm text-muted-foreground sm:inline">
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
