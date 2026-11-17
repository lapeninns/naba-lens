import type { Metadata } from "next"
import Link from "next/link"

import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import {
  AlbumPlacesForm,
  type AlbumPlacesGroup,
} from "@/components/nabalens/album/album-places-form"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import { getAlbumPlacements } from "@/lib/server/album"

import { setAlbumPlaceAction } from "./actions"

export const metadata: Metadata = { title: "Album places" }

/**
 * Album places (DESIGN.md §6.2, Album A2): where staff stand to photograph
 * each menu section and amenity category. Album groups every slot by these
 * places; a group with no place shows under "Not placed yet".
 */
export default async function ManagerAlbumPlacesPage() {
  const ctx = await workspaceManagerContext()
  const [placements, list] = await Promise.all([
    getAlbumPlacements(ctx.actor, ctx.venueId),
    knowledgeServices.getWorkingList(ctx.actor, {}).catch(() => null),
  ])

  const header = (
    <PageHeader
      venueScope
      scope={ctx.venue.name}
      title="Album places"
      summary="Choose where staff photograph each menu section and amenity. Album shows staff the empty slots wherever they are standing."
    />
  )

  if (!placements.ok)
    return (
      <div className="grid gap-6">
        {header}
        <Notice tone="negative" role="alert">
          {placements.message}
        </Notice>
      </div>
    )

  const placedAt = new Map(
    placements.placements.map((p) => [`${p.source}:${p.key}`, p.subjectId])
  )
  const categories = [
    ...new Set(
      list && list.ok && list.view
        ? list.view.slots.map((slot) => slot.category)
        : []
    ),
  ].sort((a, b) => a.localeCompare(b, "en-GB"))
  const groups: AlbumPlacesGroup[] = [
    ...placements.sections.map((section) => ({
      source: "menu_section" as const,
      key: section.slug,
      name: section.name,
      subjectId: placedAt.get(`menu_section:${section.slug}`) ?? null,
    })),
    ...categories.map((category) => ({
      source: "amenity_category" as const,
      key: category,
      name: category,
      subjectId: placedAt.get(`amenity_category:${category}`) ?? null,
    })),
  ]

  return (
    <div className="grid gap-6">
      {header}
      {placements.places.length === 0 ? (
        <Notice tone="info" role="note">
          No places listed yet.{" "}
          <Link
            href="/manager/amenities/places"
            className="font-bold underline"
          >
            Add the bar, the kitchen pass and the other places
          </Link>{" "}
          first, then come back here.
        </Notice>
      ) : (
        <>
          <p className="text-body text-ink-muted">
            Missing a place?{" "}
            <Link
              href="/manager/amenities/places"
              className="font-bold text-accent-text underline underline-offset-4"
            >
              Add it under Places
            </Link>
            .
          </p>
          <AlbumPlacesForm
            places={placements.places}
            groups={groups}
            onSet={setAlbumPlaceAction}
          />
        </>
      )}
    </div>
  )
}
