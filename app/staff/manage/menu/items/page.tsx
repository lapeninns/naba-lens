import type { Metadata } from "next"

import { managerAccess } from "@/app/staff/manage/_shared/context"
import { NotManagerPage } from "@/app/staff/manage/_shared/frame"
import type { ManageSearch } from "@/app/staff/manage/_shared/screens"
import { MenuItemsScreen } from "@/app/staff/manage/_shared/screens/menu-items"

export const metadata: Metadata = {
  title: "Our menu · Manage · Naba-Lens",
}

export default async function ManageMenuItemsPage({
  searchParams,
}: {
  searchParams: Promise<ManageSearch>
}) {
  const access = await managerAccess()
  if (!access.ok) return <NotManagerPage viewerName={access.viewerName} />
  return <MenuItemsScreen ctx={access.ctx} search={await searchParams} />
}
