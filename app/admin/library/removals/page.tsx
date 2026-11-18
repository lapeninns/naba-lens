import type { Metadata } from "next"
import Link from "next/link"

import { AppShell } from "@/components/nabalens/app-shell"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveAdmin } from "@/lib/auth"
import { listMediaRemovalRequests } from "@/lib/server/lifecycle/removal"
import { getMediaActor } from "@/lib/server/media/context"

import { RemovalRequestList } from "../_components/removal"

export const metadata: Metadata = { title: "Removal requests · Library" }

/**
 * Open requests to remove an accepted photo (FA-21, spec §16; S2-LIBRARY),
 * from its uploader or the venue's manager. An admin keeps the photo with a
 * reason or reviews the removal's impact. Oldest first.
 */
export default async function LibraryRemovalsPage() {
  const profile = await requireActiveAdmin()
  const auth = await getMediaActor("admin")
  if (!auth.ok) throw new Error("Not authorised.")
  const read = await listMediaRemovalRequests(auth.actor, { state: "open" })

  return (
    <AppShell variant="admin" active="content" userName={profile.displayName}>
      <div className="flex flex-col gap-6">
        <PageHeader
          scope="All venues"
          title="Removal requests"
          summary={
            <p>
              Accepted photos are kept until an admin removes one with a reason.
            </p>
          }
          actions={
            <Link
              href="/admin"
              className={buttonVariants({ variant: "secondary" })}
            >
              Back to the library
            </Link>
          }
          className="pb-0 md:pb-0"
        />
        {read.ok ? (
          <RemovalRequestList requests={read.requests} />
        ) : (
          <Notice tone="negative" role="alert">
            {read.message}
          </Notice>
        )}
      </div>
    </AppShell>
  )
}
