import { ManagerAccountForm } from "@/components/nabalens/manager/account-form"
import { MANAGER_COPY } from "@/components/nabalens/manager/copy"
import {
  OfflineNotice,
  OFFLINE_BANNER_CLASS,
} from "@/components/nabalens/offline-notice"
import { BackLink } from "@/components/nabalens/back-link"
import { managerHrefs } from "@/components/nabalens/manager/hrefs"
import { PageHeader } from "@/components/nabalens/page-header"
import { LinkButton } from "@/components/ui/link-button"
import { requireManagerVenue } from "@/lib/auth/manager"
import { readVerifiedFactors } from "@/lib/auth/mfa"
import { createClient } from "@/lib/supabase/server"

import { updateManagerDisplayNameAction } from "./actions"

export const metadata = { title: "Account" }

export default async function ManagerAccountPage() {
  const { profile, venue } = await requireManagerVenue()
  const copy = MANAGER_COPY.accountPage
  // FA-23: optional for managers. A failed read just hides the section.
  const factors = await readVerifiedFactors(await createClient()).catch(
    () => null
  )
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
      />
      {factors === null ? null : (
        <section
          aria-labelledby="two-step-title"
          className="grid gap-3 rounded-card bg-surface p-4 shadow-card md:p-6"
        >
          <h2 id="two-step-title" className="text-heading text-ink">
            Two-step sign-in
          </h2>
          <p className="text-body text-ink-muted">
            {factors > 0
              ? "On. You enter a code from your authenticator app each time you sign in."
              : "Off. Turn it on to enter a code from an authenticator app each time you sign in."}
          </p>
          {factors > 0 ? null : (
            <LinkButton href="/auth/mfa?setup=1" className="justify-self-start">
              Turn on two-step sign-in
            </LinkButton>
          )}
        </section>
      )}
    </div>
  )
}
