import { Notice } from "@/components/nabalens/notice"

import { RetryButton } from "./retry-button"

/**
 * Shown when Supabase Auth was too slow or failed while the page rendered
 * (lib/server/accounts: authDetails "unavailable"). Names, venues and
 * deactivation still come from the database and are exact.
 */
export function AuthDetailsNotice() {
  return (
    <Notice
      tone="attention"
      data-testid="auth-details-unavailable"
      title="Sign-in details are unavailable right now"
      action={<RetryButton label="Reload" />}
    >
      The sign-in service didn&apos;t respond in time, so email addresses are
      hidden and people who haven&apos;t accepted their invitation yet may show
      as Active. Names, venues and deactivated accounts are up to date. Reload
      the page to try again.
    </Notice>
  )
}
