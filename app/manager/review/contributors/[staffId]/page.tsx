import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import {
  ContributorBody,
  type ReviewSearch,
} from "@/app/manager/review/_shared/review-page"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { REVIEW_COPY } from "@/components/nabalens/manager/review/review-copy"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { buttonVariants } from "@/components/ui/button"
import { requireManagerVenue } from "@/lib/auth/manager"
import { getManagerPhotoCtx } from "@/lib/server/menu-photos"

import { failedRead } from "../../../load-overview"

export const metadata = { title: "Contributor · Naba-Lens" }

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
      <Link
        href={managerHrefs.review()}
        className={buttonVariants({
          variant: "link",
          className: "justify-self-start",
        })}
      >
        <ArrowLeftIcon data-icon="inline-start" aria-hidden />
        {REVIEW_COPY.backToReview}
      </Link>
      <ContributorBody
        ctx={scope.ctx}
        scope={{ kind: "manager" }}
        staffId={staffId}
        search={await searchParams}
      />
    </div>
  )
}
