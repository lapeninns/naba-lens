"use client"

import { useRouter } from "next/navigation"

import {
  loadSubmittablePhotosAction,
  submitPhotosAction,
} from "@/app/_coverage/actions"
import { useMediaUploader } from "@/app/_media/use-media-uploader"
import { useAddRefreshSignal } from "@/components/nabalens/shell/add-context"
import {
  SubmitPhotosPanel,
  type SubmittablePhotosResult,
} from "@/components/nabalens/tasks"
import { ROUTES } from "@/lib/auth/routes"
import { MEDIA_LIMITS } from "@/lib/config/media"

/**
 * Wires the send panel to the real upload pipeline and coverage actions. A
 * successful send revalidates /staff in the action itself, so only conflicts
 * need an explicit refresh.
 */
export function TaskSubmit({
  requirementId,
  taskTitle,
  venueName,
  replacesSubmissionId,
  reviewerName,
  initialPhotos,
}: {
  requirementId: string | null
  taskTitle?: string | null
  venueName?: string | null
  replacesSubmissionId: string | null
  reviewerName?: string | null
  initialPhotos: SubmittablePhotosResult
}) {
  const router = useRouter()
  const uploader = useMediaUploader()
  const refreshSignal = useAddRefreshSignal()
  return (
    <SubmitPhotosPanel
      requirementId={requirementId}
      taskTitle={taskTitle}
      venueName={venueName}
      replacesSubmissionId={replacesSubmissionId}
      reviewerName={reviewerName}
      initialPhotos={initialPhotos}
      refreshSignal={refreshSignal}
      loadPhotos={loadSubmittablePhotosAction}
      submit={submitPhotosAction}
      uploader={uploader}
      limits={MEDIA_LIMITS}
      onReload={() => router.refresh()}
      signInHref={ROUTES.login}
    />
  )
}
