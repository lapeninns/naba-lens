"use client"

import { usePathname, useRouter } from "next/navigation"

import {
  listSubmittableAssetsAction,
  submitFindingAction,
} from "@/app/_amenities/actions"
import { useMediaUploader } from "@/app/_media/use-media-uploader"
import {
  CaptureForm,
  type AssetsResult,
} from "@/components/nabalens/amenities/capture"
import {
  findingSentHref,
  STAFF_HOME_PATH,
} from "@/components/nabalens/amenities/capture/finding-sent"
import {
  useAddQueue,
  useAddRefreshSignal,
} from "@/components/nabalens/shell/add-context"
import type { CheckSummary } from "@/lib/amenities/contract"
import { loginHref } from "@/lib/auth/routes"
import { MEDIA_LIMITS } from "@/lib/config/media"

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
}: {
  check: CheckSummary
  /** The signed-in person; their drafts are kept apart on a shared device. */
  viewerId: string
  initialAssets: AssetsResult
  canUpload: boolean
  canAttachLegacy: boolean
  /** Home for staff, the check page for managers and admins. */
  doneHref: string
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
      loadAssets={listSubmittableAssetsAction}
      submit={submitFindingAction}
      upload={canUpload ? { addQueue, uploader, limits: MEDIA_LIMITS } : null}
      canAttachLegacy={canAttachLegacy}
      refreshSignal={refreshSignal}
      onReload={() => router.refresh()}
      onDone={() =>
        router.push(
          // Home says which check was sent; check pages show it themselves.
          doneHref === STAFF_HOME_PATH
            ? findingSentHref(doneHref, check.id)
            : doneHref
        )
      }
      signInHref={loginHref(pathname)}
    />
  )
}
