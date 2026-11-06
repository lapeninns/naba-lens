// Dish photo guide: four example angles and a short checklist shown before a
// chef photographs a food menu section. Static app assets under public/guide/v1
// (scripts/guide/build-guide-images.ts), never media: no database, no Storage.

import type { RequirementView } from "@/lib/server/coverage/types"

export type GuideAngle = "three_quarter" | "overhead" | "close_up" | "side"

export type GuideImage = {
  /** 480 px wide, for the angle grid. */
  src: string
  /** Up to 1200 px wide, for the full-screen viewer. */
  src2x: string
  width: number
  height: number
  /** Real width of `src2x`; smaller than 1200 for a small source. */
  width2x: number
  height2x: number
}

export type GuideDish = {
  id: string
  name: string
  images: Record<GuideAngle, GuideImage>
}

export const GUIDE_ANGLES: { id: GuideAngle; name: string; tip: string }[] = [
  {
    id: "three_quarter",
    name: "45° angle",
    tip: "A little above the plate, phone tilted. Shows the front and height of the dish. Your main shot.",
  },
  {
    id: "overhead",
    name: "Overhead",
    tip: "Phone flat, straight above. Whole plate in, with some dark background around it.",
  },
  {
    id: "close_up",
    name: "Close-up",
    tip: "Move in on texture and garnish. Tap the food on screen so it's in focus.",
  },
  {
    id: "side",
    name: "Side view",
    tip: "Phone level with the plate. Shows height and layers.",
  },
]

export const GUIDE_RULES: string[] = [
  "Plain dark background. Nothing else on the table.",
  "The dish fills most of the frame.",
  "Hold your phone sideways.",
  "Wipe the rim and add the garnish last.",
  "Shoot straight after plating, before it goes out.",
  "No flash.",
]

/** Matches docs/operations.md. */
export const GUIDE_SAFETY =
  "Only take photos when it's safe. Never while carrying hot food or using a knife."

export const GUIDE_IMAGE_WIDTHS = { thumb: 480, large: 1200 } as const

const BASE = "/guide/v1"
const FILE_ANGLE: Record<GuideAngle, string> = {
  three_quarter: "45",
  overhead: "overhead",
  close_up: "close-up",
  side: "side",
}

/** Every source is 4:3; `large` is the source width when it is under 1200 px. */
function images(slug: string, large: number) {
  return Object.fromEntries(
    GUIDE_ANGLES.map(({ id }) => [
      id,
      {
        src: `${BASE}/${slug}-${FILE_ANGLE[id]}.webp`,
        src2x: `${BASE}/${slug}-${FILE_ANGLE[id]}@2x.webp`,
        width: GUIDE_IMAGE_WIDTHS.thumb,
        height: (GUIDE_IMAGE_WIDTHS.thumb * 3) / 4,
        width2x: large,
        height2x: Math.round((large * 3) / 4),
      },
    ])
  ) as Record<GuideAngle, GuideImage>
}

/** In prototype order; the first is the default. */
export const GUIDE_DISHES: GuideDish[] = [
  {
    id: "mixed-grill",
    name: "Mixed grill",
    images: images("mixed-grill", 1200),
  },
  { id: "naan", name: "Garlic naan", images: images("naan", 1200) },
  { id: "curry", name: "Curry", images: images("curry", 1200) },
  // Half-size source: kept at its native 716 px, never upscaled.
  { id: "momos", name: "Momos", images: images("momos", 716) },
  { id: "mint-curry", name: "Mint curry", images: images("mint-curry", 1200) },
]

/** "Mixed grill, 45° angle example" */
export function guideAlt(dish: GuideDish, angle: GuideAngle): string {
  const name = GUIDE_ANGLES.find((a) => a.id === angle)?.name ?? ""
  return `${dish.name}, ${name.toLowerCase()} example`
}

/** First min(target, 4) angles are suggested; none when the target is unknown or < 1. */
export function suggestedAngles(
  photoTarget: number | null | undefined
): GuideAngle[] {
  if (typeof photoTarget !== "number" || !(photoTarget >= 1)) return []
  return GUIDE_ANGLES.slice(0, Math.min(Math.floor(photoTarget), 4)).map(
    (angle) => angle.id
  )
}

/**
 * Whether a task shows the guide: menu sections that are food or of unknown
 * kind ("other" and unset are mostly food: sides, sauces). Every example is
 * food, so drinks sections and amenity, service and venue tasks never do.
 */
export function showsDishGuide(
  requirement: Pick<RequirementView, "kind" | "menuSection">
): boolean {
  return (
    requirement.kind === "menu_section" &&
    requirement.menuSection?.sectionKind !== "drinks"
  )
}
