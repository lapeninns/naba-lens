"use client"

import * as React from "react"

import { finaliseUpload, reserveUpload } from "@/app/staff/actions"
import type { Uploader } from "@/components/nabalens"
import { MEDIA_LIMITS } from "@/lib/config/media"
import { createClient } from "@/lib/supabase/browser"
import { getSupabasePublicEnv } from "@/lib/supabase/env"
import {
  createUploader,
  guardBeforeUnload,
  localUploadKeyStore,
  ReservationGoneError,
  toQueueUploader,
} from "@/lib/upload"

/**
 * The real transport for UploadDialog: reserve (Server Function) -> signed PUT or
 * TUS straight to the private `media` bucket -> finalise (Server Function).
 * Server errors arrive as values and are re-thrown here so the dialog shows them.
 * Unfinished uploads' keys are kept in localStorage per file and signed-in
 * account, so choosing the same file after a reload reuses the same asset and
 * resumes a TUS transfer, and nobody else signed in on the device reuses it.
 */
export function useMediaUploader(): Uploader {
  const supabase = React.useMemo(() => createClient(), [])
  const upload = React.useMemo(() => {
    const { url, publishableKey } = getSupabasePublicEnv()
    return createUploader({
      reserve: async (input) => {
        const result = await reserveUpload(input)
        if (!result.ok) {
          // 404: the reservation for this key was removed or cleaned up.
          throw result.status === 404
            ? new ReservationGoneError(result.message)
            : new Error(result.message)
        }
        return result.reservation
      },
      finalise: async (input) => {
        const result = await finaliseUpload(input)
        if (!result.ok) throw new Error(result.message)
        return result.result
      },
      supabaseUrl: url,
      apiKey: publishableKey,
      getAccessToken: async () =>
        (await supabase.auth.getSession()).data.session?.access_token ?? null,
      limits: MEDIA_LIMITS,
    })
  }, [supabase])

  React.useEffect(
    () => guardBeforeUnload(() => upload.activeCount() > 0),
    [upload]
  )

  // Choosing the same file again after a reload resumes its reservation, for
  // the account that reserved it only (audit finding 15): callers that do not
  // pass `account` (task and amenity screens) get the signed-in user's.
  return React.useMemo(
    () =>
      toQueueUploader(upload, {
        keys: localUploadKeyStore(),
        account: async () =>
          (await supabase.auth.getSession()).data.session?.user.id ?? null,
      }),
    [upload, supabase]
  )
}
