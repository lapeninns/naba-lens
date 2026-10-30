import type { ImportIssue } from "@/lib/menus/types"
import { cn } from "@/lib/utils"

import { plural } from "./copy"

type ImportIssueListProps = {
  issues: ImportIssue[]
  className?: string
}

/** Errors (block saving/activation) listed before warnings (informational). */
export function ImportIssueList({ issues, className }: ImportIssueListProps) {
  const errors = issues.filter((i) => i.severity === "error")
  const warnings = issues.filter((i) => i.severity === "warning")
  if (issues.length === 0) return null

  const group = (
    list: ImportIssue[],
    title: string,
    tone: "error" | "warning"
  ) =>
    list.length > 0 ? (
      <section
        aria-label={title}
        className={cn(
          "rounded-lg border px-3 py-2 text-sm",
          tone === "error"
            ? "border-negative/30 bg-negative-surface"
            : "border-warning/40 bg-warning-surface"
        )}
      >
        <p
          className={cn(
            "font-medium",
            tone === "error" ? "text-negative" : "text-foreground"
          )}
        >
          {title}
        </p>
        <ul className="mt-1 grid max-h-64 gap-1 overflow-y-auto">
          {list.map((issue, i) => (
            <li key={`${issue.path}-${i}`} className="break-words">
              {issue.path ? (
                <span className="font-mono text-xs text-muted-foreground">
                  {issue.path}:{" "}
                </span>
              ) : null}
              {issue.message}
            </li>
          ))}
        </ul>
      </section>
    ) : null

  return (
    <div className={cn("grid gap-2", className)}>
      {group(errors, plural(errors.length, "error"), "error")}
      {group(warnings, plural(warnings.length, "warning"), "warning")}
    </div>
  )
}
