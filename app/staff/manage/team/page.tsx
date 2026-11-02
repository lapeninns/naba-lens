import type { Metadata } from "next"

import { managerAccess } from "@/app/staff/manage/_shared/context"
import { NotManagerPage } from "@/app/staff/manage/_shared/frame"
import {
  TeamScreen,
  type ManageSearch,
} from "@/app/staff/manage/_shared/screens"

export const metadata: Metadata = { title: "Team · Manage · Naba-Lens" }

/** Roster and monthly targets; `?staff=<id>&period=YYYY-MM` opens one person's month. */
export default async function ManageTeamPage({
  searchParams,
}: {
  searchParams: Promise<ManageSearch>
}) {
  const access = await managerAccess()
  if (!access.ok) return <NotManagerPage viewerName={access.viewerName} />
  return <TeamScreen ctx={access.ctx} search={await searchParams} />
}
