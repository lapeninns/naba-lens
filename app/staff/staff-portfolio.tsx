"use client"

import * as React from "react"
import { PencilSimpleIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"

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
import { Button } from "@/components/ui/button"
import { MEDIA_LIMITS } from "@/lib/config/media"
import type { MediaPage } from "@/lib/server/media/types"

import { loadMyMedia } from "./actions"

type StaffPortfolioProps = {
  profile: {
    displayName: string
    jobTitle: string | null
    venueName: string | null
    avatarUrl: string | null
  }
  /** Why uploads are paused (no or inactive venue), or null. */
  uploadBlocked: string | null
  initialPage: MediaPage
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

export function StaffPortfolio({
  profile,
  uploadBlocked,
  initialPage,
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
          </>
        }
      />
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
