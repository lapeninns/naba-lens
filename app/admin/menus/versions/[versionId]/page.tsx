import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AppShell } from "@/components/nabalens"
import { requireActiveAdmin } from "@/lib/auth"
import { getMediaActor } from "@/lib/server/media/context"
import { getMenuVersion } from "@/lib/server/menus"

import { VersionEditor } from "../../version-editor"

export const metadata: Metadata = { title: "Menus · Naba-Lens" }

/** One menu version (A15): draft editor and lifecycle, or read-only. */
export default async function MenuVersionPage({
  params,
}: {
  params: Promise<{ versionId: string }>
}) {
  const profile = await requireActiveAdmin()
  const { versionId } = await params
  const auth = await getMediaActor("admin")
  if (!auth.ok) throw new Error("Not authorised.")
  const result = await getMenuVersion(auth.actor, versionId)
  if (!result.ok) {
    if (result.status === 404) notFound()
    throw new Error(result.message)
  }
  const { version, diff, active, reviewBase } = result

  return (
    <AppShell variant="admin" active="menus" userName={profile.displayName}>
      <VersionEditor
        version={version}
        diff={diff}
        active={active}
        reviewBase={reviewBase}
      />
    </AppShell>
  )
}
