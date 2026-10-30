import type {
  LabelCatalogue,
  LabelEditorAsset,
  MediaLabelItemView,
  MediaLabelSummary,
} from "@/lib/menus/types"
import { EMPTY_LABEL_SUMMARY } from "@/lib/menus/types"

export const VENUE = { id: "venue-1", name: "The Railway" }

export const CATALOGUE: LabelCatalogue = {
  status: "active",
  venueId: VENUE.id,
  venueName: VENUE.name,
  versionId: "version-1",
  versionTitle: "Autumn menu",
  activatedAt: "2026-10-01T10:00:00Z",
  sections: [
    {
      id: "sec-starters",
      slug: "starters",
      name: "Starters",
      kind: "food",
      items: [
        {
          itemId: "item-bhaji",
          name: "Onion Bhaji",
          description: "Crispy onion fritters",
          aliases: ["Bhajia"],
          variants: [],
        },
      ],
    },
    {
      id: "sec-specials",
      slug: "house-specials",
      name: "House Specials",
      kind: "food",
      items: [
        {
          itemId: "item-tikka",
          name: "Tikka Masala",
          description: null,
          aliases: [],
          variants: [
            { variantId: "var-chicken", name: "Chicken" },
            { variantId: "var-lamb", name: "Lamb" },
          ],
        },
      ],
    },
    {
      id: "sec-korma",
      slug: "korma-dishes",
      name: "Korma Dishes",
      kind: "food",
      items: [
        {
          itemId: "item-korma-chicken",
          name: "Chicken",
          description: "Mild and creamy",
          aliases: [],
          variants: [],
        },
      ],
    },
    {
      id: "sec-madras",
      slug: "madras-dishes",
      name: "Madras Dishes",
      kind: "food",
      items: [
        {
          itemId: "item-madras-chicken",
          name: "Chicken",
          description: "Hot",
          aliases: [],
          variants: [],
        },
      ],
    },
    {
      id: "sec-drinks",
      slug: "drinks",
      name: "Drinks",
      kind: "drinks",
      items: [
        {
          itemId: "item-lassi",
          name: "Mango Lassi",
          description: "Sweet yoghurt drink",
          aliases: ["Lassi"],
          variants: [],
        },
      ],
    },
  ],
}

export const NO_MENU: LabelCatalogue = {
  status: "none",
  venueId: VENUE.id,
  venueName: VENUE.name,
}

export function view(
  itemId: string,
  name: string,
  sectionName: string,
  extra: Partial<MediaLabelItemView> = {}
): MediaLabelItemView {
  return {
    itemId,
    variantId: null,
    name,
    variantName: null,
    sectionName,
    labelledAs: null,
    state: "current",
    ...extra,
  }
}

export function summary(
  extra: Partial<MediaLabelSummary> = {}
): MediaLabelSummary {
  const s = { ...EMPTY_LABEL_SUMMARY, ...extra }
  return {
    ...s,
    hasLabels: s.items.length > 0 || s.contentTypes.length > 0,
  }
}

export function asset(
  id: string,
  labels: MediaLabelSummary = EMPTY_LABEL_SUMMARY,
  extra: Partial<LabelEditorAsset> = {}
): LabelEditorAsset {
  return {
    id,
    venueId: VENUE.id,
    venueName: VENUE.name,
    originalFilename: `${id}.jpg`,
    mediaType: "image",
    thumbnailUrl: null,
    labels,
    ...extra,
  }
}
