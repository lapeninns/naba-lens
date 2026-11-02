import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { ProfileAvatar } from "../profile-avatar"
import { SharedProgress } from "./assignment-list"
import { requirementKindLabel } from "./copy"
import { DueLine, StatusChip } from "./status-badges"
import type { MyAssignment } from "./types"

/** Back link to My tasks, sized for touch. */
export function BackToTasks({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 items-center gap-1.5 self-start rounded-md text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9"
    >
      <ArrowLeftIcon className="size-4" aria-hidden />
      My tasks
    </Link>
  )
}

/** Task header: what to photograph, by when, and shared progress. */
export function TaskSummary({ assignment }: { assignment: MyAssignment }) {
  const { requirement } = assignment
  const closed = !requirement.isCurrent
  const satisfied = requirement.progress.satisfied
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {requirementKindLabel(requirement.kind)}
          </span>
          {closed ? <StatusChip tone="muted">Closed</StatusChip> : null}
          {satisfied && !closed ? (
            <StatusChip tone="positive">Complete</StatusChip>
          ) : null}
        </div>
        <h1 className="font-display text-page-title-compact break-words md:text-page-title">
          {requirement.title}
        </h1>
        {requirement.due ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <DueLine due={requirement.due} done={satisfied || closed} />
            {requirement.due.overdue && !satisfied && !closed ? (
              <span className="text-sm text-muted-foreground">
                You can still send photos.
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {requirement.guidance ? (
        <section
          aria-labelledby="guidance-heading"
          className="rounded-xl border bg-muted/30 p-4"
        >
          <h2 id="guidance-heading" className="text-sm font-medium">
            What to photograph
          </h2>
          <p className="mt-1 text-sm break-words whitespace-pre-line">
            {requirement.guidance}
          </p>
        </section>
      ) : null}

      <SharedProgress assignment={assignment} />

      {requirement.assignees.length > 1 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Assigned to</h2>
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {requirement.assignees.map((person) => (
              <li key={person.id} className="flex items-center gap-2 text-sm">
                <ProfileAvatar
                  name={person.displayName}
                  src={person.avatarUrl}
                  className="size-7"
                />
                {person.displayName}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
