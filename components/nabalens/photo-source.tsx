"use client"

import * as React from "react"
import { CameraIcon, ImageIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { ACCEPT_ATTRIBUTE, IMAGE_ACCEPT_ATTRIBUTE } from "./upload-queue"

// One picker contract for every way into an upload: Add, welcome, Me and task
// screens. The phone's photo library comes first (several at a time); the
// camera is the second choice (one photo). Nothing uploads on pick: the files
// go to the upload queue, which waits for "Upload N files".

/** The primary picker: the device's photo library, several files at once. */
export const LIBRARY_LABEL = "Choose from your photos"
/** The secondary picker: the device camera, one photo. */
export const CAMERA_LABEL = "Take a photo"

export type PhotoSource = "library" | "camera"

export type PhotoInputProps = {
  type: "file"
  accept: string
  multiple?: true
  capture?: "environment"
}

/**
 * Attributes of a hidden file input for `source`. The library input has no
 * `capture`, so iOS and Android offer the photo library (and the camera as a
 * choice); the camera input opens the camera straight away.
 */
export function photoInputProps(
  source: PhotoSource,
  { imagesOnly = false }: { imagesOnly?: boolean } = {}
): PhotoInputProps {
  if (source === "library") {
    return {
      type: "file",
      accept: imagesOnly ? IMAGE_ACCEPT_ATTRIBUTE : ACCEPT_ATTRIBUTE,
      multiple: true,
    }
  }
  return {
    type: "file",
    accept: imagesOnly ? "image/*" : "image/*,video/*",
    capture: "environment",
  }
}

/** The files of a change event; resets the input so the same file can be picked again. */
export function takeFiles(input: HTMLInputElement): File[] {
  const files = Array.from(input.files ?? [])
  input.value = ""
  return files
}

/**
 * Two hidden inputs and `open(source)`, which clicks one of them. Call `open`
 * synchronously inside the click handler: after a state update, an await or
 * an effect the browser has dropped the user activation, and iOS Safari then
 * blocks the picker. An empty selection (the picker was cancelled) is ignored.
 */
export function usePhotoSource({
  imagesOnly = false,
  onFiles,
}: {
  imagesOnly?: boolean
  onFiles: (files: File[], source: PhotoSource) => void
}): {
  open: (source: PhotoSource, call?: { imagesOnly?: boolean }) => void
  inputs: React.ReactNode
} {
  const library = React.useRef<HTMLInputElement>(null)
  const camera = React.useRef<HTMLInputElement>(null)
  const open = React.useCallback(
    (source: PhotoSource, call?: { imagesOnly?: boolean }) => {
      const input = (source === "library" ? library : camera).current
      if (!input) return
      // A per-call accept list (the next render sets the same value).
      if (call) input.accept = photoInputProps(source, call).accept
      input.click()
    },
    []
  )
  const change =
    (source: PhotoSource) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = takeFiles(event.currentTarget)
      if (files.length > 0) onFiles(files, source)
    }
  const inputs = (
    <>
      <input
        ref={library}
        {...photoInputProps("library", { imagesOnly })}
        hidden
        tabIndex={-1}
        data-photo-source="library"
        onChange={change("library")}
      />
      <input
        ref={camera}
        {...photoInputProps("camera", { imagesOnly })}
        hidden
        tabIndex={-1}
        data-photo-source="camera"
        onChange={change("camera")}
      />
    </>
  )
  return { open, inputs }
}

/**
 * The two picker buttons, library first. `layout`: "stack" puts them under
 * each other at full width, "row" side by side from sm. `onChoose` runs in the
 * click handler, so it may click a hidden input.
 */
export function PhotoSourceActions({
  onChoose,
  layout = "stack",
  disabled = false,
  libraryVariant = "primary",
  className,
  describedBy,
  cameraHidden = false,
}: {
  onChoose: (source: PhotoSource) => void
  layout?: "stack" | "row"
  disabled?: boolean
  /** Task screens use "secondary" while there are photos to choose already. */
  libraryVariant?: "primary" | "secondary"
  className?: string
  /** Id of the text that says how many files fit (on the library button). */
  describedBy?: string
  /** Leave the camera out (where capture is not offered). */
  cameraHidden?: boolean
}) {
  return (
    <div
      data-slot="photo-source-actions"
      className={cn(
        "flex flex-col gap-2",
        layout === "row" && "sm:flex-row",
        className
      )}
    >
      <Button
        type="button"
        size="touch"
        variant={libraryVariant}
        className={cn(layout === "row" && "sm:flex-1")}
        disabled={disabled}
        aria-describedby={describedBy}
        onClick={() => onChoose("library")}
      >
        <ImageIcon data-icon="inline-start" aria-hidden />
        {LIBRARY_LABEL}
      </Button>
      {cameraHidden ? null : (
        <Button
          type="button"
          size="touch"
          variant="outline"
          className={cn(layout === "row" && "sm:flex-1")}
          disabled={disabled}
          onClick={() => onChoose("camera")}
        >
          <CameraIcon data-icon="inline-start" aria-hidden />
          {CAMERA_LABEL}
        </Button>
      )}
    </div>
  )
}
