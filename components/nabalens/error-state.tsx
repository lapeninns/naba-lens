import { Notice } from "./notice"

export const ERROR_COPY = {
  couldNotLoad: (what = "this page") => `We couldn't load ${what}`,
  checkConnection: "Check your connection and try again.",
  tryAgain: "Try again",
  reload: "Reload",
} as const

/**
 * A failure in a page's place: what happened, then what to do, with one
 * action that repeats the fix. No apologies, no error codes in the sentence
 * (an admin-only request ID goes in `detail`, in mono).
 */
export function ErrorState({
  title,
  children = ERROR_COPY.checkConnection,
  action,
  detail,
  role,
  className,
}: {
  title: React.ReactNode
  children?: React.ReactNode
  action?: React.ReactNode
  detail?: React.ReactNode
  /** "none" when the screen's own status region says the title instead. */
  role?: "alert" | "none"
  className?: string
}) {
  return (
    <Notice
      tone="negative"
      role={role}
      title={title}
      action={action}
      className={className}
    >
      <p>{children}</p>
      {detail ? (
        <p className="mt-1 font-mono text-mono [overflow-wrap:anywhere] text-ink-muted">
          {detail}
        </p>
      ) : null}
    </Notice>
  )
}
