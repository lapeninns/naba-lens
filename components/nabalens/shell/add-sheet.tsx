"use client"

import * as React from "react"
import { CameraIcon, ImageIcon, InfoIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { CAMERA_LABEL, LIBRARY_LABEL, usePhotoSource } from "../photo-source"
import { EntryContext } from "./entry-flow"

export type AddBlocked =
  | { reason: "no_venue" }
  | { reason: "venue_inactive"; venueName: string }
  /** The server refused to finish an upload: a manager's access ended. */
  | { reason: "access_ended"; venueName: string }

/** Once the server refused to finish an upload for a manager account. */
export const ACCESS_ENDED =
  "Your venue manager access has ended, so you can't add photos or videos here."

/**
 * What Add opens on phones: choose from the phone's photos (first, several at
 * a time) or take a photo. The chosen files start uploading at once, in the
 * "Saving N photos" sheet.
 */
export function AddSheet({
  open,
  onOpenChange,
  blocked,
  onFiles,
  maxFiles,
  imagesOnly = false,
  context = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  blocked: AddBlocked | null
  onFiles: (files: File[]) => void
  /** MEDIA_LIMITS.maxBatchFiles. */
  maxFiles: number
  /** Photos only (task screens): the pickers offer no videos. */
  imagesOnly?: boolean
  /** With the shared entry on: the venue and who sees the photos (§4.2). */
  context?: { venueName: string; audience: string } | null
}) {
  // The inputs live inside the sheet, so the click that opens a picker is on
  // the open dialog's own content.
  const picker = usePhotoSource({ imagesOnly, onFiles })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {blocked ? (
          <DialogHeader>
            <DialogTitle>
              {blocked.reason === "no_venue"
                ? "You can't add photos yet"
                : `You can't add photos at ${blocked.venueName}`}
            </DialogTitle>
            <DialogDescription>
              {blocked.reason === "no_venue"
                ? "An admin needs to assign your venue first. Ask your manager or an admin."
                : blocked.reason === "access_ended"
                  ? ACCESS_ENDED
                  : `${blocked.venueName} isn't active in Naba-Lens at the moment. Photos you already added stay on your profile.`}
            </DialogDescription>
          </DialogHeader>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add photos</DialogTitle>
            </DialogHeader>
            {context ? (
              <EntryContext
                venueName={context.venueName}
                audience={context.audience}
              />
            ) : null}
            <div className="grid gap-3">
              <AddOption
                icon={<ImageIcon aria-hidden className="size-7" />}
                title={LIBRARY_LABEL}
                hint={`Up to ${maxFiles} at a time`}
                onClick={() => picker.open("library")}
              />
              <AddOption
                icon={<CameraIcon aria-hidden className="size-7" />}
                title={CAMERA_LABEL}
                hint="Opens your phone's camera for one photo."
                onClick={() => picker.open("camera")}
              />
              {picker.inputs}
            </div>
            <p className="flex gap-2 text-meta-touch text-ink-muted md:text-meta">
              <InfoIcon aria-hidden className="mt-0.5 size-4 flex-none" />
              Photos start saving as soon as you pick them.
            </p>
          </>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" size="touch" />}>
            {blocked ? "Close" : "Cancel"}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddOption({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-19 items-center gap-4 rounded-touch border border-line-control px-4 py-3 text-left transition-colors outline-none hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
    >
      <span className="grid size-13 flex-none place-items-center rounded-round bg-accent-soft text-accent-text">
        {icon}
      </span>
      <span className="grid gap-0.5">
        <span className="text-item-title-touch text-ink">{title}</span>
        <span className="text-meta-touch text-ink-muted">{hint}</span>
      </span>
    </button>
  )
}
