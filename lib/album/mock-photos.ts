// Dev-only preview: sample photos on part of the album, to see how Album
// looks once it fills up (DESIGN.md §5d). Never runs outside `next dev`, and
// only with NABALENS_ALBUM_MOCK_PHOTOS=1. It changes the page's view model
// only: nothing is written to the database.

import type { AlbumPlace, AlbumSlot, AlbumView } from "@/lib/album/model"

const PHOTOS = [
  "curry-45",
  "curry-close-up",
  "curry-overhead",
  "curry-side",
  "mint-curry-45",
  "mint-curry-close-up",
  "mint-curry-side",
  "mixed-grill-45",
  "mixed-grill-close-up",
  "mixed-grill-overhead",
  "mixed-grill-side",
  "momos-45",
  "momos-close-up",
  "momos-overhead",
  "momos-side",
  "naan-close-up",
  "naan-overhead",
  "naan-side",
].map((name) => `/guide/v1/${name}.webp`)

export const ALBUM_MOCK_PHOTOS =
  process.env.NODE_ENV === "development" &&
  process.env.NABALENS_ALBUM_MOCK_PHOTOS === "1"

function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * About half the empty food slots get an accepted sample photo and a few more
 * a waiting one; about a third of empty drinks read Waiting (there are no
 * drink samples). Fixed per slot, so a reload looks the same.
 */
function mockSlot(slot: AlbumSlot): AlbumSlot {
  if (slot.state !== "needed" || slot.optional) return slot
  const roll = hash(slot.id) % 100
  if (slot.category === "food") {
    const src = PHOTOS[hash(`${slot.id}:p`) % PHOTOS.length]!
    if (roll < 50) return { ...slot, state: "accepted", thumbnailUrl: src }
    if (roll < 62) return { ...slot, state: "waiting", thumbnailUrl: src }
    return slot
  }
  if (slot.category === "drinks" && roll < 30)
    return { ...slot, state: "waiting" }
  return slot
}

function mockPlace(place: AlbumPlace): AlbumPlace {
  const groups = place.groups.map((g) => {
    const slots = g.slots.map(mockSlot)
    return {
      ...g,
      slots,
      filled: slots.filter((s) => s.state === "accepted" && !s.optional).length,
    }
  })
  const all = groups.flatMap((g) => g.slots).filter((s) => !s.optional)
  return {
    ...place,
    groups,
    empty: all.filter((s) => s.state === "needed" || s.state === "retake")
      .length,
  }
}

export function withMockPhotos(view: AlbumView): AlbumView {
  const places = view.places.map(mockPlace)
  const unplaced = view.unplaced ? mockPlace(view.unplaced) : null
  const all = [...places, ...(unplaced ? [unplaced] : [])]
    .flatMap((p) => p.groups.flatMap((g) => g.slots))
    .filter((s) => s.state !== "not-here" && !s.optional)
  return {
    places,
    unplaced,
    counts: {
      filled: all.filter((s) => s.state === "accepted").length,
      waiting: all.filter(
        (s) =>
          s.state === "waiting" ||
          s.state === "sending" ||
          s.state === "check-due"
      ).length,
      empty: all.filter((s) => s.state === "needed" || s.state === "retake")
        .length,
      total: all.length,
    },
  }
}
