import type { Metadata } from "next"

import {
  loadInboxAction,
  markNotificationsReadAction,
  saveNotificationPreferencesAction,
} from "@/app/staff/_me/actions"
import { staffShellStatus } from "@/app/staff/_shell/shell-status"
import { AppShell } from "@/components/nabalens/app-shell"
import { NoticesInbox } from "@/components/nabalens/me/notices-inbox"
import { BackLink } from "@/components/nabalens/back-link"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireActiveStaff } from "@/lib/auth"
import { getCoverageActor } from "@/lib/server/coverage"
import { loadInbox, loadPreferences } from "@/lib/server/notifications"
import { NOTICES_COPY } from "@/lib/staff/notices"
import { notFound } from "next/navigation"

export const metadata: Metadata = { title: "Notices" }

/**
 * The staff notice inbox and what to be told about (spec §17; FA-10;
 * S2-STAFF), reached from Me. Each read that fails is said on its own part
 * of the page; the page itself always renders.
 */
export default async function NoticesPage() {
  const profile = await requireActiveStaff()
  const auth = await getCoverageActor()
  if (!auth.ok) notFound()
  const { actor } = auth
  const [shell, inbox, prefs] = await Promise.all([
    staffShellStatus(actor, profile),
    loadInbox(actor).catch(() => null),
    loadPreferences(actor).catch(() => null),
  ])
  return (
    <AppShell
      variant="staff"
      active="portfolio"
      {...shell}
      userName={profile.displayName}
    >
      <div className="mx-auto flex w-full max-w-feed flex-col gap-gutter pb-4">
        <BackLink href="/staff/me">Me</BackLink>
        <PageHeader
          scope={profile.venue?.name ?? null}
          title={NOTICES_COPY.title}
          summary={NOTICES_COPY.summary}
        />
        <NoticesInbox
          initial={inbox?.ok ? inbox.inbox : null}
          preferences={prefs?.ok ? prefs.preferences : null}
          actions={{
            loadMore: loadInboxAction,
            markRead: markNotificationsReadAction,
            savePreferences: saveNotificationPreferencesAction,
          }}
        />
      </div>
    </AppShell>
  )
}
