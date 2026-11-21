import type { Metadata } from "next"

import { unexpected } from "@/app/staff/manage/_shared/context"
import { AppShell } from "@/components/nabalens/app-shell"
import { Notice } from "@/components/nabalens/notice"
import { BackLink } from "@/components/nabalens/back-link"
import { PageHeader } from "@/components/nabalens/page-header"
import { FilterPill, PillGroup } from "@/components/ui/filter-pill"
import { requireActiveAdmin } from "@/lib/auth"
import { getCoverageActor } from "@/lib/server/coverage"
import { exportHrefs } from "@/lib/server/exports/hrefs"
import {
  isUuid,
  listExportCandidates,
  listExportProfiles,
  listVenues,
} from "@/lib/server/exports/service"

import { EXPORTS_COPY } from "../_components/copy"
import { ExportBuilder } from "../_components/export-builder"

export const metadata: Metadata = { title: EXPORTS_COPY.makePackage }

/**
 * Make an export package (admin; spec §14.1). Choose a venue, then photos.
 * Public by default: only photos approved for public use now. Internal is a
 * separate, explicit choice whose files are all marked internal only.
 */
export default async function AdminNewPackagePage({
  searchParams,
}: {
  searchParams: Promise<{ venue?: string; mode?: string; assets?: string }>
}) {
  const profile = await requireActiveAdmin()
  const auth = await getCoverageActor()
  if (!auth.ok) unexpected(auth)
  const params = await searchParams
  const mode = params.mode === "internal" ? "internal" : "public"
  // Photos chosen in the Library (S2-LIBRARY): start them chosen.
  const preselect = (typeof params.assets === "string" ? params.assets : "")
    .split(",")
    .filter((id) => isUuid(id))
    .slice(0, 200)
  const venues = await listVenues(auth.actor)
  const venueList = venues.ok ? venues.venues : []
  const venueId = isUuid(params.venue)
    ? params.venue
    : venueList.length === 1
      ? venueList[0]!.id
      : null
  const [candidates, profiles] = await Promise.all([
    venueId ? listExportCandidates(auth.actor, venueId, mode) : null,
    listExportProfiles(auth.actor),
  ])
  const href = (v: string | null, m: string) =>
    `${exportHrefs.adminNew()}?${new URLSearchParams({
      ...(v ? { venue: v } : {}),
      ...(m === "internal" ? { mode: m } : {}),
      ...(preselect.length && v === venueId
        ? { assets: preselect.join(",") }
        : {}),
    })}`

  return (
    <AppShell
      variant="admin"
      active="publishing"
      userName={profile.displayName}
    >
      <div className="flex flex-col gap-6">
        {/* Publishing, detail page (redesign R5, ia.md). */}
        <BackLink href="/admin/publishing" compact>
          Publishing
        </BackLink>
        <PageHeader
          scope={
            candidates?.ok
              ? candidates.candidates.venueName
              : EXPORTS_COPY.adminScope
          }
          venueScope={Boolean(candidates?.ok)}
          title={EXPORTS_COPY.makePackage}
          summary={
            <p>
              {mode === "internal"
                ? "Internal export: every photo at the venue, including ones not approved for public use. Each file is marked internal only."
                : "Only photos approved for public use now can be chosen."}
            </p>
          }
          className="pb-0 md:pb-0"
        />
        <PillGroup label="Venue">
          {venueList.map((v) => (
            <FilterPill
              key={v.id}
              href={href(v.id, mode)}
              selected={v.id === venueId}
              current="page"
            >
              {v.name}
            </FilterPill>
          ))}
        </PillGroup>
        <PillGroup label="Kind of export">
          <FilterPill
            href={href(venueId, "public")}
            selected={mode === "public"}
            current="page"
          >
            Approved for public use
          </FilterPill>
          <FilterPill
            href={href(venueId, "internal")}
            selected={mode === "internal"}
            current="page"
          >
            Internal
          </FilterPill>
        </PillGroup>
        {!venueId ? (
          <Notice role="status">Choose a venue.</Notice>
        ) : !candidates || !candidates.ok ? (
          <Notice tone="negative" role="alert">
            {candidates?.message ?? EXPORTS_COPY.unavailable}
          </Notice>
        ) : (
          <ExportBuilder
            key={`${venueId}-${mode}`}
            area="admin"
            mode={mode}
            candidates={candidates.candidates.items}
            profiles={profiles.ok ? profiles.profiles : []}
            preselect={preselect}
          />
        )}
      </div>
    </AppShell>
  )
}
