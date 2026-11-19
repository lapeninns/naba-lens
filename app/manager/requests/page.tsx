import type { Metadata } from "next"
import Link from "next/link"

import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { EmptyState } from "@/components/nabalens/empty-state"
import { ErrorState } from "@/components/nabalens/error-state"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import {
  requestHrefs,
  type RequestFilterParam,
} from "@/components/nabalens/requests/hrefs"
import { RequestRows } from "@/components/nabalens/requests/request-row"
import {
  NewShotListForm,
  ShotListCards,
} from "@/components/nabalens/requests/shot-lists"
import { LinkButton } from "@/components/ui/link-button"
import { countRequests, filterRequests } from "@/lib/requests/model"
import { listRequests } from "@/lib/server/requests"
import { cn } from "@/lib/utils"

import { cancelShotListAction, createShotListAction } from "./actions"

export const metadata: Metadata = { title: "Requests" }

const FILTERS: { id: RequestFilterParam; label: string }[] = [
  { id: "active", label: "Open" },
  { id: "done", label: "Done" },
  { id: "all", label: "All" },
]

/**
 * Requests and shot lists (spec §7 M4; FA-5; S2-REQ). Open requests first:
 * Blocked, Open, Submitted, by priority and date. A request on a slot never
 * turns Overdue; a New brief or shot list with a due date can. No nav tab
 * (the phone bar is full); linked from Overview.
 */
export default async function ManagerRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await workspaceManagerContext()
  const raw = (await searchParams).show
  const show: RequestFilterParam =
    raw === "done" || raw === "all" ? raw : "active"
  const read = await listRequests(ctx.actor, {
    venueId: ctx.venueId,
    includeClosed: show !== "active",
  })

  const header = (
    <PageHeader
      scope={ctx.venue.name}
      venueScope
      title="Requests"
      summary="Ask for a photo on a slot, a new subject or a fact check. A request on a slot completes when its photo is accepted; staff see it on that slot with your brief."
      actions={
        <LinkButton href={requestHrefs.new()} variant="primary">
          New request
        </LinkButton>
      }
      className="pb-0 md:pb-0"
    />
  )

  if (!read.ok)
    return (
      <div className="grid gap-gutter">
        {header}
        <ErrorState title="We couldn't load requests" role="alert">
          {read.message} {read.nextAction}
        </ErrorState>
      </div>
    )

  const { list } = read
  const items = filterRequests(list.items, show)
  const counts = countRequests(list.items)
  const openLists = list.shotLists.filter((l) => l.state === "open")
  return (
    <div className="grid gap-gutter">
      <OfflineNotice
        className={OFFLINE_BANNER_CLASS}
        loadedAt={new Date().toISOString()}
      />
      {header}

      <section aria-labelledby="requests-list" className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="requests-list" className="type-section-title text-ink">
            {show === "done"
              ? "Done"
              : show === "all"
                ? "All requests"
                : "Open"}
          </h2>
          {show === "active" ? (
            <p className="font-mono text-mono font-semibold text-ink-muted tabular-nums">
              {counts.open} open · {counts.submitted} submitted ·{" "}
              {counts.blocked} blocked
            </p>
          ) : null}
        </div>
        <nav aria-label="Show requests" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.id}
              href={requestHrefs.list(f.id)}
              aria-current={f.id === show ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-round px-4 font-semibold focus-ring",
                f.id === show
                  ? "bg-accent-soft text-accent-text inset-ring-2 inset-ring-accent"
                  : "bg-surface text-ink shadow-card"
              )}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        {items.length > 0 ? (
          <RequestRows requests={items} shotLists={list.shotLists} />
        ) : (
          <EmptyState
            variant={show === "active" ? "first-use" : "done"}
            title={show === "active" ? "No open requests" : "Nothing here yet"}
            description={
              show === "active"
                ? "Ask for a missing dish, a better angle or a fact check. Staff see it on the slot."
                : "Completed and cancelled requests are kept here."
            }
            action={
              show === "active" ? (
                <LinkButton href={requestHrefs.new()} variant="secondary">
                  New request
                </LinkButton>
              ) : undefined
            }
          />
        )}
      </section>

      <section aria-labelledby="shot-lists" className="grid gap-3">
        <h2 id="shot-lists" className="type-section-title text-ink">
          Shot lists
        </h2>
        <p className="text-body text-ink-muted">
          Group a few requests for a menu launch or a quiet service period.
        </p>
        <ShotListCards
          lists={show === "active" ? openLists : list.shotLists}
          actions={{
            create: createShotListAction,
            cancel: cancelShotListAction,
          }}
        />
        <NewShotListForm today={list.today} create={createShotListAction} />
      </section>
    </div>
  )
}
