"use client"

import { FilmStripIcon } from "@phosphor-icons/react"

import { useAdd } from "@/components/nabalens/shell/add-context"
import { Button } from "@/components/ui/button"

export const ADD_VIDEO_LABEL = "Add a video"

/**
 * Your photos' quieter way to the older Add sheet, for a video and anything
 * Match does not take (DESIGN.md §5b; R15-1, departure A-D2). Gallery first:
 * the sheet opens the phone's photos, never a camera (§9).
 */
export function AddVideoButton({ blocked }: { blocked: boolean }) {
  const openAdd = useAdd()
  if (blocked || !openAdd) return null
  return (
    <Button
      variant="secondary"
      className="min-h-12"
      data-slot="me-add-video"
      onClick={() => openAdd({ dialog: true })}
    >
      <FilmStripIcon data-icon="inline-start" aria-hidden />
      {ADD_VIDEO_LABEL}
    </Button>
  )
}
