import { notFound } from "next/navigation"

import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { Notice } from "@/components/nabalens/notice"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { loadMoreContributionsAction } from "@/app/_knowledge/actions"
import { requireManagerVenue } from "@/lib/auth/manager"
import type { ContributionsFeedPage } from "@/lib/knowledge/contract"
import { getMediaActor } from "@/lib/server/media/context"
import { workServices } from "@/lib/work-client/services"

import { managerUploadsOn } from "../entry"
import { MyUploads } from "./my-uploads"

export const metadata = { title: "My uploads · Naba-Lens" }

/** R5's first page; null when it couldn't be read, "missing" before B02. */
async function firstPage(): Promise<ContributionsFeedPage | null | "missing"> {
  try {
    const auth = await getMediaActor("manager")
    if (!auth.ok) return null
    const read = await workServices.getContributions(auth.actor)
    if (read.status === "missing") return "missing"
    return read.status === "ok" ? read.value : null
  } catch {
    return null
  }
}

/**
 * My uploads (B02-c): a manager account's own photos from the R5 feed, where
 * it labels them later. Exists only while Add does (the shared entry and
 * R8's canUpload); there is no delete here.
 */
export default async function ManagerUploadsPage() {
  const { venue } = await requireManagerVenue()
  if (!(await managerUploadsOn(venue.id))) notFound()
  const page = await firstPage()
  const copy = MANAGER_COPY.uploads
  return (
    <div className="grid gap-(--gutter)">
      <OfflineNotice
        className={OFFLINE_BANNER_CLASS}
        loadedAt={new Date().toISOString()}
      />
      <PageHeader
        scope={venue.name}
        venueScope
        title={copy.title}
        summary={copy.summary}
        className="pb-0 md:pb-0"
      />
      {page === "missing" ? (
        <Notice role="status">{copy.missing}</Notice>
      ) : (
        <MyUploads
          initial={page}
          venue={venue}
          loadMore={loadMoreContributionsAction}
        />
      )}
    </div>
  )
}
