import type { Metadata } from "next"

import { managerAccess } from "@/app/staff/manage/_shared/context"
import { NotManagerPage } from "@/app/staff/manage/_shared/frame"
import { SearchScreen } from "@/app/staff/manage/_shared/screens"

export const metadata: Metadata = {
  title: "Search · Manage · Naba-Lens",
}

/**
 * B05-06 asset search for a staff account holding a manager grant (legacy):
 * the venue's photos and videos. Staff without a grant get Manage isn't
 * available; the database refuses them the search too.
 */
export default async function ManageSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const access = await managerAccess()
  if (!access.ok) return <NotManagerPage viewerName={access.viewerName} />
  return (
    <SearchScreen mode="manager" ctx={access.ctx} search={await searchParams} />
  )
}
