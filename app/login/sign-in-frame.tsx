import { cn } from "@/lib/utils"

/*
 * The signed-out frame shared by /login, /auth/confirm, /auth/mfa and
 * /auth/blocked (redesign R6, handoff "Sign-in"). No "use client": server
 * pages render these, and the confirm page builds its form from the class
 * names directly.
 *
 * v2 (D10): the name "Naba-Lens" in plain label text, then one column on
 * the canvas. No card and no logo. Each screen has one Fraunces display
 * heading (DESIGN.md §11 rule 9) and at most one primary (bottle) button.
 */

/** The step's column: no surface, no outline (handoff "Sign-in"). */
export const SIGN_IN_CARD = "grid w-full min-w-0 gap-5 text-ink"
/** The screen's one display heading. Focusable states add tabIndex. */
export const SIGN_IN_TITLE = "type-display text-balance text-ink outline-none"
export const SIGN_IN_TEXT =
  "text-body text-pretty text-ink-muted [&_strong]:font-semibold [&_strong]:[overflow-wrap:anywhere] [&_strong]:text-ink"

export function SignInPage({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto grid min-h-svh w-full max-w-110 content-start gap-gutter bg-canvas px-page-gutter pt-6 pb-8 md:pt-16">
      <SignInWordmark />
      {children}
    </main>
  )
}

/** The name as text: not a heading, not a logo, not the display style. */
export function SignInWordmark({ className }: { className?: string }) {
  return <p className={cn("pb-2 text-label text-ink", className)}>Naba-Lens</p>
}

/** One step's column, on the canvas under the name (SignInPage). */
export function SignInCard({
  className,
  children,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section className={cn(SIGN_IN_CARD, className)} {...props}>
      {children}
    </section>
  )
}

/** A caption under the step's actions ("Accounts are by invitation only."). */
export const SIGN_IN_FOOTNOTE = "text-meta text-pretty text-ink-muted"

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
    <div className="grid gap-2">
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
