import Link from "next/link"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr"

import { StatusChip } from "@/components/nabalens/status-chip"
import {
  managerDateWords,
  REQUEST_WORDS,
  requestChip,
  type RequestView,
  type ShotListView,
} from "@/lib/requests/model"
import { cn } from "@/lib/utils"

import { requestHrefs } from "./hrefs"

/*
 * One request in the manager's list (spec §7 M4): the state chip (the shared
 * status chip's request words), the subject and its brief, then the kind,
 * the date, the person and the priority. A slot request's date reads
 * "Needed by" and never Overdue (FA-5). The whole row is one link to the
 * request.
 */
export function RequestRow({
  request,
  shotList,
}: {
  request: RequestView
  /** The shot list it belongs to, when there is one. */
  shotList?: ShotListView | null
}) {
  const date = managerDateWords(request)
  const meta = [
    REQUEST_WORDS.type[request.type],
    request.required ? null : REQUEST_WORDS.optional,
    date,
    request.assignee ? `For ${request.assignee.name}` : null,
    request.priority !== "normal"
      ? `${REQUEST_WORDS.priority[request.priority]} priority`
      : null,
    shotList ? shotList.name : null,
  ].filter(Boolean)
  return (
    <Link
      href={requestHrefs.request(request.id)}
      data-request-id={request.id}
      data-state={request.state}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-card bg-surface px-3 py-3 shadow-card focus-ring hover:bg-raised sm:px-4"
    >
      <span className="grid min-w-0 gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <StatusChip state={requestChip(request.state)} />
          {request.overdue ? <StatusChip state="overdue" /> : null}
          {request.retake && request.state === "open" ? (
            <span className="text-meta font-semibold text-warn-fg">
              {REQUEST_WORDS.retake}
            </span>
          ) : null}
        </span>
        <span className="text-label [overflow-wrap:anywhere] text-ink">
          {request.subject}
        </span>
        <span className="text-body [overflow-wrap:anywhere] text-ink-muted">
          {request.brief}
        </span>
        {request.state === "blocked" && request.blockedReason ? (
          <span className="text-meta [overflow-wrap:anywhere] text-warn-fg">
            {request.blockedReason}
          </span>
        ) : null}
        <span className="text-meta [overflow-wrap:anywhere] text-ink-muted">
          {meta.join(" · ")}
        </span>
      </span>
      <CaretRightIcon aria-hidden className="size-5 text-ink-muted" />
    </Link>
  )
}

/** The list of requests, or nothing when there are none. */
export function RequestRows({
  requests,
  shotLists,
  className,
}: {
  requests: RequestView[]
  shotLists: ShotListView[]
  className?: string
}) {
  const lists = new Map(shotLists.map((l) => [l.id, l]))
  return (
    <ul className={cn("grid gap-2", className)} data-slot="request-rows">
      {requests.map((r) => (
        <li key={r.id}>
          <RequestRow
            request={r}
            shotList={r.shotListId ? lists.get(r.shotListId) : null}
          />
        </li>
      ))}
    </ul>
  )
}
