import type { Metadata } from "next"

import { managerAccess } from "@/app/staff/manage/_shared/context"
import { NotManagerPage } from "@/app/staff/manage/_shared/frame"
import {
  ReviewScreen,
  type ManageSearch,
} from "@/app/staff/manage/_shared/screens"

export const metadata: Metadata = { title: "Review · Manage · Naba-Lens" }

export default async function ManageReviewPage({
  searchParams,
}: {
  searchParams: Promise<ManageSearch>
}) {
  const access = await managerAccess()
  if (!access.ok) return <NotManagerPage viewerName={access.viewerName} />
  return <ReviewScreen ctx={access.ctx} search={await searchParams} />
}
