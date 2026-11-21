import { MetaList } from "@/components/nabalens/meta-list"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { ErrorState } from "@/components/nabalens/error-state"
import { BackLink } from "@/components/nabalens/back-link"
import { PageHeader } from "@/components/nabalens/page-header"
import { requestHrefs } from "@/components/nabalens/requests/hrefs"
import { RequestControls } from "@/components/nabalens/requests/request-controls"
import { StatusChip } from "@/components/nabalens/status-chip"
import {
  managerDateWords,
  REQUEST_WORDS,
  requestChip,
  type RequestDetail,
} from "@/lib/requests/model"
import { getRequest, listRequests } from "@/lib/server/requests"

import {
  closeRequestAction,
  editRequestAction,
  setRequestBlockedAction,
} from "../actions"

export const metadata: Metadata = { title: "Request" }

const HISTORY_WORDS: Record<string, string> = {
  created: "Asked",
  edited: "Changed",
  blocked: "Blocked",
  unblocked: "Unblocked",
  completed: "Completed",
  cancelled: "Cancelled",
}

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
})

function facts(r: RequestDetail): Array<[string, string]> {
  // The brief first: the one line staff read on the slot (the handoff's
  // request detail). Kind and date are the summary line under the title.
  const out: Array<[string, string]> = r.brief
    ? [[r.type === "fact_confirmation" ? "Note" : "Brief", r.brief]]
    : []
  out.push([
    "Coverage",
    r.required ? REQUEST_WORDS.required : REQUEST_WORDS.optional,
  ])
  if (r.type !== "fact_confirmation") {
    out.push(["Use", REQUEST_WORDS.use[r.intendedUse]])
    out.push(["Team", REQUEST_WORDS.team[r.team]])
    out.push(["Photos", String(r.photoCount)])
  }
  out.push(["Priority", REQUEST_WORDS.priority[r.priority]])
  out.push([
    r.type === "fact_confirmation" ? "Who confirms it" : "Person",
    r.assignee?.name ?? "Anyone at the venue",
  ])
  if (r.orientation)
    out.push(["Orientation", REQUEST_WORDS.orientation[r.orientation]])
  if (r.wantsVideo) out.push(["Video", "A short video too"])
  if (r.captureWindow) out.push(["When to shoot", r.captureWindow])
  if (r.createdBy) out.push(["Asked by", r.createdBy])
  return out
}

/**
 * One request (spec §7 M4): its subject, brief and fields, its state with
 * the reason when Blocked or Cancelled, what a manager can still change, and
 * its history (append-only). A request that is closed is read only.
 */
export default async function RequestPage({
  params,
}: {
  params: Promise<{ requestId: string }>
}) {
  const ctx = await workspaceManagerContext()
  const { requestId } = await params
  const [read, list] = await Promise.all([
    getRequest(ctx.actor, requestId),
    listRequests(ctx.actor, { venueId: ctx.venueId }),
  ])
  const back = (
    <BackLink href={requestHrefs.list()} compact>
      Requests
    </BackLink>
  )
  if (!read.ok) {
    if (read.code === "not_found") notFound()
    return (
      <div className="grid gap-gutter">
        {back}
        <PageHeader scope={ctx.venue.name} venueScope title="Request" />
        <ErrorState title="We couldn't load this request" role="alert">
          {read.message} {read.nextAction}
        </ErrorState>
      </div>
    )
  }
  const r = read.request
  const closed = r.state === "completed" || r.state === "cancelled"
  return (
    <div className="grid gap-gutter">
      <div className="grid gap-1">
        {back}
        {/* The page frame: the title, then its status chips and one
            summary line (the kind and the date) under it. */}
        <PageHeader
          scope={ctx.venue.name}
          venueScope
          title={r.subject}
          summary={
            <div className="grid gap-1.5">
              <p className="flex flex-wrap items-center gap-2">
                <StatusChip state={requestChip(r.state)} />
                {r.overdue ? <StatusChip state="overdue" /> : null}
                {r.retake && !closed ? (
                  <span className="text-meta font-semibold text-warn-fg">
                    {REQUEST_WORDS.retake}
                  </span>
                ) : null}
              </p>
              <p>
                {[REQUEST_WORDS.type[r.type], managerDateWords(r)]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          }
          className="pb-0 md:pb-0"
        />
      </div>
      {r.state === "blocked" && r.blockedReason ? (
        <p className="text-body text-warn-fg">Blocked: {r.blockedReason}</p>
      ) : null}
      {closed ? (
        <p className="text-body text-ink-muted">
          {r.closedByRule
            ? r.state === "completed"
              ? r.type === "fact_confirmation"
                ? "Completed when the fact was confirmed."
                : "Completed when a photo was accepted."
              : `Closed by the slot: ${r.closedReason ?? "no longer needed"}.`
            : r.closedReason
              ? `${r.state === "cancelled" ? "Cancelled" : "Completed"}: ${r.closedReason}`
              : "Completed by hand."}
        </p>
      ) : null}

      <MetaList
        className="rounded-card bg-surface p-4 edge"
        items={facts(r).map(([label, value]) => ({ label, value }))}
      />

      {!closed ? (
        <RequestControls
          request={r}
          people={list.ok ? list.list.people : []}
          today={list.ok ? list.list.today : ""}
          actions={{
            edit: editRequestAction,
            setBlocked: setRequestBlockedAction,
            close: closeRequestAction,
          }}
        />
      ) : null}

      <section aria-labelledby="request-history" className="grid gap-2">
        <h2 id="request-history" className="text-heading text-ink">
          History
        </h2>
        <ol className="grid gap-1">
          {r.history.map((h, index) => (
            <li
              key={`${h.at}-${index}`}
              className="text-body [overflow-wrap:anywhere] text-ink"
            >
              <span className="font-mono text-mono text-ink-muted">
                {WHEN.format(new Date(h.at))}
              </span>{" "}
              {HISTORY_WORDS[h.kind] ?? h.kind}
              {h.byRule ? " automatically" : h.actor ? ` by ${h.actor}` : ""}
              {h.reason ? `: ${h.reason}` : ""}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
