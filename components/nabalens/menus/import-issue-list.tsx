import { WarningCircleIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr"

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
          "rounded-control px-3.5 py-3 text-body-touch text-ink md:text-body-sm",
          tone === "error" ? "bg-negative-soft" : "bg-attention-soft"
        )}
      >
        <p className="flex items-center gap-2 font-semibold">
          {tone === "error" ? (
            <WarningCircleIcon aria-hidden className="size-5 text-negative" />
          ) : (
            <WarningIcon aria-hidden className="size-5 text-attention" />
          )}
          {title}
        </p>
        <ul className="mt-1 grid max-h-64 gap-1 overflow-y-auto pl-7">
          {list.map((issue, i) => (
            <li key={`${issue.path}-${i}`} className="break-words">
              {issue.path ? (
                <span className="font-mono text-mono text-ink-muted">
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
