import { createCn } from "cn/config"

/*
 * The system's type styles and radii are custom theme keys. Without them the
 * merger reads `text-label-touch` as a colour and drops it when a real colour
 * such as `text-ink` follows, so every type style is registered as a font size
 * and every radius as a radius. Keep these lists in step with app/globals.css.
 */
const TYPE_STYLES = [
  "page-title",
  "page-title-compact",
  "count",
  "count-sm",
  "count-touch",
  "section-title",
  "section-title-touch",
  "item-title",
  "item-title-touch",
  "body",
  "body-touch",
  "body-sm",
  "label",
  "label-touch",
  "meta",
  "meta-touch",
  "meta-strong",
  "chip",
  "chip-touch",
  "caption",
  "mono",
  "tab-label",
]

const RADII = [
  "print",
  "chip",
  "control",
  "touch",
  "panel",
  "card",
  "sheet",
  "round",
]

export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: TYPE_STYLES }],
      rounded: [{ rounded: RADII }],
      "rounded-t": [{ "rounded-t": RADII }],
    },
  },
})
