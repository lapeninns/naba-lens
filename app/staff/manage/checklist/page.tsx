import type { Metadata } from "next"

import { managerAccess } from "@/app/staff/manage/_shared/context"
import { NotManagerPage } from "@/app/staff/manage/_shared/frame"
import { ChecklistScreen } from "@/app/staff/manage/_shared/screens"

export const metadata: Metadata = { title: "Checklist · Manage · Naba-Lens" }

export default async function ManageChecklistPage() {
  const access = await managerAccess()
  if (!access.ok) return <NotManagerPage viewerName={access.viewerName} />
  return <ChecklistScreen ctx={access.ctx} />
}
