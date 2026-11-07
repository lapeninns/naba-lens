import { SignOutIcon } from "@phosphor-icons/react/dist/ssr"

import { Button } from "@/components/ui/button"

/** Plain form POST so sign-out works without client JavaScript. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action="/auth/logout" method="post" className={className}>
      {/* The only way on from Account unavailable: the screen's one blue. */}
      <Button type="submit" variant="primary" size="touch">
        <SignOutIcon data-icon="inline-start" aria-hidden />
        Sign out
      </Button>
    </form>
  )
}
