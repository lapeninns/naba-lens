import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"

import { logout } from "@/app/_media/actions"
import {
  AppShell,
  MenuVersionStatusBadge,
  ProvenanceCard,
} from "@/components/nabalens"
import { buttonVariants } from "@/components/ui/button"
import { requireActiveAdmin } from "@/lib/auth"
import { getMediaActor } from "@/lib/server/media/context"
import { getMenuVersion } from "@/lib/server/menus"

import { VersionEditor } from "../../version-editor"

export const metadata: Metadata = { title: "Menus · Naba-Lens" }

/** One menu version: provenance, diff vs active, editor and lifecycle. */
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
    <AppShell
      variant="admin"
      active="menus"
      userName={profile.displayName}
      logoutAction={logout}
    >
      <div className="grid gap-6">
        <div className="grid gap-2">
          <Link
            href={`/admin/menus/${encodeURIComponent(version.venueId)}`}
            className={buttonVariants({
              variant: "ghost",
              className: "h-11 w-fit sm:h-9",
            })}
          >
            <ArrowLeftIcon data-icon="inline-start" aria-hidden />
            {version.venueName}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-xl font-semibold break-words">
              {version.title}
            </h1>
            <MenuVersionStatusBadge status={version.status} />
          </div>
        </div>
        <ProvenanceCard
          version={version}
          className="[&_dd]:[overflow-wrap:anywhere]"
        />
        <VersionEditor
          version={version}
          diff={diff}
          active={active}
          reviewBase={reviewBase}
        />
      </div>
    </AppShell>
  )
}
