import { SignOutIcon } from "@phosphor-icons/react/dist/ssr"

import { Button } from "@/components/ui/button"

/** Plain form POST so sign-out works without client JavaScript. */
export function SignOutButton({
  className,
  variant = "primary",
}: {
  className?: string
  /** Secondary where the screen's one blue is another action (/auth/mfa). */
  variant?: "primary" | "secondary"
}) {
  return (
    <form action="/auth/logout" method="post" className={className}>
      {/* The only way on from Account unavailable: the screen's one blue. */}
      <Button type="submit" variant={variant}>
        <SignOutIcon data-icon="inline-start" aria-hidden />
        Sign out
      </Button>
    </form>
  )
}
