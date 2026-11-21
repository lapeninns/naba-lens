import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AppShell } from "@/components/nabalens/app-shell"
import { BackLink } from "@/components/nabalens/back-link"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireActiveAdmin } from "@/lib/auth"
import { isUuid } from "@/lib/library/model"
import { getAssetDetail } from "@/lib/server/library/service"
import { getMediaActor } from "@/lib/server/media/context"

import { CompareView } from "../_components/compare"

export const metadata: Metadata = { title: "Compare · Library" }

/** Two photos side by side (spec §8 A4 "compare suspected duplicates"). */
export default async function LibraryComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>
}) {
  const profile = await requireActiveAdmin()
  const auth = await getMediaActor("admin")
  if (!auth.ok) throw new Error("Not authorised.")
  const { a, b } = await searchParams
  if (!isUuid(a) || !isUuid(b) || a === b) notFound()
  const [left, right] = await Promise.all([
    getAssetDetail(auth.actor, a),
    getAssetDetail(auth.actor, b),
  ])
  if ((!left.ok && left.status === 404) || (!right.ok && right.status === 404))
    notFound()

  return (
    <AppShell variant="admin" active="content" userName={profile.displayName}>
      <div className="flex flex-col gap-6">
        {/* Library, detail page: back to the first photo (redesign R5). */}
        <div className="grid min-w-0 gap-1">
          <BackLink href={`/admin/library/${encodeURIComponent(a)}`} compact>
            The photo
          </BackLink>
          <PageHeader
            scope="Library"
            title="Compare photos"
            className="pb-0 md:pb-0"
          />
        </div>
        {left.ok && right.ok ? (
          <CompareView a={left.value} b={right.value} />
        ) : (
          <Notice tone="negative" role="alert">
            {!left.ok ? left.message : !right.ok ? right.message : null}
          </Notice>
        )}
      </div>
    </AppShell>
  )
}
