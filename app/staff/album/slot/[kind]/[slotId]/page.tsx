import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { reportSlotChangeAction } from "@/app/staff/_me/actions"
import { staffShellStatus } from "@/app/staff/_shell/shell-status"
import { ADD_BLOCKED } from "@/app/staff/add-blocked"
import { AlbumSlotScreen } from "@/components/nabalens/album/slot-screen"
import { AppShell } from "@/components/nabalens/app-shell"
import { Notice } from "@/components/nabalens/notice"
import { OfflineNotice } from "@/components/nabalens/offline-notice"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"
import { findSlot } from "@/lib/album/model"
import { loadAlbum } from "@/lib/server/album"
import { getCoverageActor } from "@/lib/server/coverage"
import { getMyUploads } from "@/lib/server/staff"
import { replacedIds } from "@/lib/staff/my-uploads"

export const metadata: Metadata = { title: "Album" }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One slot (spec §6 S3; S2-STAFF): a dish (`/staff/album/slot/dish/<item>`)
 * or a place (`/staff/album/slot/area/<place>`). An amenity slot opens its
 * question (DESIGN.md §6.3); an unknown slot is 404. The person's own photos
 * of it come from My uploads' newest page, so the reviewer's reason for a
 * retake is the one on Me (AC17).
 */
export default async function AlbumSlotPage({
  params,
}: {
  params: Promise<{ kind: string; slotId: string }>
}) {
  const { kind, slotId } = await params
  if (!UUID.test(slotId)) notFound()
  if (kind === "amenity") redirect(`/staff/tasks/amenities/${slotId}`)
  if (kind !== "dish" && kind !== "area") notFound()
  const profile = await requireActiveStaff()
  const auth = await getCoverageActor()
  if (!auth.ok) notFound()
  const { actor } = auth
  const [shell, album, mine] = await Promise.all([
    staffShellStatus(actor, profile),
    loadAlbum(actor),
    // Own photos are a help on this page, never a reason to fail it.
    getMyUploads(actor).catch(() => null),
  ])
  const found = album.ok ? findSlot(album.album, `${kind}:${slotId}`) : null
  if (album.ok && !found) notFound()

  const items = mine?.ok ? mine.page.items : []
  const replaced = replacedIds(items)
  const ownPhotos = items.flatMap((item) =>
    item.slots
      .filter((s) => s.kind === kind && s.slotId === slotId)
      .map((s) => ({
        assetId: item.assetId,
        outcome: s.outcome,
        uploadedAt: item.uploadedAt,
        reason: s.reason,
        open: s.outcome === "retake_requested" && !replaced.has(item.assetId),
      }))
  )
  const retakeOf = ownPhotos.find((p) => p.open)
  const blocked = uploadBlockReason(profile)

  return (
    <AppShell
      variant="staff"
      active="tasks"
      {...shell}
      userName={profile.displayName}
    >
      <OfflineNotice className="mb-3" />
      {album.ok && found ? (
        <AlbumSlotScreen
          venueName={profile.venue?.name ?? ""}
          placeLabel={found.place.label}
          placeHref={`/staff/album/${found.place.subjectId ?? "unplaced"}`}
          slot={found.slot}
          retake={
            retakeOf
              ? { reason: retakeOf.reason }
              : found.slot.state === "retake"
                ? { reason: null }
                : null
          }
          ownPhotos={ownPhotos.map(({ assetId, outcome, uploadedAt }) => ({
            assetId,
            outcome,
            uploadedAt,
          }))}
          canAdd={blocked === null}
          blocked={blocked ? ADD_BLOCKED[blocked] : null}
          sendReport={reportSlotChangeAction}
        />
      ) : (
        <Notice tone="negative" role="alert">
          {album.ok ? "This slot is no longer listed." : album.message}
        </Notice>
      )}
    </AppShell>
  )
}
