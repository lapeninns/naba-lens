import { SignInPage } from "@/app/login/sign-in-frame"
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton"

/**
 * /login while the session is read (DESIGN.md §16 Loading): the name is real,
 * then surface-2 blocks in the shape of the heading, the line under it, the
 * Email field, the shared-device row and the button.
 */
export default function LoginLoading() {
  return (
    <SignInPage>
      <SkeletonRegion label="Loading sign-in…" className="grid gap-5">
        <div className="grid gap-2">
          <Skeleton shape="title" className="h-10 w-32" />
          <Skeleton shape="line" className="w-full max-w-80" />
        </div>
        <div className="grid gap-1.5">
          <Skeleton shape="line" className="w-14" />
          <Skeleton className="h-12 w-full" />
        </div>
        <Skeleton className="h-16 w-full rounded-card" />
        <Skeleton shape="button" />
      </SkeletonRegion>
    </SignInPage>
  )
}
