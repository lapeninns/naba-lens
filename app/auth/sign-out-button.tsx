import { Button } from "@/components/ui/button"

/** Plain form POST so sign-out works without client JavaScript. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action="/auth/logout" method="post" className={className}>
      <Button type="submit" variant="outline">
        Sign out
      </Button>
    </form>
  )
}
