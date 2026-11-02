import type { Metadata } from "next"

import { managerAccess } from "@/app/staff/manage/_shared/context"
import { NotManagerPage } from "@/app/staff/manage/_shared/frame"
import { OverviewScreen } from "@/app/staff/manage/_shared/screens"

export const metadata: Metadata = { title: "Manage · Naba-Lens" }

/** Venue manager tools for the manager's own current venue. */
export default async function ManagePage() {
  const access = await managerAccess()
  if (!access.ok) return <NotManagerPage viewerName={access.viewerName} />
  return <OverviewScreen ctx={access.ctx} />
}
