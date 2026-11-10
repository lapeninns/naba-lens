"use client"

import { usePathname, useRouter } from "next/navigation"

import {
  listSubmittableAssetsAction,
  submitFindingAction,
} from "@/app/_amenities/actions"
import { useMediaUploader } from "@/app/_media/use-media-uploader"
import {
  discardKnowledgeDraftAction,
  listKnowledgeAssetsAction,
  previewScheduleAction,
  saveKnowledgeDraftAction,
  submitKnowledgeFindingAction,
} from "@/app/_knowledge/actions"
import {
  CaptureForm,
  type AssetsResult,
  type KnowledgeCapture,
} from "@/components/nabalens/amenities/capture"
import { findingSentHref } from "@/components/nabalens/amenities/capture/finding-sent"
import {
  useAddQueue,
  useAddRefreshSignal,
} from "@/components/nabalens/shell/add-context"
import { loginHref } from "@/lib/auth/routes"
import {
  knowledgeAssetsResult,
  type CaptureCheck,
} from "@/lib/knowledge-client/contract"
import { MEDIA_LIMITS } from "@/lib/config/media"

/** What the server read about a working-list question (no functions). */
export type KnowledgeProps = Omit<
  KnowledgeCapture,
  "submit" | "saveDraft" | "onDiscardDraft"
> & { canContribute: boolean }

/** The capture form's asset list for staff on a working-list question. */
async function loadKnowledgeAssets(input: {
  checkId: string
}): Promise<AssetsResult> {
  return knowledgeAssetsResult(await listKnowledgeAssetsAction(input))
}

/**
 * Wires the capture form to the amenity actions and the existing upload flow:
 * the staff layout's one Add queue where there is one, the form's own upload
 * dialog otherwise. Admins and manager accounts can't upload, so they get no
 * upload flow.
 */
export function CaptureClient({
  check,
  viewerId,
  initialAssets,
  canUpload,
  canAttachLegacy,
  doneHref,
  announceSent = true,
  uploadRefused = false,
  knowledge = null,
}: {
  check: CaptureCheck
  /** The signed-in person; their drafts are kept apart on a shared device. */
  viewerId: string
  initialAssets: AssetsResult
  canUpload: boolean
  canAttachLegacy: boolean
  /** Home for staff, the check page for managers and admins. */
  doneHref: string
  /**
   * Add the sent check to `doneHref`: Home and the check pages name it in a
   * focused notice (CA-15). Off when staff go back to another origin.
   */
  announceSent?: boolean
  /** A manager account that can't upload: Yes says why before it is chosen. */
  uploadRefused?: boolean
  /** Set for a working-list question: send through the knowledge path. */
  knowledge?: KnowledgeProps | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const uploader = useMediaUploader()
  const addQueue = useAddQueue()
  const refreshSignal = useAddRefreshSignal()
  return (
    <CaptureForm
      check={check}
      viewerId={viewerId}
      initialAssets={initialAssets}
      loadAssets={
        // Staff on a working-list question list their own media, which needs
        // no assignment (F1); everyone else keeps the amenity list.
        knowledge?.role === "staff"
          ? loadKnowledgeAssets
          : listSubmittableAssetsAction
      }
      submit={submitFindingAction}
      upload={canUpload ? { addQueue, uploader, limits: MEDIA_LIMITS } : null}
      canAttachLegacy={canAttachLegacy}
      refreshSignal={refreshSignal}
      onReload={() => router.refresh()}
      onDone={() =>
        router.push(
          announceSent ? findingSentHref(doneHref, check.id) : doneHref
        )
      }
      uploadRefused={uploadRefused}
      signInHref={loginHref(pathname)}
      pageHref={pathname}
      knowledge={
        knowledge
          ? {
              ...knowledge,
              submit: submitKnowledgeFindingAction,
              loadNextDates: previewScheduleAction,
              // Drafts are the author's own: staff only.
              saveDraft:
                knowledge.role === "staff" ? saveKnowledgeDraftAction : null,
              onDiscardDraft:
                knowledge.role === "staff"
                  ? () => discardKnowledgeDraftAction({ checkId: check.id })
                  : null,
            }
          : null
      }
    />
  )
}
