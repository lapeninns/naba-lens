"use client"

import { UPLOAD_KEY_MAX_AGE_MS } from "@/lib/upload/upload-keys"

import { useAddContext } from "./shell/add-context"

export const STOPPED_WORD = "Stopped"
export const OPEN_ADD = "Open Add"

/**
 * What an upload that stopped says: it never finishes on its own, and
 * choosing the same file again from Add does. The new upload continues where
 * it stopped only while this device can still have its resume key (kept 20 h
 * from its last attempt, which is never before the upload began); with no
 * upload time, or an older one, that promise is left out.
 */
export function stoppedText(
  mediaType: "image" | "video",
  createdAt: string | null,
  now: number = Date.now()
): string {
  const noun = mediaType === "video" ? "video" : "photo"
  const began = createdAt ? Date.parse(createdAt) : Number.NaN
  const resumes =
    !Number.isNaN(began) && now - began < UPLOAD_KEY_MAX_AGE_MS
      ? "; it continues where it stopped"
      : ""
  return `${STOPPED_WORD}. Choose the same ${noun} again from Add to finish it${resumes}.`
}

/**
 * Whether one of the person's own uploads has stopped: the server still has
 * it uploading, but this device's Add queue no longer holds it (the tab was
 * reloaded or closed, or the person left anyway), so nothing is sending it.
 * Null outside the staff layout, where that can't be told.
 */
export function useUploadStopped():
  | ((item: {
      id: string
      uploadState: string
      contributorId?: string
    }) => boolean)
  | null {
  const holds = useAddContext()?.holds
  if (!holds) return null
  return (item) =>
    item.uploadState === "uploading" &&
    !holds.assetIds.has(item.id) &&
    (item.contributorId === undefined ||
      holds.account === null ||
      item.contributorId === holds.account)
}
