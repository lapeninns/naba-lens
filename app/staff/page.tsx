import { SignOutButton } from "@/app/auth/sign-out-button"
import { requireActiveStaff, uploadBlockReason } from "@/lib/auth"

// PLACEHOLDER (foundation track): replaced by the staff portfolio in wave 2.
export default async function StaffPage() {
  const profile = await requireActiveStaff()
  const blocked = uploadBlockReason(profile)

  return (
    <main className="flex min-h-svh flex-col gap-4 p-6">
      <h1 className="font-heading text-2xl font-semibold">
        {profile.displayName}
      </h1>
      <p className="text-sm text-muted-foreground">
        {[profile.jobTitle, profile.venue?.name].filter(Boolean).join(" · ") ||
          "Staff"}
      </p>
      {blocked ? (
        <p role="status" className="text-sm">
          Your account is not assigned to an active venue yet, so uploads are
          paused. Ask an admin to assign your venue.
        </p>
      ) : null}
      <SignOutButton />
    </main>
  )
}
