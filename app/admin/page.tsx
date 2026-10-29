import { SignOutButton } from "@/app/auth/sign-out-button"
import { requireActiveAdmin } from "@/lib/auth"

// PLACEHOLDER (foundation track): replaced by the admin library in wave 2.
export default async function AdminPage() {
  const profile = await requireActiveAdmin()

  return (
    <main className="flex min-h-svh flex-col gap-4 p-6">
      <h1 className="font-heading text-2xl font-semibold">Content</h1>
      <p className="text-sm text-muted-foreground">
        Signed in as {profile.displayName}.
      </p>
      <SignOutButton />
    </main>
  )
}
