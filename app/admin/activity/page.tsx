import type { Metadata } from "next"
import Link from "next/link"

import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import { EmptyState } from "@/components/nabalens/empty-state"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import { fieldControlVariants } from "@/components/ui/field-control"
import { requireActiveAdmin } from "@/lib/auth"
import {
  ACTIVITY_SOURCES,
  decodeCursor,
  encodeCursor,
} from "@/lib/ops/activity"
import { loadActivity } from "@/lib/server/audit"
import { getCoverageActor } from "@/lib/server/coverage"

import { ActivityList } from "./activity-list"

export const metadata: Metadata = { title: "Activity · Settings" }

type Search = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) =>
  typeof v === "string" ? v.trim() : ""
const INPUT = fieldControlVariants()

/**
 * Activity (spec §8 A7): who changed what, where, when and why, newest first,
 * from every history table. Filters by venue, kind of change and person; the
 * filters are a plain GET form so they work without JavaScript and live in
 * the URL. Admins only (layout gate, requireActiveAdmin, and admin_activity
 * itself).
 */
export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const profile = await requireActiveAdmin()
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const params = await searchParams
  const venueId = one(params.venue)
  const source = one(params.source)
  const actorId = one(params.person)
  const before = decodeCursor(one(params.before) || undefined)

  const [read, venues] = await Promise.all([
    loadActivity(auth.actor, {
      venueId: venueId || null,
      source: source || null,
      actorId: actorId || null,
      before,
    }),
    auth.actor.db.from("venues").select("id, name").order("name"),
  ])
  if (!read.ok) throw new Error(read.message)
  const venueList = (venues.data ?? []) as { id: string; name: string }[]

  const keep = new URLSearchParams()
  if (venueId) keep.set("venue", venueId)
  if (source) keep.set("source", source)
  if (actorId) keep.set("person", actorId)
  const olderHref = read.page.nextCursor
    ? `/admin/activity?${new URLSearchParams([
        ...keep,
        ["before", encodeCursor(read.page.nextCursor)],
      ])}`
    : null

  return (
    <AppShell variant="admin" active="settings" userName={profile.displayName}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <PageHeader
            scope="All venues"
            title="Activity"
            summary={
              <p>
                Who changed what, where and why. Newest first. Nothing here can
                be edited.
              </p>
            }
            actions={
              <Link
                href="/admin/settings"
                className={buttonVariants({ variant: "secondary" })}
              >
                Settings
              </Link>
            }
            className="pb-0 md:pb-0"
          />
          <OfflineNotice />
        </div>

        <form
          method="get"
          className="grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <label className="grid gap-1.5">
            <span className="text-label">Venue</span>
            <select name="venue" defaultValue={venueId} className={INPUT}>
              <option value="">All venues</option>
              {venueList.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-label">Kind of change</span>
            <select name="source" defaultValue={source} className={INPUT}>
              <option value="">Everything</option>
              {ACTIVITY_SOURCES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {actorId ? (
            <input type="hidden" name="person" value={actorId} />
          ) : null}
          <button
            type="submit"
            className={buttonVariants({ variant: "secondary" })}
          >
            Show
          </button>
        </form>
        {actorId ? (
          <p className="px-1 text-body">
            Showing one person&apos;s changes.{" "}
            <Link
              href={`/admin/activity?${new URLSearchParams([...keep].filter(([k]) => k !== "person"))}`}
              className="text-accent-text underline"
            >
              Show everyone
            </Link>
          </p>
        ) : null}

        {read.page.items.length === 0 ? (
          <EmptyState
            variant="done"
            title={
              before ? "No older changes." : "No changes match these filters."
            }
          />
        ) : (
          <ActivityList items={read.page.items} filters={keep.toString()} />
        )}
        {olderHref ? (
          <div>
            <Link
              href={olderHref}
              className={buttonVariants({ variant: "secondary" })}
            >
              Older changes
            </Link>
          </div>
        ) : null}
      </div>
    </AppShell>
  )
}
