import { cn } from "@/lib/utils"

/*
 * The signed-out frame shared by /login, /auth/confirm and /auth/blocked. No
 * "use client": server pages render these, and the confirm page builds its form
 * from the class names directly.
 */

/** On phones the card sits on the page; from md it is a bordered panel. */
export const SIGN_IN_CARD =
  "grid w-full max-w-100 min-w-0 gap-5 px-4 py-6 text-ink md:rounded-panel md:border md:border-line md:bg-panel md:px-6 md:py-8"
export const SIGN_IN_TITLE =
  "font-display text-page-title-compact text-balance outline-none"
export const SIGN_IN_TEXT =
  "text-body-touch text-pretty text-ink-muted md:text-body [&_strong]:font-semibold [&_strong]:break-words [&_strong]:text-ink"

export function SignInPage({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-svh content-start justify-items-center gap-5 px-4 pt-8 pb-8 md:pt-16">
      {children}
    </main>
  )
}

export function SignInWordmark() {
  return <p className="font-display text-count-sm font-bold">Naba-Lens</p>
}

export function SignInCard({
  className,
  children,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section className={cn(SIGN_IN_CARD, className)} {...props}>
      <SignInWordmark />
      {children}
    </section>
  )
}

export function SignInHeading({
  title,
  children,
  id,
  headingRef,
}: {
  title: React.ReactNode
  children?: React.ReactNode
  id?: string
  /** Makes the heading focusable, for moving focus to a new state. */
  headingRef?: React.Ref<HTMLHeadingElement>
}) {
  return (
    <div className="grid gap-1">
      <h1
        id={id}
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className={SIGN_IN_TITLE}
      >
        {title}
      </h1>
      {children ? <p className={SIGN_IN_TEXT}>{children}</p> : null}
    </div>
  )
}
