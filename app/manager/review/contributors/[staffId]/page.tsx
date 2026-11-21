import {
  ContributorBody,
  type ReviewSearch,
} from "@/app/manager/review/_shared/review-page"
import { BackLink } from "@/components/nabalens/back-link"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { requireManagerVenue } from "@/lib/auth/manager"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"

import { failedRead } from "../../../load-overview"

export const metadata = { title: "Contributor" }

/** One contributor's photos at the manager's venue, with their status and tallies. */
export default async function ManagerContributorPage({
  params,
  searchParams,
}: {
  params: Promise<{ staffId: string }>
  searchParams: Promise<ReviewSearch>
}) {
  await requireManagerVenue()
  const { staffId } = await params
  const scope = await getManagerPhotoCtx()
  if (!scope.ok)
    failedRead(scope.code, "a contributor", managerHrefs.contributor(staffId))
  return (
    <div className="grid gap-6">
      <OfflineNotice
        className={OFFLINE_BANNER_CLASS}
        loadedAt={new Date().toISOString()}
      />
      <BackLink href={managerHrefs.review()} compact className="-mb-4">
        {REVIEW_COPY.backToReview}
      </BackLink>
      <ContributorBody
        ctx={scope.ctx}
        scope={{ kind: "manager" }}
        staffId={staffId}
        search={await searchParams}
      />
    </div>
  )
}
