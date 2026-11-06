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

export type AddBlocked =
  | { reason: "no_venue" }
  | { reason: "venue_inactive"; venueName: string }

/**
 * What Add opens: take a photo or choose from the phone's photos. Nothing
 * uploads until a choice is made; the chosen files go to the upload dialog.
 */
export function AddSheet({
  open,
  onOpenChange,
  blocked,
  onFiles,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  blocked: AddBlocked | null
  onFiles: (files: File[]) => void
}) {
  const cameraInput = React.useRef<HTMLInputElement>(null)
  const libraryInput = React.useRef<HTMLInputElement>(null)

  function pick(input: HTMLInputElement) {
    const files = Array.from(input.files ?? [])
    // Allow picking the same file again later.
    input.value = ""
    if (files.length > 0) onFiles(files)
  }

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
                : `${blocked.venueName} isn't active in Naba-Lens at the moment. Photos you already added stay on your profile.`}
            </DialogDescription>
          </DialogHeader>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add photos</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <AddOption
                icon={<CameraIcon aria-hidden className="size-7" />}
                title="Take a photo"
                hint="Opens your phone's camera. It starts uploading straight away."
                onClick={() => cameraInput.current?.click()}
              />
              <AddOption
                icon={<ImageIcon aria-hidden className="size-7" />}
                title="Choose from your photos"
                hint="Up to 10 at a time"
                onClick={() => libraryInput.current?.click()}
              />
              <input
                ref={cameraInput}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                tabIndex={-1}
                onChange={(e) => pick(e.currentTarget)}
              />
              <input
                ref={libraryInput}
                type="file"
                accept="image/*,video/*"
                multiple
                hidden
                tabIndex={-1}
                onChange={(e) => pick(e.currentTarget)}
              />
            </div>
            <p className="flex gap-2 text-meta-touch text-ink-muted md:text-meta">
              <InfoIcon aria-hidden className="mt-0.5 size-4 flex-none" />
              Your colleagues will see them in Photos. Next, you can choose a
              task they&apos;re for.
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
      className="flex min-h-19 items-center gap-4 rounded-touch border border-line-control px-4 py-3 text-left transition-colors outline-none hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus"
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
