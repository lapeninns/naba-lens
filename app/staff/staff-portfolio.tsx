"use client"

import * as React from "react"

import type { Department } from "@/lib/config/departments"
import {
  CaretRightIcon,
  ClipboardTextIcon,
  PencilSimpleIcon,
  SignOutIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { logout } from "@/app/_media/actions"
import { fetchMediaPage } from "@/app/_media/fetch-page"
import { MediaGallery } from "@/app/_media/media-gallery"
import { useMediaUploader } from "@/app/_media/use-media-uploader"
import { LabelEditorHost } from "@/app/_labels/label-editor-host"
import {
  EditProfileDialog,
  EmptyState,
  ProfileHeader,
  UploadDialog,
  type ActionResult,
  type ProfileFormValues,
} from "@/components/nabalens"
import { CountBadge } from "@/components/nabalens/status-chip"
import { Button } from "@/components/ui/button"
import { MEDIA_LIMITS } from "@/lib/config/media"
import type { MediaPage } from "@/lib/server/media/types"

import { loadMyMedia } from "./actions"

type StaffPortfolioProps = {
  profile: {
    displayName: string
    jobTitle: string | null
    department?: Department | null
    venueName: string | null
    avatarUrl: string | null
  }
  /** Why uploads are paused (no or inactive venue), or null. */
  uploadBlocked: string | null
  initialPage: MediaPage
  /** Set for an effective venue manager: the way into Manage on phones. */
  manage?: { venueName: string | null; reviewCount: number } | null
}

/** Abortable foreground refresh of the own portfolio (see MediaGallery). */
function refreshMyMedia(signal: AbortSignal, cursor?: string | null) {
  return fetchMediaPage("/api/portfolio", { cursor }, signal)
}

async function saveProfile(values: ProfileFormValues): Promise<ActionResult> {
  const body = new FormData()
  body.set("displayName", values.displayName)
  if (values.avatarFile) body.set("avatar", values.avatarFile)
  try {
    const response = await fetch("/api/profile", { method: "POST", body })
    const result = (await response.json()) as ActionResult
    return result
  } catch {
    return { ok: false, error: "Could not save. Check your connection." }
  }
}

/** The Manage row at the top of Me, with the photos waiting for review. */
function ManageRow({
  venueName,
  reviewCount,
}: {
  venueName: string | null
  reviewCount: number
}) {
  const hintId = React.useId()
  const title = venueName ? `Manage ${venueName}` : "Manage"
  return (
    <nav aria-label="Manage" className="grid border-y border-line">
      <Link
        href="/staff/manage"
        aria-label={
          reviewCount > 0 ? `${title}, ${reviewCount} photos to review` : title
        }
        aria-describedby={hintId}
        className="grid min-h-13 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3 text-ink outline-none hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-focus md:min-h-11"
      >
        <ClipboardTextIcon aria-hidden className="size-5 text-ink-muted" />
        <span className="grid min-w-0">
          <span className="text-body-touch font-semibold break-words md:text-body">
            {title}
          </span>
          <span
            id={hintId}
            className="text-meta-touch text-ink-muted md:text-meta"
          >
            Review, checklist, menu and team
          </span>
        </span>
        <span className="flex items-center gap-2 text-ink-muted">
          <CountBadge count={reviewCount} label="photos to review" />
          <CaretRightIcon aria-hidden className="size-5" />
        </span>
      </Link>
    </nav>
  )
}

export function StaffPortfolio({
  profile,
  uploadBlocked,
  initialPage,
  manage = null,
}: StaffPortfolioProps) {
  const router = useRouter()
  const uploader = useMediaUploader()
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [refreshSignal, setRefreshSignal] = React.useState(0)
  // Optional labelling right after an upload (v0.3); skipping changes nothing.
  const [labelIds, setLabelIds] = React.useState<string[] | null>(null)
  const refreshGallery = React.useCallback(
    () => setRefreshSignal((n) => n + 1),
    []
  )

  const uploadButton = uploadBlocked ? null : (
    <Button size="touch" onClick={() => setUploadOpen(true)}>
      <UploadSimpleIcon data-icon="inline-start" aria-hidden />
      Upload photos or videos
    </Button>
  )

  return (
    <div className="flex flex-col gap-6">
      <ProfileHeader
        displayName={profile.displayName}
        avatarUrl={profile.avatarUrl}
        jobTitle={profile.jobTitle}
        department={profile.department}
        venueName={profile.venueName}
        actions={
          <>
            {uploadButton}
            <Button
              variant="outline"
              size="touch"
              onClick={() => setEditOpen(true)}
            >
              <PencilSimpleIcon data-icon="inline-start" aria-hidden />
              Edit profile
            </Button>
            {/* From md, Log out is in the AppBar; on phones it lives on Me. */}
            <form action={logout} className="md:hidden" data-logout>
              <Button type="submit" variant="quiet" size="touch">
                <SignOutIcon data-icon="inline-start" aria-hidden />
                Log out
              </Button>
            </form>
          </>
        }
      />
      {manage ? (
        <ManageRow
          venueName={manage.venueName}
          reviewCount={manage.reviewCount}
        />
      ) : null}
      {uploadBlocked ? (
        <p
          role="status"
          className="rounded-md border bg-muted/40 px-4 py-3 text-sm"
        >
          {uploadBlocked}
        </p>
      ) : null}
      <MediaGallery
        label="Your portfolio"
        initialPage={initialPage}
        loadPage={loadMyMedia}
        refreshPage={refreshMyMedia}
        canDelete
        refreshSignal={refreshSignal}
        canLabel
        showLabelBadge
        empty={<EmptyState action={uploadButton} />}
      />
      <UploadDialog
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open)
          if (!open) refreshGallery()
        }}
        uploader={uploader}
        limits={MEDIA_LIMITS}
        onUploaded={refreshGallery}
        onLabel={(ids) => setLabelIds(ids)}
      />
      <LabelEditorHost
        assetIds={labelIds ?? []}
        open={labelIds !== null}
        onOpenChange={(open) => {
          if (!open) setLabelIds(null)
        }}
        onSaved={refreshGallery}
      />
      <EditProfileDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        variant="staff"
        initial={{
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
        }}
        maxAvatarBytes={MEDIA_LIMITS.maxAvatarBytes}
        onSubmit={async (values) => {
          const result = await saveProfile(values)
          if (result.ok) router.refresh()
          return result
        }}
      />
    </div>
  )
}
