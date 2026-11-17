"use client"

import * as React from "react"

import { photoInputProps, takeFiles } from "@/components/nabalens/photo-source"

/*
 * Add's one picker (DESIGN.md §2, §9): the phone's own photo gallery. There
 * is no camera input and no `capture` attribute anywhere in Add: the person
 * takes photos with the phone's camera app and adds them from the gallery.
 *
 * `open` clicks the hidden input, so call it synchronously inside the click
 * handler (iOS Safari drops the picker after an await or an effect). Each
 * call says whether several files may be chosen and whether only photos are
 * accepted. A cancelled picker hands nothing on.
 */
export function useGalleryPicker({
  onFiles,
}: {
  onFiles: (files: File[]) => void
}): {
  open: (call?: { multiple?: boolean; imagesOnly?: boolean }) => void
  inputs: React.ReactNode
} {
  const input = React.useRef<HTMLInputElement>(null)
  const open = React.useCallback(
    ({
      multiple = true,
      imagesOnly = false,
    }: { multiple?: boolean; imagesOnly?: boolean } = {}) => {
      const node = input.current
      if (!node) return
      node.accept = photoInputProps("library", { imagesOnly }).accept
      node.multiple = multiple
      node.click()
    },
    []
  )
  const inputs = (
    <input
      ref={input}
      type="file"
      accept={photoInputProps("library").accept}
      multiple
      hidden
      tabIndex={-1}
      // The name existing tests and journeys find Add's picker by.
      data-photo-source="library"
      onChange={(event) => {
        const files = takeFiles(event.currentTarget)
        if (files.length > 0) onFiles(files)
      }}
    />
  )
  return { open, inputs }
}
