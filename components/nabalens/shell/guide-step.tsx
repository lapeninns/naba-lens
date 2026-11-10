"use client"

import * as React from "react"
import { CameraIcon, ImageIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { GUIDE_RULES, GUIDE_SAFETY } from "@/lib/guide/dish-guide"

import {
  CAMERA_LABEL,
  LIBRARY_LABEL,
  usePhotoSource,
  type PhotoSource,
} from "../photo-source"
import { ENTRY_COPY } from "./entry-copy"

/**
 * "What a useful photo shows" before the picker for a dish or drink (B02-05,
 * D8). Only the dish guide's existing words: no subject has its own yet.
 * The picker the person chose is the primary action, so the step costs one
 * tap. The inputs live inside the dialog, so the tap that opens the picker
 * is on the open dialog's own content.
 */
export function GuideStep({
  open,
  onOpenChange,
  source,
  imagesOnly,
  onFiles,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: PhotoSource
  imagesOnly: boolean
  onFiles: (files: File[]) => void
}) {
  const picker = usePhotoSource({ imagesOnly, onFiles })
  const SourceIcon = source === "camera" ? CameraIcon : ImageIcon
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ENTRY_COPY.guideTitle}</DialogTitle>
        </DialogHeader>
        <ul className="grid list-disc gap-1.5 ps-5 text-body text-ink">
          {GUIDE_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <p className="text-meta-touch text-ink-muted md:text-meta">
          {GUIDE_SAFETY}
        </p>
        {picker.inputs}
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" size="touch" />}>
            {ENTRY_COPY.cancel}
          </DialogClose>
          <Button
            size="touch"
            onClick={() => picker.open(source, { imagesOnly })}
          >
            <SourceIcon data-icon="inline-start" aria-hidden />
            {source === "camera" ? CAMERA_LABEL : LIBRARY_LABEL}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
