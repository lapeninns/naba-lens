import { ManagerAccountForm } from "@/components/nabalens/manager/account-form"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import { PageHeader } from "@/components/nabalens/page-header"
import { requireManagerVenue } from "@/lib/auth/manager"

import { updateManagerDisplayNameAction } from "./actions"

export const metadata = { title: "Account · Naba-Lens" }

export default async function ManagerAccountPage() {
  const { profile, venue } = await requireManagerVenue()
  const copy = MANAGER_COPY.accountPage
  return (
    <div className="grid gap-6">
      <PageHeader
        title={copy.title}
        summary={copy.summary}
        className="pb-0 md:pb-0"
      />
      <ManagerAccountForm
        displayName={profile.displayName}
        email={profile.email}
        venueName={venue.name}
        onSave={updateManagerDisplayNameAction}
      />
    </div>
  )
}
