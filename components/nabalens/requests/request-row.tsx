import Link from "next/link"

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

const ROW_WORDS = { blocked: "Blocked" } as const

/** List order (the handoff's Requests figure): Blocked, Submitted, Open, then the rest. */
const STATE_RANK: Record<RequestView["state"], number> = {
  blocked: 0,
  submitted: 1,
  open: 2,
  completed: 3,
  cancelled: 4,
}

/**
 * Requests in the list's order: Blocked first, then Submitted, then Open,
 * each keeping the server's order (priority and date) within its state.
 */
export function orderRequests(requests: RequestView[]): RequestView[] {
  return requests
    .map((request, index) => ({ request, index }))
    .sort(
      (a, b) =>
        STATE_RANK[a.request.state] - STATE_RANK[b.request.state] ||
        a.index - b.index
    )
    .map(({ request }) => request)
}

/*
 * One request in the manager's list (spec §7 M4): the subject, then the
 * kind, the date, the person, the priority and the shot list, a Blocked
 * reason and the brief; the state chip (the shared status chip's request
 * words; Open is neutral) on the right. A slot request's date reads "Needed
 * by" and never Overdue (FA-5). The whole row is one link to the request.
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
    // v2 ListRow (the handoff's Requests figure): the subject and one line
    // of detail on the left, the state chip on the right.
    <Link
      href={requestHrefs.request(request.id)}
      data-request-id={request.id}
      data-state={request.state}
      className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 focus-ring-inset outline-none hover:bg-raised sm:px-4"
    >
      <span className="grid min-w-0 gap-0.5">
        <span className="text-label [overflow-wrap:anywhere] text-ink">
          {request.subject}
        </span>
        <span className="text-meta [overflow-wrap:anywhere] text-ink-muted">
          {meta.join(" · ")}
        </span>
        {request.state === "blocked" && request.blockedReason ? (
          <span className="text-meta [overflow-wrap:anywhere] text-warn-fg">
            {`${ROW_WORDS.blocked}: ${request.blockedReason}`}
          </span>
        ) : null}
        <span className="text-meta [overflow-wrap:anywhere] text-ink-muted">
          {request.brief}
        </span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <StatusChip state={requestChip(request.state)} />
        {request.overdue ? <StatusChip state="overdue" /> : null}
        {request.retake && request.state === "open" ? (
          <span className="text-meta font-semibold text-warn-fg">
            {REQUEST_WORDS.retake}
          </span>
        ) : null}
      </span>
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
    // One card, rows split by hairlines (v2 ListRow in a card).
    <ul
      className={cn(
        "divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card",
        className
      )}
      data-slot="request-rows"
    >
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
