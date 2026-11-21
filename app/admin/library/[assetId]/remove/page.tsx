import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AppShell } from "@/components/nabalens/app-shell"
import { BackLink } from "@/components/nabalens/back-link"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireActiveAdmin } from "@/lib/auth"
import { getRemovalImpact } from "@/lib/server/lifecycle/removal"
import { getAssetDetail } from "@/lib/server/library/service"
import { getMediaActor } from "@/lib/server/media/context"

import { RemovalForm } from "../../_components/removal"

export const metadata: Metadata = { title: "Remove permanently · Library" }

/**
 * Permanent removal of one photo (spec §8 A4, §16; FA-21; S2-LIBRARY): the
 * impact preview, a required reason, and a refusal while it is published.
 * Admins only; the database rechecks everything at removal.
 */
export default async function LibraryRemovePage({
  params,
}: {
  params: Promise<{ assetId: string }>
}) {
  const profile = await requireActiveAdmin()
  const auth = await getMediaActor("admin")
  if (!auth.ok) throw new Error("Not authorised.")
  const { assetId } = await params
  const [detail, impact] = await Promise.all([
    getAssetDetail(auth.actor, assetId),
    getRemovalImpact(auth.actor, assetId),
  ])
  if (!detail.ok && detail.status === 404) notFound()

  return (
    <AppShell variant="admin" active="content" userName={profile.displayName}>
      <div className="flex flex-col gap-6">
        {/* Library, detail page: back to the photo (redesign R5, ia.md). */}
        <div className="grid min-w-0 gap-1">
          <BackLink
            href={`/admin/library/${encodeURIComponent(assetId)}`}
            compact
          >
            The photo
          </BackLink>
          <PageHeader
            venueScope={detail.ok}
            scope={detail.ok ? detail.value.asset.venueName : "Library"}
            title="Remove permanently"
            summary={
              <p>
                Removing deletes the stored files. The record, who took it, the
                reason and its history are kept. It can&apos;t be undone.
              </p>
            }
            className="pb-0 md:pb-0"
          />
        </div>
        {impact.ok ? (
          <RemovalForm assetId={assetId} impact={impact.impact} />
        ) : (
          <Notice tone="negative" role="alert">
            {impact.message}
          </Notice>
        )}
      </div>
    </AppShell>
  )
}
