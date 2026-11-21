import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AppShell } from "@/components/nabalens/app-shell"
import { BackLink } from "@/components/nabalens/back-link"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireActiveAdmin } from "@/lib/auth"
import { isUuid } from "@/lib/library/model"
import { listCollections } from "@/lib/server/library/service"
import { getMediaActor } from "@/lib/server/media/context"
import { listLibrary } from "@/lib/server/media/library"

import {
  CollectionDetailView,
  type CollectionPhoto,
} from "../../_components/collections"

export const metadata: Metadata = { title: "Collection · Library" }

/**
 * One collection (spec §8 A4; S2-LIBRARY): its newest photos (withdrawn ones
 * too), each linking to its details, Take out (the photo is kept), and
 * Export per venue into the export builder with the photos already chosen.
 */
export default async function LibraryCollectionPage({
  params,
}: {
  params: Promise<{ collectionId: string }>
}) {
  const profile = await requireActiveAdmin()
  const auth = await getMediaActor("admin")
  if (!auth.ok) throw new Error("Not authorised.")
  const { collectionId } = await params
  if (!isUuid(collectionId)) notFound()
  const [collections, page] = await Promise.all([
    listCollections(auth.actor, true),
    listLibrary(auth.actor, {
      venueId: null,
      staffId: null,
      type: null,
      collectionId,
      withdrawn: "all",
    }),
  ])
  const collection = collections.ok
    ? collections.value.find((c) => c.id === collectionId)
    : undefined
  if (collections.ok && !collection) notFound()

  let photos: CollectionPhoto[] = []
  if (page.ok && page.items.length > 0) {
    const venues = await auth.actor.db
      .from("media_assets")
      .select("id, venue_id")
      .in(
        "id",
        page.items.map((i) => i.id)
      )
    const venueOf = new Map(
      ((venues.data ?? []) as { id: string; venue_id: string }[]).map((r) => [
        r.id,
        r.venue_id,
      ])
    )
    photos = page.items.flatMap((i) => {
      const venueId = venueOf.get(i.id)
      return venueId
        ? [
            {
              id: i.id,
              venueId,
              venueName: i.venueName,
              contributorName: i.contributorName,
              createdAt: i.createdAt,
              thumbnailUrl: i.thumbnailUrl,
            },
          ]
        : []
    })
  }

  return (
    <AppShell variant="admin" active="content" userName={profile.displayName}>
      <div className="flex flex-col gap-6">
        {/* Library, detail page: back to Collections (redesign R5). The
            view draws the title row, which carries the export buttons. */}
        <div className="grid min-w-0 gap-1">
          <BackLink href="/admin/library/collections" compact>
            Collections
          </BackLink>
          {collection && page.ok ? (
            <CollectionDetailView
              collection={collection}
              photos={photos}
              more={page.nextCursor !== null}
            />
          ) : (
            <PageHeader
              scope="Collection"
              title={collection?.name ?? "Collection"}
              summary={collection?.purpose ? <p>{collection.purpose}</p> : null}
              className="pb-0 md:pb-0"
            />
          )}
        </div>
        {collection && page.ok ? null : (
          <Notice tone="negative" role="alert">
            {!page.ok
              ? page.message
              : !collections.ok
                ? collections.message
                : "This collection could not be loaded."}
          </Notice>
        )}
      </div>
    </AppShell>
  )
}
