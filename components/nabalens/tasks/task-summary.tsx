import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { PageHeader } from "../page-header"
import { Notice } from "../notice"
import { StatusChip as SystemChip } from "../status-chip"
import { buttonVariants } from "@/components/ui/button"

import { ProfileAvatar } from "../profile-avatar"
import { SharedProgress } from "./assignment-list"
import { requirementKindLabel } from "./copy"
import { DueLine } from "./status-badges"
import type { MyAssignment } from "./types"

/** Back link to Home, sized for touch. */
export function BackToTasks({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 items-center gap-1.5 self-start rounded-md text-meta-touch font-medium text-ink-muted outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9 md:text-meta"
    >
      <ArrowLeftIcon className="size-4" aria-hidden />
      Home
    </Link>
  )
}

/**
 * Task header: what to photograph, by when, and shared progress. Notices carry
 * the overdue, complete and closed states; none of them blocks sending.
 */
export function TaskSummary({
  assignment,
  monthLabel,
  venueName,
  sendHref,
}: {
  assignment: MyAssignment
  /** "November": names the monthly target the photos count toward. */
  monthLabel?: string
  venueName?: string | null
  /** Where "Send photos" jumps to; omitted when the caller can't send. */
  sendHref?: string
}) {
  const { requirement } = assignment
  const closed = !requirement.isCurrent
  const satisfied = requirement.progress.satisfied
  const overdue = Boolean(requirement.due?.overdue) && !satisfied && !closed
  const hasPhotos = assignment.mySubmissions.length > 0
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        venueScope={Boolean(venueName)}
        scope={[venueName, requirementKindLabel(requirement.kind)]}
        title={requirement.title}
        summary={
          requirement.due || closed || satisfied ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {closed ? <SystemChip state="closed" /> : null}
              {satisfied && !closed ? <SystemChip state="complete" /> : null}
              {requirement.due ? (
                <DueLine due={requirement.due} done={satisfied || closed} />
              ) : null}
            </span>
          ) : null
        }
        actions={
          sendHref && assignment.canSubmit ? (
            <Link
              href={sendHref}
              className={buttonVariants({ variant: "default", size: "touch" })}
            >
              {hasPhotos ? "Send more photos" : "Send photos"}
            </Link>
          ) : null
        }
      />

      {closed ? (
        <Notice tone="plain">
          This task is closed. Photos you sent stay counted
          {venueName ? ` for ${venueName}` : ""}.
        </Notice>
      ) : satisfied ? (
        <Notice tone="positive">
          This task has enough accepted photos. Extra photos still go to Photos
          and your profile.
        </Notice>
      ) : overdue ? (
        <Notice tone="attention">
          It&apos;s past its due date. You can still send photos; nothing is
          blocked.
        </Notice>
      ) : monthLabel ? (
        <Notice tone="plain">
          Counts toward the task and your {monthLabel} target once accepted.
        </Notice>
      ) : null}

      {requirement.guidance ? (
        <section aria-labelledby="guidance-heading" className="grid gap-1.5">
          <h2
            id="guidance-heading"
            className="text-section-title-touch md:text-section-title"
          >
            What to photograph
          </h2>
          <p className="max-w-(--size-reading) break-words whitespace-pre-line">
            {requirement.guidance}
          </p>
        </section>
      ) : null}

      <section aria-labelledby="progress-heading" className="grid gap-3">
        <h2
          id="progress-heading"
          className="text-section-title-touch md:text-section-title"
        >
          On this section
        </h2>
        <SharedProgress assignment={assignment} />
        {requirement.assignees.length > 1 ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {requirement.assignees.map((person) => (
              <li
                key={person.id}
                className="flex items-center gap-2 text-body-touch md:text-body-sm"
              >
                <ProfileAvatar
                  name={person.displayName}
                  src={person.avatarUrl}
                  className="size-7"
                />
                {person.displayName}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  )
}
