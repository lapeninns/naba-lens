import { Row, RowList } from "@/components/nabalens/common-room/row"
import { ManagerAccountForm } from "@/components/nabalens/manager/account-form"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { BackLink } from "@/components/nabalens/back-link"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireManagerVenue } from "@/lib/auth/manager"
import { readVerifiedFactors } from "@/lib/auth/mfa"
import { createClient } from "@/lib/supabase/server"

import { managerNeedsLabels, managerUploadsOn } from "../entry"
import { updateManagerDisplayNameAction } from "./actions"

export const metadata = { title: "Account" }

export default async function ManagerAccountPage() {
  const { profile, venue } = await requireManagerVenue()
  const copy = MANAGER_COPY.accountPage
  // FA-23: optional for managers. A failed read just hides the section.
  const [factors, uploadsOn, needsLabels] = await Promise.all([
    readVerifiedFactors(await createClient()).catch(() => null),
    // Your photos, which had no way in but a row on Overview (second
    // handoff): only while this account can add photos.
    managerUploadsOn(venue.id).catch(() => false),
    managerNeedsLabels(venue.id),
  ])
  const rows = [
    uploadsOn ? (
      <Row
        key="photos"
        href={managerHrefs.uploads}
        title={MANAGER_COPY.uploads.title}
        subtitle={copy.photosLine(needsLabels)}
      />
    ) : null,
    factors === null ? null : (
      <Row
        key="two-step"
        href={factors > 0 ? undefined : "/auth/mfa?setup=1"}
        title={copy.twoStep}
        subtitle={factors > 0 ? copy.twoStepOn : copy.twoStepOff}
        aria-label={
          factors > 0 ? undefined : `${copy.twoStep}: ${copy.twoStepTurnOn}`
        }
      />
    ),
  ].filter(Boolean)
  return (
    <div className="grid gap-gutter">
      <OfflineNotice
        className={OFFLINE_BANNER_CLASS}
        loadedAt={new Date().toISOString()}
      />
      <div className="grid gap-1">
        <BackLink href={managerHrefs.overview} compact>
          {MANAGER_COPY.overview.title}
        </BackLink>
        <PageHeader
          title={copy.title}
          summary={copy.summary}
          className="pb-0 md:pb-0"
        />
      </div>
      <ManagerAccountForm
        displayName={profile.displayName}
        email={profile.email}
        venueName={venue.name}
        onSave={updateManagerDisplayNameAction}
        aside={rows.length > 0 ? <RowList>{rows}</RowList> : null}
      />
    </div>
  )
}
