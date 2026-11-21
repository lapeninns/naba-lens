import type { Metadata } from "next"

import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireActiveAdmin } from "@/lib/auth"
import { loadAdminAlbums } from "@/lib/server/album-admin"
import { getCoverageActor } from "@/lib/server/coverage"

import { ADMIN_SECTION_TITLES, AdminTabs } from "../_components/admin-tabs"
import { ADMIN_ALBUMS_COPY, AdminAlbumsView } from "./albums-view"

export const metadata: Metadata = { title: ADMIN_ALBUMS_COPY.title }

/**
 * Album A4, admin albums (DESIGN.md §6.6): every venue's album, venues down
 * and Food, Drinks, Amenities, Spaces across, then the biggest gaps. Admins
 * only: the layout's gate, requireActiveAdmin here, and the database
 * (album_admin_counts refuses anyone else).
 */
export default async function AdminAlbumsPage() {
  const profile = await requireActiveAdmin()
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const read = await loadAdminAlbums(auth.actor)
  if (!read.ok) unexpected(read)

  return (
    <AppShell variant="admin" active="overview" userName={profile.displayName}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <PageHeader
            scope={ADMIN_ALBUMS_COPY.scope}
            title={ADMIN_SECTION_TITLES.overview}
            summary={<p>{ADMIN_ALBUMS_COPY.summary}</p>}
            className="pb-0 md:pb-0"
          >
            <AdminTabs set="overview" active="albums" />
          </PageHeader>
          <OfflineNotice />
        </div>
        <AdminAlbumsView albums={read.albums} />
      </div>
    </AppShell>
  )
}
