import type { Metadata } from "next"

import { managerAccess } from "@/app/staff/manage/_shared/context"
import { NotManagerPage } from "@/app/staff/manage/_shared/frame"
import { RequirementScreen } from "@/app/staff/manage/_shared/screens"

export const metadata: Metadata = {
  title: "Checklist item · Manage · Naba-Lens",
}

export default async function ManageRequirementPage({
  params,
}: {
  params: Promise<{ requirementId: string }>
}) {
  const { requirementId } = await params
  const access = await managerAccess()
  if (!access.ok) return <NotManagerPage viewerName={access.viewerName} />
  return <RequirementScreen ctx={access.ctx} requirementId={requirementId} />
}
