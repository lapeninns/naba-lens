import type { Metadata } from "next"

import { AppShell } from "@/components/nabalens/app-shell"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireActiveAdmin } from "@/lib/auth"
import { listCollections } from "@/lib/server/library/service"
import { getMediaActor } from "@/lib/server/media/context"

import { ADMIN_SECTION_TITLES, AdminTabs } from "../../_components/admin-tabs"
import {
  CollectionsView,
  NewCollectionButton,
} from "../_components/collections"

export const metadata: Metadata = { title: "Collections · Library" }

/**
 * Collections (spec §8 A4, §11; S2-LIBRARY): photos gathered for a campaign,
 * by reference. Admins only. `?archived=1` lists archived ones too.
 */
export default async function LibraryCollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>
}) {
  const profile = await requireActiveAdmin()
  const auth = await getMediaActor("admin")
  if (!auth.ok) throw new Error("Not authorised.")
  const showArchived = (await searchParams).archived === "1"
  const read = await listCollections(auth.actor, showArchived)

  return (
    <AppShell variant="admin" active="content" userName={profile.displayName}>
      <div className="flex flex-col gap-6">
        <PageHeader
          scope="All venues"
          title={ADMIN_SECTION_TITLES.library}
          summary={
            <p>
              Gather photos for a campaign or a page. A collection points at the
              photos; it never copies or deletes them.
            </p>
          }
          actions={<NewCollectionButton />}
          className="pb-0 md:pb-0"
        >
          <AdminTabs set="library" active="collections" />
        </PageHeader>
        {read.ok ? (
          <CollectionsView
            collections={read.value}
            showArchived={showArchived}
          />
        ) : (
          <Notice tone="negative" role="alert">
            {read.message}
          </Notice>
        )}
      </div>
    </AppShell>
  )
}
