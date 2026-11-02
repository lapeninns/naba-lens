import Link from "next/link"

import { cn } from "@/lib/utils"

export type ManageSection =
  "overview" | "review" | "checklist" | "menu" | "team"

const SECTIONS: { id: ManageSection; label: string; path: string }[] = [
  { id: "overview", label: "Overview", path: "" },
  { id: "review", label: "Review", path: "/review" },
  { id: "checklist", label: "Checklist", path: "/checklist" },
  { id: "menu", label: "Menu", path: "/menu" },
  { id: "team", label: "Team", path: "/team" },
]

/** Hrefs of one venue's manager tools (`/staff/manage` or an admin venue). */
export function manageHrefs(basePath: string) {
  return {
    overview: basePath,
    review: `${basePath}/review`,
    checklist: `${basePath}/checklist`,
    requirement: (id: string) =>
      `${basePath}/checklist/${encodeURIComponent(id)}`,
    menu: `${basePath}/menu`,
    team: `${basePath}/team`,
    staff: (id: string) => `${basePath}/team?staff=${encodeURIComponent(id)}`,
  }
}

export type ManageHrefs = ReturnType<typeof manageHrefs>

/** Sub-navigation between a venue's coverage tools. */
export function ManageNav({
  basePath,
  active,
  pendingReview,
}: {
  basePath: string
  active: ManageSection
  pendingReview?: number
}) {
  return (
    <nav aria-label="Venue coverage" className="border-b">
      <ul className="flex flex-wrap gap-x-1">
        {SECTIONS.map((section) => {
          const current = section.id === active
          return (
            <li key={section.id}>
              <Link
                href={`${basePath}${section.path}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex h-11 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-10",
                  current && "border-primary text-foreground"
                )}
              >
                {section.label}
                {section.id === "review" && pendingReview ? (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">
                    <span className="sr-only">, </span>
                    {pendingReview}
                    <span className="sr-only"> to review</span>
                  </span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
