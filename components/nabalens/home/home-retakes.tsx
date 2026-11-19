"use client"

import {
  RetakeRow,
  type AlbumRetake,
} from "@/components/nabalens/album/album-home"
import { useAdd } from "@/components/nabalens/shell/add-context"

/**
 * Album's retake row on Home (DESIGN.md §5c step 3): the reviewer named the
 * slot, so tapping opens the gallery for that dish, as on Album (§5a step 2).
 */
export function HomeRetakes({
  retakes,
  canAdd,
}: {
  retakes: AlbumRetake[]
  canAdd: boolean
}) {
  const openAdd = useAdd()
  if (retakes.length === 0) return null
  return (
    <RetakeRow
      retakes={retakes}
      onRetake={(r) => {
        if (!canAdd || !openAdd) return
        openAdd({
          source: "library",
          imagesOnly: true,
          preset: {
            // The same dish and variant the reviewer asked again for.
            itemId: r.itemId,
            variantId: r.variantId ?? null,
            itemName: r.itemName,
            variantName: r.variantName ?? null,
          },
        })
      }}
    />
  )
}
