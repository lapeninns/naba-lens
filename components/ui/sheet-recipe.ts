import { cva, type VariantProps } from "class-variance-authority"

/*
 * One recipe for every overlay (v2 Sheet, `nl-sheet` and `nl-sheet--dialog`;
 * D10): a bottom sheet on scrim on phones, with a grip and 20px top
 * corners, and a centred dialog with 20px corners from md (bp-tablet).
 * Dialog and AlertDialog both draw from it, so the two cannot drift apart.
 * Width and height belong here: ask for a `size`, do not pass a class.
 */

/** The scrim behind a sheet or dialog. A tap on it closes a Dialog. */
export const sheetBackdrop =
  "fixed inset-0 isolate z-overlay bg-scrim duration-sheet data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"

// v2 sheet padding: 12px above the grip, 16px sides, 24px below plus the
// home indicator; v2's dialog is 24px all round from md, where nothing sits
// under it. 16px between parts.
const PADDED =
  "gap-4 px-4 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] md:p-6"
// v2's 40 x 4px grip in line-strong, drawn as the popup's first grid row.
// Decoration only, so it is a pseudo-element and needs no aria-hidden.
const GRIP =
  "before:h-1 before:w-10 before:justify-self-center before:rounded-round before:bg-edge-strong before:content-[''] md:before:hidden"

/*
 * The popup. Sizes: `sm` is a confirm (440px), `md` the default (v2
 * sheet-max, 480px),
 * `wide` a two-column form (760px) and `viewer` a photo or guide viewer:
 * the whole screen on a phone, large from md, with no padding or grip.
 * w-safe keeps a sheet clear of the notch when the phone is on its side.
 * Forced colours drop the shadow, so the popup draws an outline there.
 */
export const sheetPopup = cva(
  "group/sheet fixed inset-x-0 bottom-0 z-overlay mx-auto grid max-h-[88dvh] w-safe scroll-pb-40 grid-cols-[minmax(0,1fr)] overflow-y-auto overscroll-contain rounded-t-sheet bg-surface text-body text-ink shadow-float duration-sheet ease-out outline-none md:top-1/2 md:right-auto md:bottom-auto md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-sheet forced-colors:outline-2 forced-colors:outline-solid data-open:animate-in data-open:fade-in-40 data-open:slide-in-from-bottom-6 md:data-open:fade-in-0 md:data-open:slide-in-from-bottom-0 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-6 md:data-closed:slide-out-to-bottom-0",
  {
    variants: {
      size: {
        sm: `${PADDED} ${GRIP} md:max-w-110`,
        md: `${PADDED} ${GRIP} md:max-w-dialog`,
        wide: `${PADDED} ${GRIP} md:max-w-dialog-wide`,
        viewer:
          "gap-0 p-0 max-md:top-0 max-md:max-h-dvh max-md:min-h-dvh max-md:rounded-none md:max-h-[calc(100dvh-3rem)] md:max-w-[min(64rem,calc(100vw-3rem))]",
      },
    },
    defaultVariants: { size: "md" },
  }
)

export type SheetSize = NonNullable<VariantProps<typeof sheetPopup>["size"]>

/*
 * The action row. Phones stack the buttons full width in DOM order, grey
 * above blue, so the primary (written last) is nearest the thumb. From md
 * they sit right-aligned, safe choice first, each at least 140px wide.
 *
 * `sticky` is for a form longer than the sheet: the row stays at the bottom
 * edge while the form scrolls under it. The popup's scroll padding keeps a
 * control brought into view (by focus, say) clear of it (WCAG 2.4.11). It
 * bleeds over the popup's padding
 * (none in a viewer) and keeps clear of the home indicator itself.
 */
export const sheetFooter = cva(
  "flex flex-col gap-2 bg-surface pt-2 max-md:*:w-full md:flex-row md:flex-wrap md:justify-end md:*:min-w-35",
  {
    variants: {
      sticky: {
        true: "sticky bottom-0 z-local -mx-4 -mb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-bar group-data-[size=viewer]/sheet:mx-0 group-data-[size=viewer]/sheet:mb-0 md:-mx-6 md:-mb-6 md:px-6 md:pb-6 md:group-data-[size=viewer]/sheet:mx-0 md:group-data-[size=viewer]/sheet:mb-0",
        false: "",
      },
    },
    defaultVariants: { sticky: false },
  }
)
