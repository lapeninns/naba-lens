import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AppShell } from "@/components/nabalens/app-shell"
import { BackLink } from "@/components/nabalens/back-link"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireActiveAdmin } from "@/lib/auth"
import {
  getAssetDetail,
  listCollections,
  listTags,
} from "@/lib/server/library/service"
import { getMediaActor } from "@/lib/server/media/context"
import { libraryVenueOptions } from "@/lib/server/media/library"

import { AssetDetailView } from "../_components/asset-detail"

export const metadata: Metadata = { title: "Photo details · Library" }

/**
 * One asset in the admin Library (spec §8 A4, §11; S2-LIBRARY): its
 * provenance, renditions, labels, review, slots and main-photo choice,
 * eligibility, exports and history, with its actions. Admins only.
 */
export default async function LibraryAssetPage({
  params,
}: {
  params: Promise<{ assetId: string }>
}) {
  const profile = await requireActiveAdmin()
  const auth = await getMediaActor("admin")
  if (!auth.ok) throw new Error("Not authorised.")
  const { assetId } = await params
  const [read, venues, tags, collections] = await Promise.all([
    getAssetDetail(auth.actor, assetId),
    libraryVenueOptions(auth.actor),
    listTags(auth.actor),
    listCollections(auth.actor),
  ])
  if (!read.ok && read.status === 404) notFound()

  return (
    <AppShell variant="admin" active="content" userName={profile.displayName}>
      <div className="flex flex-col gap-6">
        {/* Library, detail page (redesign R5, ia.md). */}
        <div className="grid min-w-0 gap-1">
          <BackLink href="/admin" compact>
            Library
          </BackLink>
          <PageHeader
            venueScope={read.ok}
            scope={read.ok ? read.value.asset.venueName : "Library"}
            title={read.ok ? "Photo details" : "Photo"}
            summary={
              read.ok ? (
                <p className="[overflow-wrap:anywhere]">
                  {read.value.asset.originalFilename}
                </p>
              ) : null
            }
            className="pb-0 md:pb-0"
          />
        </div>
        {read.ok ? (
          <AssetDetailView
            detail={read.value}
            options={{
              venues,
              tags: tags.ok
                ? tags.value
                    .filter((t) => t.active)
                    .map((t) => ({ id: t.id, name: t.name }))
                : [],
              collections: collections.ok
                ? collections.value.map((c) => ({ id: c.id, name: c.name }))
                : [],
            }}
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
