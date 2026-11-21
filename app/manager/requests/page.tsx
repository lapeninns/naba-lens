import type { Metadata } from "next"

import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import { EmptyState } from "@/components/nabalens/empty-state"
import { ErrorState } from "@/components/nabalens/error-state"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import {
  requestHrefs,
  type RequestFilterParam,
} from "@/components/nabalens/requests/hrefs"
import {
  orderRequests,
  RequestRows,
} from "@/components/nabalens/requests/request-row"
import {
  NewShotListForm,
  ShotListCards,
} from "@/components/nabalens/requests/shot-lists"
import { FilterPill } from "@/components/ui/filter-pill"
import { LinkButton } from "@/components/ui/link-button"
import { countRequests, filterRequests } from "@/lib/requests/model"
import { listRequests } from "@/lib/server/requests"

import { cancelShotListAction, createShotListAction } from "./actions"

export const metadata: Metadata = { title: "Requests" }

const FILTERS: { id: RequestFilterParam; label: string }[] = [
  { id: "active", label: "Open" },
  { id: "done", label: "Done" },
  { id: "all", label: "All" },
]

/**
 * Requests and shot lists (spec §7 M4; FA-5; S2-REQ), drawn to the 21 Nov
 * handoff's Requests figure: the counts under the title, one bottle button
 * (New request), then Blocked first, Submitted, then Open (a neutral chip:
 * nothing has happened yet). A request on a slot never turns Overdue; a New
 * brief or shot list with a due date can. A nav section of its own
 * (redesign R4, ia.md). A failed read is an inline notice with Retry beside
 * what failed; the title, the filters and New request stay.
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
  const counts = read.ok ? countRequests(read.list.items) : null

  const header = (
    <PageHeader
      scope={ctx.venue.name}
      venueScope
      title="Requests"
      summary={
        counts ? (
          <p className="font-mono text-mono font-semibold tabular-nums">
            {counts.open} open · {counts.submitted} submitted · {counts.blocked}{" "}
            blocked
          </p>
        ) : undefined
      }
      actions={
        <LinkButton href={requestHrefs.new()} variant="primary">
          New request
        </LinkButton>
      }
      className="pb-0 md:pb-0"
    />
  )

  const filters = (
    <nav aria-label="Show requests">
      <ul className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <li key={f.id}>
            <FilterPill
              href={requestHrefs.list(f.id)}
              selected={f.id === show}
              current="page"
            >
              {f.label}
            </FilterPill>
          </li>
        ))}
      </ul>
    </nav>
  )

  if (!read.ok)
    return (
      <div className="grid gap-gutter">
        {header}
        {filters}
        <ErrorState
          title="We couldn't load requests"
          role="alert"
          action={
            <LinkButton href={requestHrefs.list(show)} variant="secondary">
              {MANAGER_COPY.retry}
            </LinkButton>
          }
        >
          {read.message} {read.nextAction}
        </ErrorState>
      </div>
    )

  const { list } = read
  const items = orderRequests(filterRequests(list.items, show))
  const openLists = list.shotLists.filter((l) => l.state === "open")
  return (
    <div className="grid gap-gutter">
      <OfflineNotice
        className={OFFLINE_BANNER_CLASS}
        loadedAt={new Date().toISOString()}
      />
      {header}
      {filters}

      <section aria-labelledby="requests-list" className="grid gap-3">
        <h2 id="requests-list" className="sr-only">
          {show === "done" ? "Done" : show === "all" ? "All requests" : "Open"}
        </h2>
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
          />
        )}
      </section>

      <section aria-labelledby="shot-lists" className="grid gap-3">
        {/* Section headings are Figtree (ia.md decision 9). */}
        <h2 id="shot-lists" className="text-heading text-ink">
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
