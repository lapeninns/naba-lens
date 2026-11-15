/*
 * Keyboard focus on an option in a popup list (menu item, select option):
 * the project's focus outline (DESIGN.md §7), inset because the popup
 * scrolls and so clips anything drawn outside an item. The focus tint alone
 * is about 1.2:1 against the popup, below WCAG 1.4.11's 3:1.
 */
export const OPTION_ITEM_FOCUS = "focus-ring-inset"

/*
 * The same mark for a list whose input keeps real focus (Combobox): Base UI
 * only sets data-highlighted on the option, so `focus-ring-inset`, which
 * waits for :focus-visible, never fires. The base layer gives the outline
 * its focus colour.
 */
export const OPTION_ITEM_HIGHLIGHT =
  "data-highlighted:bg-surface-2 data-highlighted:outline-3 data-highlighted:-outline-offset-3 data-highlighted:outline-solid"
