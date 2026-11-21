import type { Metadata } from "next"
import Link from "next/link"

import { workspaceManagerContext } from "@/app/staff/manage/_shared/context"
import {
  AlbumPlacesForm,
  type AlbumPlacesGroup,
} from "@/components/nabalens/album/album-places-form"
import { BackLink } from "@/components/nabalens/back-link"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { knowledgeServices } from "@/lib/knowledge-client/services"
import {
  getAlbumBriefs,
  getAlbumPlacements,
  getAlbumShelves,
} from "@/lib/server/album"
import { isShelfOf, SHELVES, suggestShelf } from "@/lib/album/shelves"

import {
  setAlbumBriefAction,
  setAlbumPlaceAction,
  setAlbumShelfAction,
} from "./actions"

export const metadata: Metadata = { title: "Places and briefs" }

/**
 * Places and briefs, a detail page of Album › Spaces (redesign R4, ia.md;
 * was "Album places"; DESIGN.md §6.2, Album A2): where staff stand to photograph
 * each menu section and amenity category. Album groups every slot by these
 * places; a group with no place shows under "Not placed yet". Each menu
 * section also has its one-line brief (§5 Brief, Album AL-4), which can be
 * written before any place is listed.
 */
export default async function ManagerAlbumPlacesPage() {
  const ctx = await workspaceManagerContext()
  const [placements, list, briefs, shelves] = await Promise.all([
    getAlbumPlacements(ctx.actor, ctx.venueId),
    knowledgeServices.getWorkingList(ctx.actor, {}).catch(() => null),
    getAlbumBriefs(ctx.actor, ctx.venueId),
    getAlbumShelves(ctx.actor, ctx.venueId),
  ])
  const chosen = shelves.ok ? shelves.chosen : new Map<string, string>()

  const header = (
    <div className="grid gap-1">
      <BackLink href={managerHrefs.spaces} compact>
        Spaces
      </BackLink>
      <PageHeader
        venueScope
        scope={ctx.venue.name}
        title="Places and briefs"
        summary="Choose where staff photograph each menu section and amenity, which shelf each section sits on in Album, and write a one-line brief for each section."
      />
    </div>
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
      brief: briefs.ok
        ? (briefs.briefs.sections.get(section.slug) ?? null)
        : null,
      // §5d: a food or drinks section's shelf in Album.
      ...(section.kind === "food" || section.kind === "drinks"
        ? {
            shelf: {
              options: SHELVES[section.kind].map(({ key, label }) => ({
                key,
                label,
              })),
              suggested: suggestShelf(section.kind, section.name),
              chosen: (() => {
                const own = chosen.get(section.slug)
                return own && isShelfOf(section.kind, own) ? own : null
              })(),
            },
          }
        : {}),
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
            className="font-semibold underline"
          >
            Add the bar, the kitchen pass and the other places
          </Link>{" "}
          to choose where each section is photographed. Section briefs can be
          written now.
        </Notice>
      ) : (
        <p className="text-body text-ink-muted">
          Missing a place?{" "}
          <Link
            href="/manager/amenities/places"
            className="font-semibold text-accent-text underline underline-offset-4"
          >
            Add it under Places
          </Link>
          .
        </p>
      )}
      {shelves.ok ? null : (
        <Notice tone="info" role="note">
          Album shows each section on the shelf its name suggests. Moving a
          section to another shelf will be possible once the shelves update is
          installed.
        </Notice>
      )}
      {briefs.ok ? null : (
        <Notice tone="negative" role="alert">
          Section briefs could not be read: {briefs.message}
        </Notice>
      )}
      <AlbumPlacesForm
        places={placements.places}
        groups={groups}
        onSet={setAlbumPlaceAction}
        onSetBrief={briefs.ok ? setAlbumBriefAction : undefined}
        onSetShelf={shelves.ok ? setAlbumShelfAction : undefined}
      />
    </div>
  )
}
