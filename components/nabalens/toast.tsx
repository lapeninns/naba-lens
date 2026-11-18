import { cn } from "@/lib/utils"

/**
 * v2 Toast (`nl-toast`, D10), the look only: one short past-tense sentence
 * on an ink ground with paper text, so it reads the same in both themes,
 * and an optional single text action such as "Undo". It is a polite status
 * (`role="status"`) and never takes focus.
 *
 * Built for the catalogue, not yet shown anywhere: Album writes feedback on
 * the page (DESIGN.md §6.7), and a screen that adopts a toast also owns its
 * timing (5 seconds, 8 with an action, paused on hover and focus) and shows
 * it only after the server confirms.
 */
export function Toast({
  children,
  action,
  className,
}: {
  children: React.ReactNode
  /** One text button, such as Undo. */
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      role="status"
      data-slot="toast"
      className={cn(
        "inline-flex min-h-12 max-w-full items-center gap-3 rounded-card bg-ink px-4 py-2 text-label text-canvas shadow-float",
        "[&_button]:min-h-10 [&_button]:rounded-square [&_button]:px-2 [&_button]:underline [&_button]:underline-offset-3 [&_button]:focus-ring",
        className
      )}
    >
      <span className="min-w-0">{children}</span>
      {action}
    </div>
  )
}
