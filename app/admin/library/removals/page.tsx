import type { Metadata } from "next"

import { AppShell } from "@/components/nabalens/app-shell"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireActiveAdmin } from "@/lib/auth"
import { getAssetDetail } from "@/lib/server/library/service"
import { listMediaRemovalRequests } from "@/lib/server/lifecycle/removal"
import { getMediaActor } from "@/lib/server/media/context"

import { ADMIN_SECTION_TITLES, AdminTabs } from "../../_components/admin-tabs"
import { assetTitle } from "../_components/format"
import { RemovalRequestList } from "../_components/removal"

export const metadata: Metadata = { title: "Removal requests · Library" }

/** Photos labelled per page; any past this are called "Photo". */
const LABELLED = 50

/**
 * Open requests to remove an accepted photo (FA-21, spec §16; S2-LIBRARY),
 * from its uploader or the venue's manager. An admin keeps the photo with a
 * reason or reviews the removal's impact. Oldest first.
 */
export default async function LibraryRemovalsPage() {
  const profile = await requireActiveAdmin()
  const auth = await getMediaActor("admin")
  if (!auth.ok) throw new Error("Not authorised.")
  const read = await listMediaRemovalRequests(auth.actor, { state: "open" })
  // Second handoff: each row names the photo. The label comes from the
  // existing asset detail read, once per photo (open requests are few); a
  // photo whose detail can't be read is called "Photo".
  const assetIds = read.ok
    ? [...new Set(read.requests.map((r) => r.assetId))].slice(0, LABELLED)
    : []
  const details = await Promise.all(
    assetIds.map(
      async (id) => [id, await getAssetDetail(auth.actor, id)] as const
    )
  )
  const labels: Record<string, string> = {}
  for (const [id, detail] of details)
    if (detail.ok) labels[id] = assetTitle(detail.value)

  return (
    <AppShell variant="admin" active="content" userName={profile.displayName}>
      <div className="flex flex-col gap-6">
        <PageHeader
          scope="All venues"
          title={ADMIN_SECTION_TITLES.library}
          summary={
            <p>
              Accepted photos are kept until an admin removes one with a reason.
            </p>
          }
          className="pb-0 md:pb-0"
        >
          <AdminTabs set="library" active="removals" />
        </PageHeader>
        {read.ok ? (
          <RemovalRequestList requests={read.requests} labels={labels} />
        ) : (
          <Notice tone="negative" role="alert">
            {read.message}
          </Notice>
        )}
      </div>
    </AppShell>
  )
}
