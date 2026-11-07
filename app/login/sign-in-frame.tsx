import { cn } from "@/lib/utils"

/*
 * The signed-out frame shared by /login, /auth/confirm and /auth/blocked. No
 * "use client": server pages render these, and the confirm page builds its form
 * from the class names directly.
 *
 * Common Room: the wordmark sits on the grey canvas (left on phones, centred
 * from md) and each step is one white card holding the screen's one blue
 * button.
 */

/** One white card on the grey canvas: 12px radius, 16px padding, soft shadow. */
export const SIGN_IN_CARD =
  "grid w-full min-w-0 gap-5 rounded-card bg-surface p-4 text-ink shadow-card md:p-6"
export const SIGN_IN_TITLE =
  "font-display text-page-title-compact text-balance text-ink outline-none"
export const SIGN_IN_TEXT =
  "text-body text-pretty text-ink-muted [&_strong]:font-bold [&_strong]:[overflow-wrap:anywhere] [&_strong]:text-ink"

export function SignInPage({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto grid min-h-svh w-full max-w-110 content-start gap-(--gutter) bg-bg px-(--page-gutter) pt-8 pb-8 md:pt-16">
      <SignInWordmark />
      {children}
    </main>
  )
}

export function SignInWordmark({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "px-1 pb-1 font-display text-display text-ink md:text-center",
        className
      )}
    >
      Naba-Lens
    </p>
  )
}

/** The card. The wordmark is above it, on the canvas (SignInPage). */
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

/** The note under a card, on the canvas ("Accounts are by invitation only."). */
export const SIGN_IN_FOOTNOTE = "px-1 text-center text-meta text-ink-muted"

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
    <div className="grid gap-1.5">
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
