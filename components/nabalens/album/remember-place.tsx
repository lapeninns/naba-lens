"use client"

import * as React from "react"

import { rememberAlbumPlace } from "@/lib/album/remembered-place"

/**
 * Remembers the place on screen as the one this phone last opened
 * (DESIGN.md §5a step 3). Renders nothing.
 */
export function RememberPlace({ placeId }: { placeId: string }) {
  React.useEffect(() => rememberAlbumPlace(placeId), [placeId])
  return null
}
