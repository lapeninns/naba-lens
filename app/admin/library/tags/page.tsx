import type { Metadata } from "next"
import Link from "next/link"

import { AppShell } from "@/components/nabalens/app-shell"
import { Notice } from "@/components/nabalens/notice"
import { PageHeader } from "@/components/nabalens/page-header"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveAdmin } from "@/lib/auth"
import { listTags } from "@/lib/server/library/service"
import { getMediaActor } from "@/lib/server/media/context"

import { TagsView } from "../_components/collections"

export const metadata: Metadata = { title: "Tags · Library" }

/**
 * The controlled tags (spec §8 A4; S2-LIBRARY): the only words that can be
 * added to a photo as a tag. Admins add, rename, retire and restore them.
 */
export default async function LibraryTagsPage() {
  const profile = await requireActiveAdmin()
  const auth = await getMediaActor("admin")
  if (!auth.ok) throw new Error("Not authorised.")
  const read = await listTags(auth.actor)

  return (
    <AppShell variant="admin" active="content" userName={profile.displayName}>
      <div className="flex flex-col gap-6">
        <PageHeader
          scope="All venues"
          title="Tags"
          summary={
            <p>
              A fixed list of words for finding photos later. Only these can be
              added to a photo.
            </p>
          }
          actions={
            <Link
              href="/admin/library/collections"
              className={buttonVariants({ variant: "secondary" })}
            >
              Collections
            </Link>
          }
          className="pb-0 md:pb-0"
        />
        {read.ok ? (
          <TagsView tags={read.value} />
        ) : (
          <Notice tone="negative" role="alert">
            {read.message}
          </Notice>
        )}
      </div>
    </AppShell>
  )
}
