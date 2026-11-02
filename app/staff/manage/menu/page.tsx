import type { Metadata } from "next"

import { managerAccess } from "@/app/staff/manage/_shared/context"
import { NotManagerPage } from "@/app/staff/manage/_shared/frame"
import { MenuScreen } from "@/app/staff/manage/_shared/screens"

export const metadata: Metadata = {
  title: "Menu coverage · Manage · Naba-Lens",
}

export default async function ManageMenuPage() {
  const access = await managerAccess()
  if (!access.ok) return <NotManagerPage viewerName={access.viewerName} />
  return <MenuScreen ctx={access.ctx} />
}
