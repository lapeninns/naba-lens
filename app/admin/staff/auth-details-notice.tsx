import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

/**
 * Shown when Supabase Auth was too slow or failed while the page rendered
 * (lib/server/accounts: authDetails "unavailable"). Names, venues and
 * deactivation still come from the database and are exact.
 */
export function AuthDetailsNotice() {
  return (
    <Alert
      variant="warning"
      role="status"
      data-testid="auth-details-unavailable"
    >
      <AlertTitle>Sign-in details are unavailable right now</AlertTitle>
      <AlertDescription>
        The sign-in service did not respond in time, so email addresses are
        hidden and people who have not accepted their invitation yet may show as
        Active. Names, venues and deactivated accounts are up to date. Reload
        the page to try again.
      </AlertDescription>
    </Alert>
  )
}
